import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KEY_ERRORS } from "@/lib/ai-key";
import { groqClient, SERVER_GROQ_KEY, type Groq } from "@/lib/groq";
import { loadKey } from "@/lib/groq-keys";
import { createHash } from "node:crypto";
import { createMeter, type Feature, type KeyRef, type Meter } from "@/lib/usage";

// Usage is tracked per actual key. User keys: their stored id. The server key:
// a short hash, so rotating it starts a fresh record.
export const SERVER_KEY_REF: KeyRef = `server:${createHash("sha256").update(SERVER_GROQ_KEY ?? "").digest("hex").slice(0, 12)}`;
export const userKeyRef = (keyId: string): KeyRef => `key:${keyId}`;

export async function getRole(supabase: SupabaseClient, userId: string): Promise<"admin" | null> {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin" ? "admin" : null;
}

// Decide which Groq key a request runs on. Admins use the server key; everyone
// else uses their own key, stored encrypted: the session's key if it has one,
// otherwise their account key. The returned meter records usage and quota;
// call meter.flush() (in after()) once the route's AI work is done.
export async function resolveGroq(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | null,
  feature: Feature,
): Promise<{ groq: Groq; meter: Meter } | { error: Response }> {
  if ((await getRole(supabase, userId)) === "admin") {
    if (!SERVER_GROQ_KEY) return { error: Response.json({ error: "The server's Groq key is not configured." }, { status: 500 }) };
    const meter = createMeter(supabase, { userId, sessionId, keyRef: SERVER_KEY_REF, feature });
    return { groq: groqClient(SERVER_GROQ_KEY, meter.fetch), meter };
  }

  const found = await loadKey(supabase, userId, sessionId);
  if (!found) {
    return {
      error: Response.json({ error: "Add your Groq API key to use the tutor.", code: KEY_ERRORS.required }, { status: 428 }),
    };
  }
  const meter = createMeter(supabase, { userId, sessionId, keyRef: userKeyRef(found.id), feature });
  return { groq: groqClient(found.key, meter.fetch), meter };
}

// Turn a Groq SDK failure into a response the client understands. A rejected
// key is reported distinctly so the client can ask for a new one.
export function groqErrorResponse(err: unknown, fallback: string): Response {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) {
    return Response.json({ error: "Groq rejected your saved API key. Replace it in Settings or below.", code: KEY_ERRORS.invalid }, { status: 401 });
  }
  if (status === 429) {
    const message = String((err as { message?: string })?.message ?? "");
    if (/tokens per day|TPD/i.test(message)) {
      return Response.json(
        { error: "This Groq key has used its daily token allowance. It frees up gradually over the next hours; see Settings → Usage.", code: "GROQ_DAILY_LIMIT" },
        { status: 429 },
      );
    }
    return Response.json({ error: "Groq's per-minute limit was reached for this key. Wait a minute and try again." }, { status: 429 });
  }
  console.error(fallback, err);
  return Response.json({ error: fallback }, { status: 502 });
}

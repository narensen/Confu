import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KEY_ERRORS } from "@/lib/ai-key";
import { groqClient, type Groq } from "@/lib/groq";
import { loadKey } from "@/lib/groq-keys";
import { poolFetch, poolSize } from "@/lib/groq-pool";
import { isOwner, type Role } from "@/lib/plans";
import { createMeter, type Feature, type KeyRef, type Meter } from "@/lib/usage";
import { logError } from "@/lib/log";

// Usage on the server's key pool is recorded under this ref. It is "pro" for
// rows written before Confu went open source; only the owner uses the pool now.
export const POOL_KEY_REF: KeyRef = "pro";

export const userKeyRef = (keyId: string): KeyRef => `key:${keyId}`;

// 'admin' is the only role. Anything else in the column (an old 'pro') is a
// student on their own key.
export async function getRole(supabase: SupabaseClient, userId: string): Promise<Role> {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return (data as { role?: string | null } | null)?.role === "admin" ? "admin" : null;
}

// Whether this account has an AI to run on: the owner's pool or a saved key.
export async function hasOwnAccess(supabase: SupabaseClient, userId: string, sessionId: string | null) {
  if (isOwner(await getRole(supabase, userId))) return poolSize() > 0;
  return Boolean(await loadKey(supabase, userId, sessionId));
}

// Decide which Groq key(s) a request runs on.
//   owner    -> the server's key pool
//   everyone -> their own key: the session's if set, else their account key
// The returned meter records usage (and, for own keys, Groq's limits);
// call meter.flush() once the route's AI work is done.
export async function resolveGroq(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | null,
  feature: Feature,
): Promise<{ groq: Groq; meter: Meter } | { error: Response }> {
  if (isOwner(await getRole(supabase, userId))) {
    if (!poolSize()) return { error: Response.json({ error: "The server's GROQ_API_KEYS aren't configured." }, { status: 500 }) };
    const meter = createMeter(supabase, { userId, sessionId, keyRef: POOL_KEY_REF, feature, baseFetch: poolFetch, trackQuota: false });
    // The pool sets the real key per request; the SDK just needs a placeholder.
    return { groq: groqClient("gsk_pool", meter.fetch), meter };
  }

  const found = await loadKey(supabase, userId, sessionId);
  if (!found) {
    return {
      error: Response.json({ error: "Add your Groq API key to use the tutor. It's free at console.groq.com.", code: KEY_ERRORS.required }, { status: 428 }),
    };
  }
  const meter = createMeter(supabase, { userId, sessionId, keyRef: userKeyRef(found.id), feature });
  return { groq: groqClient(found.key, meter.fetch), meter };
}

// Turn a Groq SDK failure into a response the client understands. A rejected
// key is reported distinctly so the client can ask for a new one.
export function groqErrorResponse(err: unknown, fallback: string): Response {
  const status = (err as { status?: number })?.status;
  const message = String((err as { message?: string })?.message ?? "");
  if (/type.?:?\s*"?pool|Confu's keys|server Groq keys/i.test(message)) {
    return Response.json({ error: "The server's Groq keys are at capacity right now. Try again in a minute." }, { status: 503 });
  }
  if (status === 401 || status === 403) {
    return Response.json({ error: "Groq rejected your saved API key. Replace it in Settings or below.", code: KEY_ERRORS.invalid }, { status: 401 });
  }
  if (status === 429) {
    if (/tokens per day|TPD/i.test(message)) {
      return Response.json(
        { error: "This Groq key has used its daily token allowance. It frees up gradually over the next hours; see Settings → Usage.", code: "GROQ_DAILY_LIMIT" },
        { status: 429 },
      );
    }
    return Response.json({ error: "Groq's per-minute limit was reached. Wait a minute and try again." }, { status: 429 });
  }
  logError(fallback, err);
  return Response.json({ error: fallback }, { status: 502 });
}

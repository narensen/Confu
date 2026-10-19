import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { KEY_ERRORS } from "@/lib/ai-key";
import { groqClient, type Groq } from "@/lib/groq";
import { loadKey } from "@/lib/groq-keys";
import { poolFetch, poolSize } from "@/lib/groq-pool";
import { planOf, type Role } from "@/lib/plans";
import { createMeter, type Feature, type KeyRef, type Meter } from "@/lib/usage";

// Pro accounts get this many tokens per rolling 24 hours on Confu's keys
// (owners are unlimited). Tune it to what your key pool can carry.
export const PRO_DAILY_TOKENS = Number(process.env.PRO_DAILY_TOKENS) || 200_000;

// Usage is tracked per actual key: 'pro' for the plan's pool, 'key:<id>' for
// a user's own stored key (replacing a key creates a new id).
export const PRO_KEY_REF: KeyRef = "pro";
export const userKeyRef = (keyId: string): KeyRef => `key:${keyId}`;

export async function getRole(supabase: SupabaseClient, userId: string): Promise<Role> {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin" || data?.role === "pro" ? data.role : null;
}

// Tokens a user has used on the Pro pool in the last 24 hours.
export async function proUsedLast24h(supabase: SupabaseClient, userId: string): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data } = await supabase
    .from("ai_usage")
    .select("total_tokens")
    .eq("user_id", userId)
    .eq("key_ref", PRO_KEY_REF)
    .gte("created_at", since)
    .limit(20_000);
  return ((data ?? []) as { total_tokens: number }[]).reduce((s, r) => s + r.total_tokens, 0);
}

// Decide which Groq key(s) a request runs on.
//   Pro / owner -> Confu's key pool (Pro has a daily fair-use allowance)
//   Free        -> the user's own key: the session's if set, else their account key
// The returned meter records usage (and, for own keys, Groq's limits);
// call meter.flush() once the route's AI work is done.
export async function resolveGroq(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | null,
  feature: Feature,
): Promise<{ groq: Groq; meter: Meter } | { error: Response }> {
  const role = await getRole(supabase, userId);

  if (planOf(role) === "pro") {
    if (!poolSize()) return { error: Response.json({ error: "Confu's server keys aren't configured yet." }, { status: 500 }) };
    if (role === "pro" && (await proUsedLast24h(supabase, userId)) >= PRO_DAILY_TOKENS) {
      return {
        error: Response.json(
          { error: "You've used today's Pro allowance. It frees up gradually over the next 24 hours; see your account menu.", code: "PRO_DAILY_LIMIT" },
          { status: 429 },
        ),
      };
    }
    const meter = createMeter(supabase, { userId, sessionId, keyRef: PRO_KEY_REF, feature, baseFetch: poolFetch, trackQuota: false });
    // The pool sets the real key per request; the SDK just needs a placeholder.
    return { groq: groqClient("gsk_pool", meter.fetch), meter };
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
  const message = String((err as { message?: string })?.message ?? "");
  if (/type.?:?\s*"?pool|Confu's keys|server Groq keys/i.test(message)) {
    return Response.json({ error: "Confu's AI is at capacity right now. Try again in a minute." }, { status: 503 });
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
  console.error(fallback, err);
  return Response.json({ error: fallback }, { status: 502 });
}

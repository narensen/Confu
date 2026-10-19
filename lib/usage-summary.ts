import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Groq's free-tier daily token allowance for these models. Groq doesn't send
// the daily limit in headers, so until a key hits it (and Groq tells us the
// exact number) we show this, marked as an estimate, only for keys whose
// other limits match the free tier.
const FREE_TIER_DAILY_TOKENS: Record<string, number> = {
  "openai/gpt-oss-120b": 200_000,
  "openai/gpt-oss-20b": 200_000,
};
const looksFreeTier = (q: { requests_limit: number | null; tokens_limit: number | null }) => q.requests_limit === 1000 && q.tokens_limit === 8000;

// Older than this, what we last saw may no longer be true (tokens free up
// continuously, and the key may be used outside Confu).
export const STALE_AFTER_MS = 30 * 60_000;

// "blocked": Groq refused for the daily limit and nothing has succeeded since.
// "ok": recent observations. "stale": nothing recent. "none": never observed.
export type UsageStatus = "blocked" | "ok" | "stale" | "none";

export type ModelUsage = {
  model: string;
  status: UsageStatus;
  used24h: number;
  used7d: number;
  dailyLimit: number | null;
  dailyLimitEstimated: boolean;
  requestsLimit: number | null;
  requestsRemaining: number | null;
  requestsResetAt: string | null;
  checkedAt: string | null; // last time Groq told us anything about this key + model
  blockedSince: string | null;
};

export type KeyUsage = { keyRef: string; models: ModelUsage[]; byFeature: { feature: string; tokens: number }[] };

type UsageRow = { key_ref: string; model: string; feature: string; total_tokens: number; created_at: string };
type QuotaRow = {
  key_ref: string;
  model: string;
  requests_limit: number | null;
  requests_remaining: number | null;
  requests_reset_at: string | null;
  tokens_limit: number | null;
  daily_tokens_limit: number | null;
  daily_limit_hit_at: string | null;
  last_success_at: string | null;
  observed_at: string;
};

const DAY = 86_400_000;

export function statusOf(q: QuotaRow | undefined, now = Date.now()): { status: UsageStatus; blockedSince: string | null } {
  if (!q) return { status: "none", blockedSince: null };
  const hit = q.daily_limit_hit_at ? Date.parse(q.daily_limit_hit_at) : null;
  const success = q.last_success_at ? Date.parse(q.last_success_at) : null;
  // Blocked until something succeeds after the hit. A day later it has surely
  // freed up, so stop claiming it.
  if (hit && hit > now - DAY && (!success || success < hit)) return { status: "blocked", blockedSince: q.daily_limit_hit_at };
  return { status: now - Date.parse(q.observed_at) > STALE_AFTER_MS ? "stale" : "ok", blockedSince: null };
}

// Usage for the given keys (only keys that exist now; replaced keys are history).
export async function usageSummary(supabase: SupabaseClient, userId: string, keyRefs: string[]): Promise<KeyUsage[]> {
  if (!keyRefs.length) return [];
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const [usage, quota] = await Promise.all([
    supabase
      .from("ai_usage")
      .select("key_ref, model, feature, total_tokens, created_at")
      .eq("user_id", userId)
      .in("key_ref", keyRefs)
      .gte("created_at", since)
      .limit(20_000),
    supabase.from("ai_quota").select("*").eq("user_id", userId).in("key_ref", keyRefs),
  ]);
  const rows = (usage.data ?? []) as UsageRow[];
  const quotas = (quota.data ?? []) as QuotaRow[];
  const now = Date.now();
  const dayAgo = now - DAY;

  return keyRefs.map((keyRef) => {
    const keyRows = rows.filter((r) => r.key_ref === keyRef);
    const models = new Set([...keyRows.map((r) => r.model), ...quotas.filter((q) => q.key_ref === keyRef).map((q) => q.model)]);
    const byFeature = new Map<string, number>();
    for (const r of keyRows) if (Date.parse(r.created_at) >= dayAgo) byFeature.set(r.feature, (byFeature.get(r.feature) ?? 0) + r.total_tokens);

    return {
      keyRef,
      byFeature: [...byFeature].map(([feature, tokens]) => ({ feature, tokens })).sort((a, b) => b.tokens - a.tokens),
      models: [...models]
        .map((model): ModelUsage => {
          const q = quotas.find((x) => x.key_ref === keyRef && x.model === model);
          const mine = keyRows.filter((r) => r.model === model);
          const estimate = q && looksFreeTier(q) ? (FREE_TIER_DAILY_TOKENS[model] ?? null) : null;
          const { status, blockedSince } = statusOf(q, now);
          return {
            model,
            status,
            // Rolling 24 h: falls as earlier usage ages out, like Groq's window.
            used24h: mine.filter((r) => Date.parse(r.created_at) >= dayAgo).reduce((s, r) => s + r.total_tokens, 0),
            used7d: mine.reduce((s, r) => s + r.total_tokens, 0),
            dailyLimit: q?.daily_tokens_limit ?? estimate,
            dailyLimitEstimated: !q?.daily_tokens_limit && estimate !== null,
            requestsLimit: q?.requests_limit ?? null,
            // A "remaining" count past its reset time has replenished.
            requestsRemaining: q && q.requests_reset_at && Date.parse(q.requests_reset_at) > now ? q.requests_remaining : (q?.requests_limit ?? null),
            requestsResetAt: q?.requests_reset_at ?? null,
            checkedAt: q?.observed_at ?? null,
            blockedSince,
          };
        })
        .sort((a, b) => b.used24h - a.used24h),
    };
  });
}

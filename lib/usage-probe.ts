import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRole, POOL_KEY_REF, resolveGroq, userKeyRef } from "@/lib/ai-access";
import { MODELS, modelBudget } from "@/lib/groq";
import { getKeyInfo } from "@/lib/groq-keys";
import { isOwner } from "@/lib/plans";
import { FREE_TIER_DAILY_TOKENS, usageSummary, type KeyUsage, type ModelUsage } from "@/lib/usage-summary";

// What the usage meters show for a user (and session).
export type MeterUsage = {
  // "own": the student's own Groq key. "owner": the server's pool.
  plan: "own" | "owner";
  status: ModelUsage["status"];
  used24h: number;
  dailyLimit: number | null;
  dailyLimitEstimated: boolean;
  checkedAt: string | null;
  blockedSince: string | null;
};

// The key a user's session runs on, as tracked in usage.
export async function ownKeyRef(supabase: SupabaseClient, userId: string, sessionId: string | null) {
  const info = await getKeyInfo(supabase, userId, sessionId);
  return info ? userKeyRef(info.id) : null;
}

// Ask Groq where an own key stands right now with a 1-token request. If the
// daily limit is still in force Groq refuses (costing nothing) and tells us
// the exact numbers; otherwise it costs ~75 tokens and proves the key works.
export async function probeKey(supabase: SupabaseClient, userId: string, sessionId: string | null) {
  const access = await resolveGroq(supabase, userId, sessionId, "probe");
  if ("error" in access) return;
  try {
    await access.groq.chat.completions.create(
      { model: MODELS.chat, messages: [{ role: "user", content: "." }], ...modelBudget(MODELS.chat, 1) },
      { maxRetries: 0 },
    );
  } catch {
    // A 429 here is the answer we wanted; the meter recorded it.
  }
  await access.meter.flush();
}

const AUTO_RECHECK_MS = 60_000; // re-check a "reached" key at most once a minute
const MANUAL_RECHECK_MS = 20_000; // and an explicit check at most every 20 s

// Usage for one own key. While it looks blocked, or when asked, check with
// Groq first so "limit reached" never outlives the actual limit.
export async function freshUsage(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | null,
  keyRef: string,
  opts: { force?: boolean } = {},
): Promise<KeyUsage | null> {
  let [usage] = await usageSummary(supabase, userId, [keyRef]);
  const main = usage?.models.find((m) => m.model === MODELS.chat);
  const age = main?.checkedAt ? Date.now() - Date.parse(main.checkedAt) : Infinity;
  const shouldProbe = (opts.force && age > MANUAL_RECHECK_MS) || (main?.status === "blocked" && age > AUTO_RECHECK_MS);
  if (shouldProbe) {
    await probeKey(supabase, userId, sessionId);
    [usage] = await usageSummary(supabase, userId, [keyRef]);
  }
  return usage ?? null;
}

// Tokens the owner used on the server's pool in the last 24 hours.
async function poolUsedLast24h(supabase: SupabaseClient, userId: string): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data } = await supabase
    .from("ai_usage")
    .select("total_tokens")
    .eq("user_id", userId)
    .eq("key_ref", POOL_KEY_REF)
    .gte("created_at", since)
    .limit(20_000);
  return ((data ?? []) as { total_tokens: number }[]).reduce((s, r) => s + r.total_tokens, 0);
}

// The meter's view. The owner's pool has no cap and is counted by Confu.
// Everyone else follows their own key.
export async function meterUsage(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | null,
  opts: { force?: boolean } = {},
): Promise<MeterUsage | null> {
  if (isOwner(await getRole(supabase, userId))) {
    return {
      plan: "owner",
      status: "ok",
      used24h: await poolUsedLast24h(supabase, userId),
      dailyLimit: null,
      dailyLimitEstimated: false,
      checkedAt: new Date().toISOString(),
      blockedSince: null,
    };
  }
  const keyRef = await ownKeyRef(supabase, userId, sessionId);
  if (!keyRef) return null;
  const usage = await freshUsage(supabase, userId, sessionId, keyRef, opts);
  const main = usage?.models.find((m) => m.model === MODELS.chat);
  if (!main) {
    const estimate = FREE_TIER_DAILY_TOKENS[MODELS.chat] ?? null;
    return { plan: "own", status: "none", used24h: 0, dailyLimit: estimate, dailyLimitEstimated: estimate !== null, checkedAt: null, blockedSince: null };
  }
  const { status, used24h, dailyLimit, dailyLimitEstimated, checkedAt, blockedSince } = main;
  return { plan: "own", status, used24h, dailyLimit, dailyLimitEstimated, checkedAt, blockedSince };
}

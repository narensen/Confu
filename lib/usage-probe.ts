import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRole, PRO_DAILY_TOKENS, proUsedLast24h, resolveGroq, userKeyRef } from "@/lib/ai-access";
import { MODELS } from "@/lib/groq";
import { getKeyInfo } from "@/lib/groq-keys";
import { planOf } from "@/lib/plans";
import { FREE_TIER_DAILY_TOKENS, usageSummary, type KeyUsage, type ModelUsage } from "@/lib/usage-summary";

// What the usage meters show for a user (and session).
export type MeterUsage = {
  plan: "free" | "pro";
  status: ModelUsage["status"];
  used24h: number;
  dailyLimit: number | null;
  dailyLimitEstimated: boolean;
  checkedAt: string | null;
  blockedSince: string | null;
};

// The key a free user's session runs on, as tracked in usage.
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
      { model: MODELS.chat, messages: [{ role: "user", content: "." }], max_completion_tokens: 1, reasoning_effort: "low" },
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

// The meter's view. Pro is measured against the plan's daily allowance, which
// Confu counts itself, so it's always current. Free follows the user's key.
export async function meterUsage(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | null,
  opts: { force?: boolean } = {},
): Promise<MeterUsage | null> {
  const role = await getRole(supabase, userId);
  if (planOf(role) === "pro") {
    const used = await proUsedLast24h(supabase, userId);
    const cap = role === "pro" ? PRO_DAILY_TOKENS : null; // owners are unlimited
    return {
      plan: "pro",
      status: cap !== null && used >= cap ? "blocked" : "ok",
      used24h: used,
      dailyLimit: cap,
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
    return { plan: "free", status: "none", used24h: 0, dailyLimit: estimate, dailyLimitEstimated: estimate !== null, checkedAt: null, blockedSince: null };
  }
  const { status, used24h, dailyLimit, dailyLimitEstimated, checkedAt, blockedSince } = main;
  return { plan: "free", status, used24h, dailyLimit, dailyLimitEstimated, checkedAt, blockedSince };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRole, resolveAi, SERVER_KEY_REF, serverKeysReady, TRIAL_PROMPTS, trialState, userKeyRef } from "@/lib/ai-access";
import { getKeyInfo, type KeyInfo } from "@/lib/ai-keys";
import { MODELS, modelBudget } from "@confu/ai/groq";
import { FREE_TIER_DAILY_TOKENS, usageSummary, type KeyUsage, type ModelUsage } from "@/lib/usage-summary";

// What the usage meters show for a user (and session).
//   own:    their own AI, measured per key (and against Groq's daily limit for Groq keys)
//   server: the owner on the server's keys, no limit
//   trial:  free prompts left on the server's keys
export type MeterUsage = {
  plan: "own" | "server" | "trial";
  status: ModelUsage["status"];
  used24h: number;
  dailyLimit: number | null;
  dailyLimitEstimated: boolean;
  checkedAt: string | null;
  blockedSince: string | null;
};

// Ask the provider where a key stands right now with a 1-token request. If
// Groq's daily limit is still in force it refuses (costing nothing) and says
// the exact numbers; otherwise it costs a few tokens and proves the key works.
export async function probeKey(supabase: SupabaseClient, userId: string, sessionId: string | null) {
  const access = await resolveAi(supabase, userId, sessionId, "probe");
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
// the provider first so "limit reached" never outlives the actual limit.
export async function freshUsage(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | null,
  key: KeyInfo,
  opts: { force?: boolean } = {},
): Promise<KeyUsage | null> {
  const keyRef = userKeyRef(key.id);
  const groq = key.provider === "groq" ? [keyRef] : [];
  let [usage] = await usageSummary(supabase, userId, [keyRef], groq);
  const main = usage?.models.find((m) => m.model === key.models.chat);
  const age = main?.checkedAt ? Date.now() - Date.parse(main.checkedAt) : Infinity;
  const shouldProbe = (opts.force && age > MANUAL_RECHECK_MS) || (main?.status === "blocked" && age > AUTO_RECHECK_MS);
  if (shouldProbe) {
    await probeKey(supabase, userId, sessionId);
    [usage] = await usageSummary(supabase, userId, [keyRef], groq);
  }
  return usage ?? null;
}

const now = () => new Date().toISOString();

// The meter's view: the student's own key if they have one, else the owner's
// server keys, else what's left of the free trial.
export async function meterUsage(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | null,
  opts: { force?: boolean } = {},
): Promise<MeterUsage | null> {
  const key = await getKeyInfo(supabase, userId, sessionId);
  if (key) {
    const usage = await freshUsage(supabase, userId, sessionId, key, opts);
    const main = usage?.models.find((m) => m.model === key.models.chat);
    if (!main) {
      const estimate = key.provider === "groq" ? (FREE_TIER_DAILY_TOKENS[key.models.chat] ?? null) : null;
      return { plan: "own", status: "none", used24h: 0, dailyLimit: estimate, dailyLimitEstimated: estimate !== null, checkedAt: null, blockedSince: null };
    }
    const { status, used24h, dailyLimit, dailyLimitEstimated, checkedAt, blockedSince } = main;
    return { plan: "own", status, used24h, dailyLimit, dailyLimitEstimated, checkedAt, blockedSince };
  }

  if (serverKeysReady() && (await getRole(supabase, userId)) === "admin") {
    const [usage] = await usageSummary(supabase, userId, [SERVER_KEY_REF]);
    const used = (usage?.models ?? []).reduce((sum, m) => sum + m.used24h, 0);
    return { plan: "server", status: "ok", used24h: used, dailyLimit: null, dailyLimitEstimated: false, checkedAt: now(), blockedSince: null };
  }

  // No key: show what's left of the free trial, counted in prompts (one-off, not daily).
  const trial = await trialState(supabase, userId);
  if (!trial) return null;
  const used = trial.promptsUsed;
  return {
    plan: "trial",
    status: used >= TRIAL_PROMPTS ? "blocked" : used ? "ok" : "none",
    used24h: used,
    dailyLimit: TRIAL_PROMPTS,
    dailyLimitEstimated: false,
    checkedAt: now(),
    blockedSince: null,
  };
}

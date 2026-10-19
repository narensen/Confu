import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveGroq, SERVER_KEY_REF, getRole, userKeyRef } from "@/lib/ai-access";
import { MODELS } from "@/lib/groq";
import { getKeyInfo } from "@/lib/groq-keys";
import { usageSummary, type KeyUsage } from "@/lib/usage-summary";

// The key a session runs on, as tracked in usage (null: no usable key).
export async function sessionKeyRef(supabase: SupabaseClient, userId: string, sessionId: string | null) {
  if ((await getRole(supabase, userId)) === "admin") return SERVER_KEY_REF;
  const info = await getKeyInfo(supabase, userId, sessionId);
  return info ? userKeyRef(info.id) : null;
}

// Ask Groq where this key stands right now with a 1-token request. If the
// daily limit is still in force Groq refuses (costing nothing) and tells us
// the exact numbers; otherwise it costs ~80 tokens and proves the key works.
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

// Usage for one key. While it looks blocked, or when asked, check with Groq
// first so "limit reached" never outlives the actual limit.
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

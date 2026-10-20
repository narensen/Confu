import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Meters every Groq request a route makes: tokens used (also for streamed
// answers), the limits Groq reports in its headers, and the daily token limit
// Groq reveals when it's hit. Plugged into the Groq client as its `fetch`, so
// call sites don't change. Call flush() once the route's work is done.

// 'pro': Pro/owner usage on Confu's key pool. 'key:<id>': a user's own key.
export type KeyRef = "pro" | "trial" | `key:${string}`;
export type Feature = "chat" | "plan" | "figure" | "quiz" | "grade" | "triage" | "pass1" | "probe" | "ocr" | "recommend";

type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

type QuotaPatch = {
  requests_limit?: number;
  requests_remaining?: number;
  requests_reset_at?: string;
  tokens_limit?: number;
  tokens_remaining?: number;
  daily_tokens_limit?: number;
  daily_limit_hit_at?: string;
  daily_used_at_hit?: number;
  last_success_at?: string;
};

// "4m19.2s", "600ms", "1h2m3s" -> milliseconds
export function parseDuration(text: string | null): number | null {
  if (!text) return null;
  let ms = 0;
  let matched = false;
  for (const [, n, unit] of text.matchAll(/([\d.]+)(ms|h|m|s)/g)) {
    matched = true;
    ms += Number(n) * (unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : unit === "s" ? 1000 : 1);
  }
  return matched ? ms : null;
}

const int = (v: string | null) => (v !== null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined);

// Streamed answers report usage in their final chunk.
async function usageFromStream(body: ReadableStream<Uint8Array>): Promise<Usage | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: Usage | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:") || !line.includes("usage")) continue;
      try {
        const chunk = JSON.parse(line.slice(5).trim()) as { usage?: Usage; x_groq?: { usage?: Usage } };
        usage = chunk.x_groq?.usage ?? chunk.usage ?? usage;
      } catch {}
    }
  }
  return usage;
}

export function createMeter(
  supabase: SupabaseClient,
  ctx: {
    userId: string;
    sessionId: string | null;
    keyRef: KeyRef;
    feature: Feature;
    // The fetch to observe (e.g. the key pool's); defaults to the global fetch.
    baseFetch?: typeof fetch;
    // Per-key limits only mean something for a user's own key, not the pool.
    trackQuota?: boolean;
  },
) {
  const baseFetch = ctx.baseFetch ?? fetch;
  const trackQuota = ctx.trackQuota ?? true;
  const pending: Promise<unknown>[] = [];
  const rows: { model: string; usage: Usage }[] = [];
  const quotas = new Map<string, QuotaPatch>();

  const patch = (model: string, p: QuotaPatch) => quotas.set(model, { ...quotas.get(model), ...p });

  const meteredFetch: typeof fetch = async (input, init) => {
    const res = await baseFetch(input, init);
    let model = "unknown";
    try {
      model = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model ?? model;
    } catch {}

    const h = res.headers;
    if (trackQuota && h.has("x-ratelimit-limit-requests")) {
      const reset = parseDuration(h.get("x-ratelimit-reset-requests"));
      patch(model, {
        requests_limit: int(h.get("x-ratelimit-limit-requests")),
        requests_remaining: int(h.get("x-ratelimit-remaining-requests")),
        requests_reset_at: reset !== null ? new Date(Date.now() + reset).toISOString() : undefined,
        tokens_limit: int(h.get("x-ratelimit-limit-tokens")),
        tokens_remaining: int(h.get("x-ratelimit-remaining-tokens")),
      });
    }

    // A successful request proves the key isn't blocked for this model now.
    if (res.ok && trackQuota) patch(model, { last_success_at: new Date().toISOString() });

    const type = h.get("content-type") ?? "";
    if (res.status === 429 && trackQuota) {
      // e.g. "Rate limit reached … on tokens per day (TPD): Limit 200000, Used 199996"
      pending.push(
        res
          .clone()
          .text()
          .then((t) => {
            const m = t.match(/tokens per day \(TPD\): Limit (\d+), Used (\d+)/i);
            if (m) {
              patch(model, { daily_tokens_limit: Number(m[1]), daily_used_at_hit: Number(m[2]), daily_limit_hit_at: new Date().toISOString() });
            }
          })
          .catch(() => {}),
      );
    } else if (res.ok && type.includes("text/event-stream") && res.body) {
      const [forSdk, forMeter] = res.body.tee();
      pending.push(usageFromStream(forMeter).then((u) => u && rows.push({ model, usage: u })).catch(() => {}));
      return new Response(forSdk, { status: res.status, statusText: res.statusText, headers: res.headers });
    } else if (res.ok && type.includes("application/json")) {
      pending.push(
        res
          .clone()
          .json()
          .then((b: { usage?: Usage }) => b.usage && rows.push({ model, usage: b.usage }))
          .catch(() => {}),
      );
    }
    return res;
  };

  return {
    fetch: meteredFetch,
    // Record everything observed. Safe to call more than once.
    async flush() {
      await Promise.allSettled(pending.splice(0));
      const usage = rows.splice(0);
      const quota = [...quotas].map(([model, p]) => ({ user_id: ctx.userId, key_ref: ctx.keyRef, model, ...p, observed_at: new Date().toISOString() }));
      quotas.clear();
      await Promise.allSettled([
        usage.length &&
          supabase.from("ai_usage").insert(
            usage.map(({ model, usage: u }) => ({
              user_id: ctx.userId,
              session_id: ctx.sessionId,
              key_ref: ctx.keyRef,
              model,
              feature: ctx.feature,
              prompt_tokens: u.prompt_tokens ?? 0,
              completion_tokens: u.completion_tokens ?? 0,
              total_tokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
            })),
          ),
        // One upsert per model: a row only updates the fields observed this time,
        // so a learned daily limit isn't wiped by a later header-only update.
        ...quota.map(async (q) => {
          const { error } = await supabase.from("ai_quota").upsert(q, { onConflict: "user_id,key_ref,model" });
          // Before migration 0011 these columns don't exist; keep the rest.
          if (error && /last_success_at|daily_used_at_hit/.test(error.message)) {
            const { last_success_at: _a, daily_used_at_hit: _b, ...base } = q as typeof q & { last_success_at?: string; daily_used_at_hit?: number };
            void _a;
            void _b;
            await supabase.from("ai_quota").upsert(base, { onConflict: "user_id,key_ref,model" });
          }
        }),
      ]);
    },
  };
}

export type Meter = ReturnType<typeof createMeter>;

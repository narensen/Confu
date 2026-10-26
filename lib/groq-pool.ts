import "server-only";
import { createHash } from "node:crypto";
import { parseDuration } from "@/lib/usage";

// Confu's own Groq keys, used for Pro (and owner) accounts.
//
//   GROQ_API_KEYS=gsk_one,gsk_two,gsk_three   (comma or newline separated)
//   GROQ_API_KEY=gsk_…                         (also included)
//
// Requests rotate across the keys. When Groq rate-limits a key for a model
// (per-minute or per-day), that key is skipped for that model until Groq says
// it frees up, and the request is retried on the next key, before any answer
// streams, so the user doesn't notice. When every key is limited:
//   - a per-minute limit frees within seconds, so the request waits for it
//     (up to WAIT_BUDGET) instead of failing; heavy requests (a paper's text
//     is thousands of tokens) easily pass a free key's tokens-per-minute;
//   - still limited, it falls back to a smaller model with its own limits.
// State is per server instance; a fresh instance relearns it from Groq's
// responses (a refused request costs nothing).

const keys = [
  ...new Set(
    [process.env.GROQ_API_KEYS, process.env.GROQ_API_KEY, process.env.NEXT_PUBLIC_GROQ_API_KEY]
      .filter(Boolean)
      .join(",")
      .split(/[\s,]+/)
      .map((k) => k.trim())
      .filter((k) => k.startsWith("gsk_")),
  ),
].map((key) => ({ key, fp: createHash("sha256").update(key).digest("hex").slice(0, 12) }));

const benchedUntil = new Map<string, number>(); // "<fp>|<model>" or "<fp>|*" (bad key)
let cursor = 0;

export const poolSize = () => keys.length;

// How long Groq asked us to wait: Retry-After, or "try again in 7m21.5s".
function waitMs(res: Response, body: string): number {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const m = body.match(/try again in ([\d.hms]+)/i);
  return (m && parseDuration(m[1])) || 60_000;
}

const WAIT_BUDGET = 20_000; // ms a request may wait for a key to free up
// Same API and parameters, separate rate limits: used when the first is exhausted.
const FALLBACK: Record<string, string> = { "openai/gpt-oss-120b": "openai/gpt-oss-20b" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message, type: "pool" } }), { status, headers: { "content-type": "application/json" } });

export const poolFetch: typeof fetch = async (input, init) => {
  if (!keys.length) return json(500, "No server Groq keys are configured (GROQ_API_KEYS).");

  let model = "*";
  try {
    model = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model ?? "*";
  } catch {}
  // Only string bodies can be resent to another key (or another model).
  const retryable = typeof init?.body === "string" || init?.body == null;

  const started = Date.now();
  for (;;) {
    const res = await tryKeys(input, init, model, retryable);
    if (res) return res;
    if (!retryable) break;
    // Every key is limited for this model: wait if one frees up soon enough.
    const wait = soonestFree(model) - Date.now();
    if (wait > WAIT_BUDGET - (Date.now() - started)) break;
    await sleep(Math.max(250, wait + 250));
  }
  // Still limited: the smaller model, which has limits of its own.
  const fallback = FALLBACK[model];
  if (retryable && fallback && typeof init?.body === "string") {
    const body = init.body.replace(`"model":"${model}"`, `"model":"${fallback}"`);
    if (body !== init.body) {
      const res = await tryKeys(input, { ...init, body }, fallback, true);
      if (res) return res;
    }
  }
  // Report the pool's state, not one key's (its message would talk about "your key").
  return json(429, "All of Confu's keys are busy right now. Try again in a minute.");
};

// One pass over the keys not benched for this model: the first answer that
// isn't a rate limit or a refused key, or null if there's none.
async function tryKeys(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1], model: string, retryable: boolean): Promise<Response | null> {
  for (let i = 0; i < keys.length; i++) {
    const k = keys[(cursor + i) % keys.length];
    const now = Date.now();
    if ((benchedUntil.get(`${k.fp}|*`) ?? 0) > now || (benchedUntil.get(`${k.fp}|${model}`) ?? 0) > now) continue;

    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${k.key}`);
    const res = await fetch(input, { ...init, headers });

    if (res.status === 429) {
      benchedUntil.set(`${k.fp}|${model}`, Date.now() + waitMs(res, await res.clone().text()));
    } else if (res.status === 401 || res.status === 403) {
      benchedUntil.set(`${k.fp}|*`, Date.now() + 3_600_000);
    } else {
      cursor = (cursor + i + 1) % keys.length; // spread load across keys
      return res;
    }
    if (!retryable) break;
  }
  return null;
}

// When the first key usable for this model frees up (a key refused outright doesn't count).
function soonestFree(model: string) {
  const now = Date.now();
  let soonest = Infinity;
  for (const k of keys) {
    if ((benchedUntil.get(`${k.fp}|*`) ?? 0) > now) continue;
    soonest = Math.min(soonest, Math.max(now, benchedUntil.get(`${k.fp}|${model}`) ?? 0));
  }
  return soonest;
}

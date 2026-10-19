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
// streams, so the user doesn't notice. State is per server instance; a fresh
// instance relearns it from Groq's responses (a refused request costs nothing).

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

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message, type: "pool" } }), { status, headers: { "content-type": "application/json" } });

export const poolFetch: typeof fetch = async (input, init) => {
  if (!keys.length) return json(500, "No server Groq keys are configured (GROQ_API_KEYS).");

  let model = "*";
  try {
    model = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model ?? "*";
  } catch {}
  // Only string bodies can be resent to another key.
  const retryable = typeof init?.body === "string" || init?.body == null;

  let refused = false;
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
    refused = true;
    if (!retryable) break;
  }
  // Report the pool's state, not one key's (its message would talk about "your key").
  return refused || keys.length
    ? json(429, "All of Confu's keys are busy right now. Try again in a minute.")
    : json(500, "No server Groq keys are configured (GROQ_API_KEYS).");
};

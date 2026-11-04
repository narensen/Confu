import type { FetchLike } from "./fetch-like";
import type { Connection } from "./connection";
import type { ProviderId } from "./providers";

// Requests to every provider with an OpenAI-style chat API. Call sites build
// one request shape (Groq's: reasoning_effort, include_reasoning, …); this
// rewrites it into what each provider and model accepts, and sends it to the
// connection's address with the connection's key.

// OpenRouter shows requests as coming from this site.
// (Written out in full so Next.js can fill it in at build time; guarded for
// bundlers that have no process at all.)
const SITE_URL = ((typeof process !== "undefined" && process.env.NEXT_PUBLIC_SITE_URL) || "https://confu.lol").replace(/\/$/, "");

// The only headers a request carries. Browsers check each header against
// the provider's CORS rules, and Google's endpoint refuses the SDK's own
// (x-stainless-*), so anything else is dropped. OpenRouter accepts its two
// attribution headers.
const KEEP = ["accept", "content-type"];
const OPENROUTER_KEEP = ["http-referer", "x-title"];

// Checks a custom server's address before Confu fetches it. Only the server
// passes one (guard.ts): there, an address on a private network could reach
// Confu's own infrastructure. A student's browser talks to their own server.
export type UrlGuard = (baseUrl: string) => Promise<string>;

const GROQ_BASE = "https://api.groq.com/openai/v1";

// The Groq SDK asks for https://api.groq.com/openai/v1/<path>.
function target(input: Parameters<FetchLike>[0], base: string): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith(GROQ_BASE) ? base + url.slice(GROQ_BASE.length) : url;
}

export function openAiCompatFetch(conn: Connection, opts: { guard?: UrlGuard } = {}): FetchLike {
  return async (input, init) => {
    const url = target(input, conn.baseUrl);
    if (conn.provider === "custom" && opts.guard) {
      try {
        await opts.guard(conn.baseUrl);
      } catch (err) {
        return ownError(400, err instanceof Error ? err.message : "Couldn't reach your model server.", conn.provider);
      }
    }
    const given = new Headers(init?.headers);
    const headers = new Headers();
    for (const name of KEEP) {
      const v = given.get(name);
      if (v) headers.set(name, v);
    }
    if (conn.key) headers.set("authorization", `Bearer ${conn.key}`);
    if (conn.provider === "openrouter") {
      // OpenRouter's app attribution: requests show up as Confu.
      headers.set("http-referer", SITE_URL);
      headers.set("x-title", "Confu");
    }
    for (const name of conn.provider === "openrouter" ? OPENROUTER_KEEP : []) if (!headers.has(name) && given.get(name)) headers.set(name, given.get(name)!);
    const body = typeof init?.body === "string" ? adaptBody(conn.provider, init.body) : init?.body;
    // On the server, a custom address isn't allowed to redirect elsewhere (the guard checked this one).
    const res = await fetch(url, { ...init, headers, body, ...(opts.guard && conn.provider === "custom" ? { redirect: "error" as const } : {}) });
    return res.ok ? res : withProvider(res, conn.provider);
  };
}

// Error responses carry the provider's name so the message can say whose key it was.
export function withProvider(res: Response, provider: ProviderId): Response {
  const headers = new Headers(res.headers);
  headers.set("x-confu-provider", provider);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// An error Confu itself raises before reaching the provider, with a message
// meant for the student (x-confu-message) and no retry.
export function ownError(status: number, message: string, provider: ProviderId, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json");
  headers.set("x-confu-provider", provider);
  headers.set("x-confu-message", encodeURIComponent(message));
  headers.set("x-should-retry", "false");
  return new Response(JSON.stringify({ error: { message } }), { status, headers });
}

type Body = Record<string, unknown> & { model?: string; reasoning_effort?: string; max_completion_tokens?: number; max_tokens?: number; stream?: boolean };

// Reasoning tokens count toward the output limit. Confu's budgets were set
// for Groq's models at "low"; other thinking models get some room on top.
const THINKING_ROOM = 1024;

export function adaptBody(provider: ProviderId, raw: string): string {
  let b: Body;
  try {
    b = JSON.parse(raw) as Body;
  } catch {
    return raw;
  }
  const model = String(b.model ?? "");
  // "none" | "low" | "medium": as little thinking as the model allows, or a bit more.
  const effort = b.reasoning_effort;
  const max = b.max_completion_tokens ?? b.max_tokens;
  delete b.include_reasoning;
  delete b.reasoning_format;
  delete b.reasoning_effort;
  delete b.max_completion_tokens;
  delete b.max_tokens;
  const setMax = (field: "max_tokens" | "max_completion_tokens", extra = 0) => {
    if (typeof max === "number") b[field] = max + extra;
  };

  switch (provider) {
    case "groq":
      // Same API, but the student may have picked a different model.
      if (/gpt-oss/i.test(model)) {
        b.reasoning_effort = effort === "medium" ? "medium" : "low";
        b.include_reasoning = false;
      } else if (/qwen/i.test(model)) {
        b.reasoning_effort = effort === "none" ? "none" : "default";
        b.reasoning_format = "hidden";
      }
      setMax("max_completion_tokens");
      break;
    case "openai": {
      const reasoning = /^(o\d|gpt-5)/.test(model) && !/chat/.test(model);
      if (reasoning) {
        b.reasoning_effort = effort === "medium" ? "medium" : "low";
        // Reasoning models only take the default sampling.
        delete b.temperature;
        delete b.top_p;
      }
      setMax("max_completion_tokens", reasoning ? THINKING_ROOM : 0);
      if (b.stream) b.stream_options = { include_usage: true };
      break;
    }
    case "gemini": {
      const thinking = /gemini-(2\.5|[3-9])/.test(model);
      if (thinking) b.reasoning_effort = effort === "medium" ? "medium" : "low";
      setMax("max_tokens", thinking ? THINKING_ROOM : 0);
      break;
    }
    case "openrouter":
      // OpenRouter's own form; models that don't reason ignore it.
      b.reasoning = { effort: effort === "medium" ? "medium" : "low", exclude: true };
      setMax("max_tokens", THINKING_ROOM);
      break;
    case "custom":
      // The widest-supported subset: many local servers reject newer fields.
      delete b.response_format;
      setMax("max_tokens");
      break;
    case "anthropic":
      break; // never sent this way (lib/ai/anthropic.ts)
  }
  return JSON.stringify(b);
}

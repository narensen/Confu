import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { isPrivateAddress } from "@/lib/import/safe-fetch";
import { SITE } from "@/lib/site";
import type { Connection } from "./connection";
import type { ProviderId } from "./providers";

// Requests to every provider with an OpenAI-style chat API. Call sites build
// one request shape (Groq's: reasoning_effort, include_reasoning, …); this
// rewrites it into what each provider and model accepts, and sends it to the
// connection's address with the connection's key.

// Self-hosters can point Confu at a model server on their own network
// (Ollama, LM Studio). On a shared server that would let anyone make it
// fetch internal addresses, so it's off unless the operator turns it on.
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_AI_URLS === "1";

export class BaseUrlError extends Error {}

// A custom provider's address, checked: http(s), no credentials, and (unless
// private addresses are allowed) https on a host that resolves to public IPs.
export async function checkBaseUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BaseUrlError("That doesn't look like an address. It should start with https:// and usually end in /v1.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BaseUrlError("The address must start with https://");
  if (url.username || url.password) throw new BaseUrlError("Put the key in the key field, not in the address.");
  if (url.search || url.hash) throw new BaseUrlError("Leave out the ?… and #… parts of the address.");
  if (!ALLOW_PRIVATE) {
    if (url.protocol !== "https:") throw new BaseUrlError("The address must use https://");
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new BaseUrlError(PRIVATE_NOTE);
    const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (!addrs.length) throw new BaseUrlError("Couldn't find that server. Check the address.");
    if (addrs.some((a) => isPrivateAddress(a.address))) throw new BaseUrlError(PRIVATE_NOTE);
  }
  return url.toString().replace(/\/+$/, "");
}

const PRIVATE_NOTE =
  "That address is on a private network, which this Confu server doesn't reach. If you run Confu yourself, set ALLOW_PRIVATE_AI_URLS=1 to use a local model server.";

const GROQ_BASE = "https://api.groq.com/openai/v1";

// The Groq SDK asks for https://api.groq.com/openai/v1/<path>.
function target(input: Parameters<typeof fetch>[0], base: string): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith(GROQ_BASE) ? base + url.slice(GROQ_BASE.length) : url;
}

export function openAiCompatFetch(conn: Connection): typeof fetch {
  return async (input, init) => {
    const url = target(input, conn.baseUrl);
    if (conn.provider === "custom") {
      try {
        await checkBaseUrl(conn.baseUrl);
      } catch (err) {
        return ownError(400, err instanceof BaseUrlError ? err.message : "Couldn't reach your model server.", conn.provider);
      }
    }
    const headers = new Headers(init?.headers);
    if (conn.key) headers.set("authorization", `Bearer ${conn.key}`);
    else headers.delete("authorization");
    if (conn.provider === "openrouter") {
      // OpenRouter's app attribution: requests show up as Confu.
      headers.set("http-referer", SITE.url);
      headers.set("x-title", "Confu");
    }
    const body = typeof init?.body === "string" ? adaptBody(conn.provider, init.body) : init?.body;
    const res = await fetch(url, { ...init, headers, body, ...(conn.provider === "custom" && !ALLOW_PRIVATE ? { redirect: "error" as const } : {}) });
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

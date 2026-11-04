import type { FetchLike } from "@confu/ai/fetch-like";
import { OPENROUTER_AUTH, OPENROUTER_EXCHANGE } from "@confu/ai/openrouter";
import type { AddResult, DeviceKeys } from "./keys";

// "Connect OpenRouter" without a server: the same OAuth flow with PKCE, run
// in the page. The verifier waits in sessionStorage while the student is on
// openrouter.ai; the key that comes back is stored like a pasted one.
// https://openrouter.ai/docs/use-cases/oauth-pkce

const PENDING = "confu.openrouter";

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Where to send the student. `callbackUrl` is this page; openrouter.ai
// sends them back to it with ?code=.
export async function openRouterAuthUrl(callbackUrl: string, sessionId: string | null = null, storage: KeyValueStore = sessionStorage): Promise<string> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  storage.setItem(PENDING, JSON.stringify({ v: verifier, s: sessionId, at: Date.now() }));
  const url = new URL(OPENROUTER_AUTH);
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// Back from openrouter.ai with ?code=: trade it for the key and keep it.
export async function finishOpenRouter(keys: DeviceKeys, code: string, storage: KeyValueStore = sessionStorage, fetcher: FetchLike = fetch): Promise<AddResult> {
  const raw = storage.getItem(PENDING);
  storage.removeItem(PENDING);
  let pending: { v?: unknown; s?: unknown; at?: unknown } = {};
  try {
    pending = raw ? JSON.parse(raw) : {};
  } catch {}
  if (typeof pending.v !== "string" || typeof pending.at !== "number" || Date.now() - pending.at > 15 * 60_000) {
    return { ok: false, error: "That sign-in has expired. Connect OpenRouter again." };
  }
  let key: string | undefined;
  try {
    const res = await fetcher(OPENROUTER_EXCHANGE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: pending.v, code_challenge_method: "S256" }),
    });
    if (res.ok) key = ((await res.json()) as { key?: string }).key;
  } catch {
    return { ok: false, error: "Couldn't reach OpenRouter. Check your connection and try again." };
  }
  if (!key) return { ok: false, error: "OpenRouter didn't approve the connection. Try again." };
  return keys.add({ provider: "openrouter", key, sessionId: typeof pending.s === "string" ? pending.s : null, via: "oauth" });
}

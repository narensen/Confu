// "Connect OpenRouter": OpenRouter's OAuth flow with PKCE. The student
// approves Confu on openrouter.ai (and can set a spending limit there); we
// get back a key of their own, billed to their OpenRouter credits.
// https://openrouter.ai/docs/use-cases/oauth-pkce

export const OPENROUTER_AUTH = "https://openrouter.ai/auth";
export const OPENROUTER_EXCHANGE = "https://openrouter.ai/api/v1/auth/keys";

// Holds the PKCE verifier between leaving for openrouter.ai and coming back.
export const STATE_COOKIE = "confu_openrouter";
export const STATE_PATH = "/api/ai/openrouter";

// u: the account that started it, s: the session to save it for (or null
// for the account), n: where to go afterwards.
export type ConnectState = { v: string; u: string; s: string | null; n: string };

export function readState(raw: string | undefined): ConnectState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<ConnectState>;
    return typeof s.v === "string" && typeof s.u === "string" && typeof s.n === "string" ? { v: s.v, u: s.u, s: typeof s.s === "string" ? s.s : null, n: s.n } : null;
  } catch {
    return null;
  }
}

// Where the "Connect OpenRouter" button points.
export const connectHref = (next: string, sessionId: string | null = null) =>
  `${STATE_PATH}/start?next=${encodeURIComponent(next)}${sessionId ? `&session=${sessionId}` : ""}`;

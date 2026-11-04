import { isProviderId, PROVIDERS } from "./providers";

// Why an AI request failed, in words for the student, wherever it ran.

export const KEY_ERRORS = {
  required: "AI_KEY_REQUIRED", // no AI connected (and no free prompts left)
  invalid: "AI_KEY_INVALID", // the provider rejected the saved key
} as const;

export type AiProblem = {
  status: number;
  error: string;
  code?: string;
  // An unexpected failure, worth logging (the rest are the provider's normal refusals).
  unexpected?: boolean;
};

export function describeAiError(err: unknown, fallback: string): AiProblem {
  const e = err as { status?: number; message?: string; headers?: Headers | Record<string, string> };
  const status = e?.status;
  const message = String(e?.message ?? "");
  const header = (name: string) => {
    const h = e?.headers;
    if (!h) return null;
    return typeof (h as Headers).get === "function" ? (h as Headers).get(name) : ((h as Record<string, string>)[name] ?? null);
  };
  const raw = header("x-confu-provider");
  const provider = isProviderId(raw) ? raw : null;
  const name = provider === "custom" ? "Your model server" : provider ? PROVIDERS[provider].name : "The AI provider";
  const own = header("x-confu-message");

  if (own) return { status: status && status >= 400 ? status : 502, error: decodeURIComponent(own) };
  if (!provider && /type.?:?\s*"?pool|Confu's keys|server Groq keys/i.test(message)) {
    return { status: 503, error: "The free prompts are busy right now. Try again in a minute, or connect your own AI." };
  }
  if (status === 401 || status === 403) {
    return { status: 401, error: `${name} rejected the saved ${provider === "openrouter" ? "connection" : "API key"}. Replace it in Settings or below.`, code: KEY_ERRORS.invalid };
  }
  if (status === 402 || (status === 429 && /insufficient_quota|exceeded your current quota|credit balance|out of credit/i.test(message))) {
    return { status: 402, error: `${name} says the account is out of credit. Add some there, or connect a different AI in Settings.` };
  }
  if ((status === 400 || status === 404) && /model/i.test(message) && /not (?:be )?found|does not exist|not exist|invalid model|unknown model|no endpoints|not supported|decommissioned|deprecated/i.test(message)) {
    return { status: 400, error: `${name} doesn't offer the model picked for this. Choose another in Settings → Your AI.` };
  }
  if (status === 429) {
    if (/tokens per day|TPD/i.test(message)) {
      return { status: 429, error: "This Groq key has used its daily token allowance. It frees up gradually over the next hours; see Settings → Usage.", code: "GROQ_DAILY_LIMIT" };
    }
    return { status: 429, error: `${name}'s rate limit was reached. Wait a minute and try again.` };
  }
  if (status === 529 || status === 503) return { status: 503, error: `${name} is overloaded right now. Try again in a minute.` };
  // A browser that couldn't reach the provider at all (offline, blocked, CORS).
  if (!status && /fetch|network|connection/i.test(message)) return { status: 503, error: `Couldn't reach ${name}. Check your connection and try again.`, unexpected: true };
  return { status: 502, error: fallback, unexpected: true };
}

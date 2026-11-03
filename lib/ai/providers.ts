// The AI providers a student can bring, shared by the server and the UI.
// Nothing secret here: names, where to get a key, and default models.
//
// Every provider but Anthropic is reached through its OpenAI-compatible
// chat API (lib/ai/openai-compat.ts). Anthropic goes through its own SDK
// (lib/ai/anthropic.ts).

export type ProviderId = "groq" | "openai" | "anthropic" | "gemini" | "openrouter" | "custom";

// The three jobs Confu gives a model.
//   chat:   tutor answers, plans, practice questions, marking
//   fast:   cheap background work (progress notes)
//   vision: reading figures and scanned pages
export type ModelRoles = { chat: string; fast: string; vision: string };

// A model the picker can offer. `null` means this provider's list doesn't say,
// so the picker must not hide the model for that reason.
// `free` is OpenRouter's `:free` variant (no charge, their rate limits).
export type ListedModel = { id: string; open: boolean | null; vision: boolean | null; free: boolean | null };

export type Provider = {
  id: ProviderId;
  name: string;
  blurb: string; // one line in the picker
  baseUrl: string; // OpenAI-compatible base, no trailing slash ("" for custom)
  keyUrl: string | null;
  keyPlaceholder: string;
  keyPrefix: string | null; // keys start with this, when the provider says so
  defaults: ModelRoles;
  // Preferred models, best first, matched against the provider's live list
  // when a key is saved. Within one pattern the newest version wins, so the
  // defaults follow new releases without a code change.
  prefer?: { chat: RegExp[]; fast: RegExp[]; vision: RegExp[] };
};

const GROQ_DEFAULTS: ModelRoles = {
  chat: process.env.GROQ_CHAT_MODEL ?? "openai/gpt-oss-120b",
  fast: process.env.GROQ_FAST_MODEL ?? "openai/gpt-oss-20b",
  vision: process.env.GROQ_VISION_MODEL ?? "qwen/qwen3.8-27b",
};

export const PROVIDERS: Record<ProviderId, Provider> = {
  groq: {
    id: "groq",
    name: "Groq",
    blurb: "Fast open models, with a free tier.",
    baseUrl: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_…",
    keyPrefix: "gsk_",
    defaults: GROQ_DEFAULTS,
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    blurb: "GPT models, billed to your OpenAI account.",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    keyPrefix: "sk-",
    defaults: { chat: "gpt-5-mini", fast: "gpt-5-nano", vision: "gpt-5-mini" },
    prefer: {
      chat: [/^gpt-[\d.]+-mini$/],
      fast: [/^gpt-[\d.]+-nano$/, /^gpt-[\d.]+-mini$/],
      vision: [/^gpt-[\d.]+-mini$/],
    },
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    blurb: "Claude, billed to your Anthropic account.",
    baseUrl: "https://api.anthropic.com/v1",
    keyUrl: "https://platform.claude.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    keyPrefix: "sk-ant-",
    defaults: { chat: "claude-opus-5-5", fast: "claude-haiku-5-5", vision: "claude-opus-5-5" },
    prefer: {
      chat: [/^claude-opus-5-5$/, /^claude-opus-[\d-]+$/, /^claude-sonnet-[\d-]+$/],
      fast: [/^claude-haiku-5-5$/, /^claude-haiku-[\d-]+$/, /^claude-sonnet-[\d-]+$/],
      vision: [/^claude-opus-5-5$/, /^claude-opus-[\d-]+$/, /^claude-sonnet-[\d-]+$/],
    },
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    blurb: "Gemini models, with a free tier in AI Studio.",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    keyPrefix: null,
    defaults: { chat: "gemini-2.5-flash", fast: "gemini-2.5-flash-lite", vision: "gemini-2.5-flash" },
    prefer: {
      chat: [/^gemini-[\d.]+-flash$/],
      fast: [/^gemini-[\d.]+-flash-lite$/, /^gemini-[\d.]+-flash$/],
      vision: [/^gemini-[\d.]+-flash$/],
    },
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    blurb: "One account for hundreds of models, paid from your OpenRouter credits.",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/settings/keys",
    keyPlaceholder: "sk-or-…",
    keyPrefix: "sk-or-",
    // Chat and fast stay on the small general models. Region capture needs a
    // vision-language model: Qwen3-VL Instruct reads figures, tables and
    // equations, and its weights are published. The 30B instruct is the one
    // connected for that job; a newer id of the same kind wins when present.
    defaults: { chat: "google/gemini-2.5-flash", fast: "google/gemini-2.5-flash-lite", vision: "qwen/qwen3-vl-30b-a3b-instruct" },
    prefer: {
      chat: [/^google\/gemini-[\d.]+-flash$/, /^openai\/gpt-[\d.]+-mini$/],
      fast: [/^google\/gemini-[\d.]+-flash-lite$/, /^openai\/gpt-[\d.]+-nano$/],
      vision: [/^qwen\/qwen3-vl-30b-a\d+b-instruct$/, /^qwen\/qwen3-vl-\d+b-a\d+b-instruct$/, /^qwen\/qwen3-vl-.+-instruct$/, /^qwen\/qwen[\d.]+-vl-.+-instruct$/],
    },
  },
  custom: {
    id: "custom",
    name: "Other (OpenAI-compatible)",
    blurb: "Any server with an OpenAI-style API: Ollama, LM Studio, vLLM, DeepSeek, Mistral…",
    baseUrl: "",
    keyUrl: null,
    keyPlaceholder: "API key (leave empty if the server needs none)",
    keyPrefix: null,
    defaults: { chat: "", fast: "", vision: "" },
  },
};

export const PROVIDER_ORDER: ProviderId[] = ["groq", "openrouter", "openai", "anthropic", "gemini", "custom"];

export const isProviderId = (v: unknown): v is ProviderId => typeof v === "string" && v in PROVIDERS;

// A quick shape check before asking the provider. Returns what's wrong, or null.
export function keyProblem(provider: ProviderId, key: string): string | null {
  const p = PROVIDERS[provider];
  if (!key) return provider === "custom" ? null : `Paste your ${p.name} API key.`;
  if (/\s/.test(key)) return "An API key has no spaces in it. Copy it again.";
  if (key.length > 400) return "That's too long to be an API key.";
  if (provider === "custom") return null;
  if (key.length < 20) return `That's too short to be a ${p.name} API key.`;
  // OpenAI keys start with sk-, but so do Anthropic's and OpenRouter's.
  if (provider === "openai" && /^sk-(ant|or)-/.test(key)) return `That's an ${key.startsWith("sk-ant-") ? "Anthropic" : "OpenRouter"} key. Pick that provider above.`;
  if (p.keyPrefix && !key.startsWith(p.keyPrefix)) return `That doesn't look like a ${p.name} API key. They start with ${p.keyPrefix}`;
  return null;
}

// How a saved key is shown: never the key, only its kind and last four.
export function keyLabel(provider: ProviderId, last4: string, via: "key" | "oauth" = "key"): string {
  if (via === "oauth") return `${PROVIDERS[provider].name} (connected)`;
  if (!last4) return `${PROVIDERS[provider].name} (no key)`;
  const prefix = PROVIDERS[provider].keyPrefix ?? "";
  return `${prefix}••••${last4}`;
}

// A short name for the tutor bar: "Groq", "Claude", "OpenRouter".
const SHORT: Record<ProviderId, string> = { groq: "Groq", openai: "OpenAI", anthropic: "Claude", gemini: "Gemini", openrouter: "OpenRouter", custom: "Own server" };
export const keyTag = (provider: ProviderId) => SHORT[provider];

// The best model for a role from a provider's live list.
export function pickModel(provider: ProviderId, role: keyof ModelRoles, available: string[]): string {
  const p = PROVIDERS[provider];
  const fallback = p.defaults[role];
  if (!available.length) return fallback;
  // Groq's defaults are Confu's own (and env-configurable); Anthropic's are pinned on purpose.
  const pinned = provider === "groq" || provider === "anthropic";
  if (pinned && available.includes(fallback)) return fallback;
  for (const pattern of p.prefer?.[role] ?? []) {
    const matches = available.filter((id) => pattern.test(id)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (matches[0]) return matches[0];
  }
  if (available.includes(fallback)) return fallback;
  return provider === "custom" ? available[0] : fallback;
}

export function pickModels(provider: ProviderId, available: string[]): ModelRoles {
  return { chat: pickModel(provider, "chat", available), fast: pickModel(provider, "fast", available), vision: pickModel(provider, "vision", available) };
}

export const MODEL_ID = /^[\w.:/@+-]{1,200}$/;

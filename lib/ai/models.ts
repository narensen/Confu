import "server-only";
import { anthropicModels, isAnthropicAuthError } from "./anthropic";
import { BaseUrlError, checkBaseUrl } from "./openai-compat";
import { PROVIDERS, type ProviderId } from "./providers";

// Ask a provider which models a key can use. This is also how a key is
// checked before it's saved: a rejected key can't list models.

export type ModelList = { ok: true; models: string[]; baseUrl: string } | { ok: false; error: string; rejected?: boolean };

// Not chat models: speech, images, embeddings, moderation and the like.
const NOT_CHAT = /embed|whisper|tts|transcri|dall-e|gpt-image|image-|imagen|veo|sora|moderation|guard|realtime|audio|search-preview|computer-use|babbage|davinci|aqa|orpheus|playai|lyria/i;

export async function listModels(provider: ProviderId, key: string, rawBaseUrl = ""): Promise<ModelList> {
  const name = PROVIDERS[provider].name;
  let baseUrl = PROVIDERS[provider].baseUrl;
  if (provider === "custom") {
    try {
      baseUrl = await checkBaseUrl(rawBaseUrl);
    } catch (err) {
      return { ok: false, error: err instanceof BaseUrlError ? err.message : "Check the server's address." };
    }
  }

  try {
    if (provider === "anthropic") return { ok: true, models: await anthropicModels(key), baseUrl };

    const auth: HeadersInit = key ? { Authorization: `Bearer ${key}` } : {};
    // OpenRouter lists models to anyone, so check the key on its own.
    if (provider === "openrouter") {
      const check = await fetch(`${baseUrl}/key`, { headers: auth, signal: AbortSignal.timeout(15_000) });
      if (check.status === 401 || check.status === 403) return { ok: false, error: `${name} rejected this key.`, rejected: true };
      if (!check.ok) return { ok: false, error: `Couldn't reach ${name} to check the key. Try again.` };
    }

    const res = await fetch(`${baseUrl}/models`, { headers: auth, signal: AbortSignal.timeout(15_000), ...(provider === "custom" ? { redirect: "error" as const } : {}) });
    if (res.status === 401 || res.status === 403) return { ok: false, error: `${name === PROVIDERS.custom.name ? "The server" : name} rejected this key.`, rejected: true };
    // Some model servers have no list. The key can't be checked, but it may well work.
    if (provider === "custom" && res.status === 404) return { ok: true, models: [], baseUrl };
    if (!res.ok) return { ok: false, error: `${provider === "custom" ? "The server" : name} answered ${res.status}. Check the ${provider === "custom" ? "address and " : ""}key, then try again.` };

    type Row = { id?: string; architecture?: { output_modalities?: string[] } };
    const json = (await res.json()) as { data?: Row[] } | Row[];
    const rows: Row[] = Array.isArray(json) ? json : (json.data ?? []);
    const ids = rows
      // OpenRouter says what a model can output; keep the ones that write text.
      .filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes("text"))
      .map((m) => String(m.id ?? "").replace(/^models\//, ""))
      .filter((id) => id && !NOT_CHAT.test(id));
    return { ok: true, models: [...new Set(ids)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), baseUrl };
  } catch (err) {
    if (isAnthropicAuthError(err)) return { ok: false, error: `${name} rejected this key.`, rejected: true };
    return { ok: false, error: `Couldn't reach ${provider === "custom" ? "the server" : name} to check the key. Try again.` };
  }
}

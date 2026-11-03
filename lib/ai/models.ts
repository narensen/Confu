import "server-only";
import { anthropicModels, isAnthropicAuthError } from "./anthropic";
import { BaseUrlError, checkBaseUrl } from "./openai-compat";
import { PROVIDERS, type ListedModel, type ProviderId } from "./providers";

// Ask a provider which models a key can use. This is also how a key is
// checked before it's saved: a rejected key can't list models.

export type ModelList = { ok: true; models: string[]; catalog: ListedModel[]; baseUrl: string } | { ok: false; error: string; rejected?: boolean };

// Not chat models: speech, images, embeddings, moderation and the like.
const NOT_CHAT = /embed|whisper|tts|transcri|dall-e|gpt-image|image-|imagen|veo|sora|moderation|guard|realtime|audio|search-preview|computer-use|babbage|davinci|aqa|orpheus|playai|lyria/i;

type CatalogRow = {
  id?: string;
  hugging_face_id?: string | null;
  description?: string | null;
  architecture?: { input_modalities?: string[]; output_modalities?: string[]; tokenizer?: string | null };
};

// OpenRouter records a Hugging Face id when the weights are published. A few
// open-weight models omit it and say so in the description instead. Routers
// (tokenizer "Router") are not a model a student can choose.
const OPEN_WEIGHT = /\b(open[- ]weights?|open[- ]source|apache[- ]2\.0)\b/i;

export function isOpenWeight(row: CatalogRow): boolean {
  if (row.architecture?.tokenizer === "Router") return false;
  const hf = typeof row.hugging_face_id === "string" ? row.hugging_face_id.trim() : "";
  if (hf) return true;
  return OPEN_WEIGHT.test(row.description ?? "");
}

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
    if (provider === "anthropic") {
      const models = await anthropicModels(key);
      return { ok: true, models, catalog: models.map((id) => ({ id, open: null, vision: null, free: null })), baseUrl };
    }

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
    if (provider === "custom" && res.status === 404) return { ok: true, models: [], catalog: [], baseUrl };
    if (!res.ok) return { ok: false, error: `${provider === "custom" ? "The server" : name} answered ${res.status}. Check the ${provider === "custom" ? "address and " : ""}key, then try again.` };

    const json = (await res.json()) as { data?: CatalogRow[] } | CatalogRow[];
    const rows: CatalogRow[] = Array.isArray(json) ? json : (json.data ?? []);
    const catalog: ListedModel[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const id = String(row.id ?? "").replace(/^models\//, "");
      if (!id || seen.has(id) || NOT_CHAT.test(id)) continue;
      // OpenRouter says what a model can output; keep the ones that write text.
      const outs = row.architecture?.output_modalities;
      if (outs && !outs.includes("text")) continue;
      const inputs = row.architecture?.input_modalities;
      seen.add(id);
      catalog.push({
        id,
        open: provider === "openrouter" ? isOpenWeight(row) : null,
        vision: inputs ? inputs.includes("image") : null,
        free: provider === "openrouter" ? id.endsWith(":free") : null,
      });
    }
    catalog.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    return { ok: true, models: catalog.map((m) => m.id), catalog, baseUrl };
  } catch (err) {
    if (isAnthropicAuthError(err)) return { ok: false, error: `${name} rejected this key.`, rejected: true };
    return { ok: false, error: `Couldn't reach ${provider === "custom" ? "the server" : name} to check the key. Try again.` };
  }
}

import type { Connection } from "@confu/ai/connection";
import { listModels } from "@confu/ai/models";
import { isProviderId, keyProblem, MODEL_ID, PROVIDERS, pickModels, type ModelRoles, type ProviderId } from "@confu/ai/providers";
import { openSecret, sealSecret, type KeySource } from "@confu/storage/keys";
import type { Store } from "@confu/storage/store";

// The student's AI on this device: keys checked with their provider, sealed
// (see @confu/storage/keys) and stored in the device-only ai_keys table.
// A session can have its own key; otherwise the account's is used.

export type DeviceKeyInfo = {
  id: string;
  source: "session" | "account";
  provider: ProviderId;
  last4: string;
  via: "key" | "oauth";
  models: ModelRoles;
  host: string | null;
};

type KeyRow = {
  id: string;
  session_id: string | null;
  provider: string;
  secret: string;
  last4: string;
  base_url: string | null;
  chat_model: string | null;
  fast_model: string | null;
  vision_model: string | null;
  via: string;
};

export type AddKey = { provider: string; key: string; baseUrl?: string; sessionId?: string | null; via?: "key" | "oauth" };
export type AddResult = { ok: true; info: DeviceKeyInfo; models: string[] } | { ok: false; error: string };

const providerOf = (r: KeyRow): ProviderId => (isProviderId(r.provider) ? r.provider : "groq");

function modelsOf(r: KeyRow): ModelRoles {
  const d = PROVIDERS[providerOf(r)].defaults;
  const chat = r.chat_model || d.chat;
  return { chat, fast: r.fast_model || d.fast || chat, vision: r.vision_model || d.vision || chat };
}

function hostOf(url: string | null) {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

export class DeviceKeys {
  constructor(
    private readonly store: Store,
    private readonly sealingKey: KeySource,
  ) {}

  private async row(sessionId: string | null): Promise<KeyRow | null> {
    if (sessionId) {
      const [own] = await this.store.list<KeyRow>("ai_keys", { session_id: sessionId }, { limit: 1 });
      if (own) return own;
    }
    const [account] = await this.store.list<KeyRow>("ai_keys", { session_id: null }, { limit: 1 });
    return account ?? null;
  }

  private info(r: KeyRow): DeviceKeyInfo {
    return { id: r.id, source: r.session_id ? "session" : "account", provider: providerOf(r), last4: r.last4, via: r.via === "oauth" ? "oauth" : "key", models: modelsOf(r), host: hostOf(r.base_url) };
  }

  async get(sessionId: string | null = null): Promise<DeviceKeyInfo | null> {
    const r = await this.row(sessionId);
    return r ? this.info(r) : null;
  }

  // Check the key with its provider (by listing the models it can use),
  // pick a model for each job, seal and store it.
  async add(input: AddKey): Promise<AddResult> {
    const provider = input.provider;
    const key = input.key.trim();
    if (!isProviderId(provider)) return { ok: false, error: "Pick a provider." };
    const problem = keyProblem(provider, key);
    if (problem) return { ok: false, error: problem };
    const list = await listModels(provider, key, input.baseUrl ?? "");
    if (!list.ok) return { ok: false, error: list.error };
    const models = pickModels(provider, list.models);
    if (provider === "custom" && !models.chat) return { ok: false, error: "That server didn't list any models. Check the address." };

    const sessionId = input.sessionId ?? null;
    await this.remove(sessionId);
    const id = crypto.randomUUID();
    await this.store.put("ai_keys", {
      id,
      session_id: sessionId,
      provider,
      secret: await sealSecret(await this.sealingKey(), key, id),
      last4: key.slice(-4),
      base_url: provider === "custom" ? list.baseUrl : null,
      chat_model: models.chat || null,
      fast_model: models.fast || null,
      vision_model: models.vision || null,
      via: input.via ?? "key",
    });
    const info = await this.get(sessionId);
    return info ? { ok: true, info, models: list.models } : { ok: false, error: "Couldn't save the key." };
  }

  async remove(sessionId: string | null = null): Promise<void> {
    for (const r of await this.store.list<KeyRow>("ai_keys", { session_id: sessionId })) await this.store.remove("ai_keys", { id: r.id });
  }

  async setModels(sessionId: string | null, models: ModelRoles): Promise<DeviceKeyInfo | null> {
    if (![models.chat, models.fast, models.vision].every((m) => MODEL_ID.test(m))) throw new Error("A model name has characters a model name can't have.");
    const [r] = await this.store.list<KeyRow>("ai_keys", { session_id: sessionId }, { limit: 1 });
    if (!r) return null;
    await this.store.put("ai_keys", { id: r.id, chat_model: models.chat, fast_model: models.fast, vision_model: models.vision });
    return this.get(sessionId);
  }

  // The decrypted connection for a session, or null when there's no key
  // (or it can't be opened on this device any more).
  async connection(sessionId: string | null = null): Promise<Connection | null> {
    const r = await this.row(sessionId);
    if (!r) return null;
    try {
      const provider = providerOf(r);
      return {
        id: r.id,
        provider,
        key: await openSecret(await this.sealingKey(), r.secret, r.id),
        baseUrl: provider === "custom" ? (r.base_url ?? "") : PROVIDERS[provider].baseUrl,
        models: modelsOf(r),
        via: r.via === "oauth" ? "oauth" : "key",
      };
    } catch {
      return null;
    }
  }
}

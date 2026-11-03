"use server";

import { z } from "zod";
import { listModels } from "@/lib/ai/models";
import { isProviderId, keyProblem, MODEL_ID, PROVIDERS, pickModels, type ListedModel, type ModelRoles } from "@/lib/ai/providers";
import { getKeyInfo, loadConnection, removeKey, storeKey, updateModels, type KeyInfo } from "@/lib/ai-keys";
import { isEncryptionConfigured } from "@/lib/crypto";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

const SessionId = z.uuid().nullable();

export type SaveKeyResult = { ok: true; info: KeyInfo; models: string[]; catalog: ListedModel[] } | { ok: false; error: string };

// Check a key with its provider (by listing the models it can use), pick a
// model for each job, then store it encrypted: either as the account default
// (sessionId = null) or for one study session.
export async function saveAiKey(input: { provider: string; key: string; baseUrl?: string; sessionId: string | null }): Promise<SaveKeyResult> {
  const user = await requireUser();
  const provider = input.provider;
  const key = String(input.key ?? "").trim();
  if (!isProviderId(provider)) return { ok: false, error: "Pick a provider." };
  if (!SessionId.safeParse(input.sessionId).success) return { ok: false, error: "Invalid session." };
  const problem = keyProblem(provider, key);
  if (problem) return { ok: false, error: problem };
  if (!isEncryptionConfigured()) return { ok: false, error: "Key storage isn't configured on the server yet (KEY_ENCRYPTION_SECRET)." };

  const list = await listModels(provider, key, String(input.baseUrl ?? ""));
  if (!list.ok) {
    const where = PROVIDERS[provider].keyUrl ? ` Copy it again from ${PROVIDERS[provider].keyUrl.replace(/^https:\/\//, "")}.` : "";
    return { ok: false, error: list.rejected ? `${list.error}${where}` : list.error };
  }
  const models = pickModels(provider, list.models);
  if (provider === "custom" && !models.chat) {
    return { ok: false, error: "That server didn't list any models. Check the address, or ask whoever runs it which model to use." };
  }

  const supabase = await createClient();
  try {
    await storeKey(supabase, user.id, input.sessionId, { provider, key, baseUrl: list.baseUrl, models, via: "key" });
  } catch {
    return { ok: false, error: "Couldn't save the key. Try again." };
  }
  const info = await getKeyInfo(supabase, user.id, input.sessionId);
  return info ? { ok: true, info, models: list.models, catalog: list.catalog } : { ok: false, error: "Couldn't save the key. Try again." };
}

// Remove a stored key. Returns what the session falls back to (if anything).
export async function deleteAiKey(sessionId: string | null): Promise<KeyInfo | null> {
  const user = await requireUser();
  if (!SessionId.safeParse(sessionId).success) return null;
  const supabase = await createClient();
  await removeKey(supabase, user.id, sessionId);
  return getKeyInfo(supabase, user.id, sessionId);
}

// The models a saved key can use, for the model picker.
export async function keyModels(sessionId: string | null): Promise<{ ok: true; models: string[]; catalog: ListedModel[] } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!SessionId.safeParse(sessionId).success) return { ok: false, error: "Invalid session." };
  const supabase = await createClient();
  const conn = await loadConnection(supabase, user.id, sessionId);
  if (!conn) return { ok: false, error: "There's no key saved here." };
  const list = await listModels(conn.provider, conn.key, conn.baseUrl);
  return list.ok ? { ok: true, models: list.models, catalog: list.catalog } : { ok: false, error: list.error };
}

const Models = z.object({ chat: z.string().regex(MODEL_ID), fast: z.string().regex(MODEL_ID), vision: z.string().regex(MODEL_ID) });

export async function saveKeyModels(sessionId: string | null, raw: ModelRoles): Promise<{ ok: true; info: KeyInfo } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!SessionId.safeParse(sessionId).success) return { ok: false, error: "Invalid session." };
  const models = Models.safeParse({ chat: raw?.chat?.trim(), fast: raw?.fast?.trim(), vision: raw?.vision?.trim() });
  if (!models.success) return { ok: false, error: "A model name has characters a model name can't have." };
  const supabase = await createClient();
  try {
    await updateModels(supabase, user.id, sessionId, models.data);
  } catch {
    return { ok: false, error: "Couldn't save the models. Try again." };
  }
  const info = await getKeyInfo(supabase, user.id, sessionId);
  return info ? { ok: true, info } : { ok: false, error: "There's no key saved here." };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Connection } from "@confu/ai/connection";
import { PROVIDERS, isProviderId, type ModelRoles, type ProviderId } from "@confu/ai/providers";
import { seal, unseal } from "@/lib/crypto";

// Each account's own AI (table ai_keys, migration 0042): an API key for a
// provider, or an OpenRouter connection, with the models picked for it.
// Keys are encrypted by the server before they reach the database.

// What the UI may know about a stored key: never the key itself.
// `id` identifies this exact key (replacing a key creates a new id), which is
// what usage is tracked against.
export type KeyInfo = {
  id: string;
  source: "session" | "account";
  provider: ProviderId;
  last4: string;
  via: "key" | "oauth";
  models: ModelRoles;
  host: string | null; // a custom server's host name, for display
};

type Row = {
  id: string;
  session_id: string | null;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  last4: string;
  provider: string;
  base_url: string | null;
  chat_model: string | null;
  fast_model: string | null;
  vision_model: string | null;
  via: string;
};

const COLUMNS = "id, session_id, ciphertext, iv, auth_tag, last4, provider, base_url, chat_model, fast_model, vision_model, via";

const providerOf = (row: Row): ProviderId => (isProviderId(row.provider) ? row.provider : "groq");

// Unset models fall back to the provider's defaults (and the background
// and image jobs to the main model, which every provider's main models do).
function modelsOf(row: Row): ModelRoles {
  const d = PROVIDERS[providerOf(row)].defaults;
  const chat = row.chat_model || d.chat;
  return { chat, fast: row.fast_model || d.fast || chat, vision: row.vision_model || d.vision || chat };
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function info(row: Row): KeyInfo {
  return {
    id: row.id,
    source: row.session_id ? "session" : "account",
    provider: providerOf(row),
    last4: row.last4,
    via: row.via === "oauth" ? "oauth" : "key",
    models: modelsOf(row),
    host: hostOf(row.base_url),
  };
}

// The session's own key wins over the account key.
async function findRow(supabase: SupabaseClient, userId: string, sessionId: string | null): Promise<Row | null> {
  const { data } = await supabase
    .from("ai_keys")
    .select(COLUMNS)
    .eq("user_id", userId)
    .or(sessionId ? `session_id.is.null,session_id.eq.${sessionId}` : "session_id.is.null");
  const rows = (data ?? []) as Row[];
  return rows.find((r) => r.session_id && r.session_id === sessionId) ?? rows.find((r) => !r.session_id) ?? null;
}

export async function getKeyInfo(supabase: SupabaseClient, userId: string, sessionId: string | null): Promise<KeyInfo | null> {
  const row = await findRow(supabase, userId, sessionId);
  return row ? info(row) : null;
}

// Only the keys saved for single sessions (Settings lists them).
export async function sessionKeyInfos(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("ai_keys")
    .select(`${COLUMNS}, study_sessions(title)`)
    .eq("user_id", userId)
    .not("session_id", "is", null);
  return ((data ?? []) as unknown as (Row & { study_sessions: { title: string } | null })[]).map((r) => ({
    ...info(r),
    sessionId: r.session_id as string,
    title: r.study_sessions?.title ?? "Untitled session",
  }));
}

export async function loadConnection(supabase: SupabaseClient, userId: string, sessionId: string | null): Promise<Connection | null> {
  const row = await findRow(supabase, userId, sessionId);
  if (!row) return null;
  try {
    const provider = providerOf(row);
    return {
      id: row.id,
      provider,
      key: unseal(row, userId),
      baseUrl: provider === "custom" ? (row.base_url ?? "") : PROVIDERS[provider].baseUrl,
      models: modelsOf(row),
      via: row.via === "oauth" ? "oauth" : "key",
    };
  } catch {
    // Wrong or rotated encryption secret: treat as missing so the user re-enters it.
    return null;
  }
}

export type NewKey = { provider: ProviderId; key: string; baseUrl: string | null; models: ModelRoles; via: "key" | "oauth" };

export async function storeKey(supabase: SupabaseClient, userId: string, sessionId: string | null, k: NewKey) {
  await removeKey(supabase, userId, sessionId);
  const { error } = await supabase.from("ai_keys").insert({
    user_id: userId,
    session_id: sessionId,
    ...seal(k.key, userId),
    last4: k.key.slice(-4),
    provider: k.provider,
    base_url: k.provider === "custom" ? k.baseUrl : null,
    chat_model: k.models.chat || null,
    fast_model: k.models.fast || null,
    vision_model: k.models.vision || null,
    via: k.via,
  });
  if (error) throw new Error(error.message);
}

export async function updateModels(supabase: SupabaseClient, userId: string, sessionId: string | null, models: ModelRoles) {
  const query = supabase
    .from("ai_keys")
    .update({ chat_model: models.chat, fast_model: models.fast, vision_model: models.vision })
    .eq("user_id", userId);
  const { error } = await (sessionId ? query.eq("session_id", sessionId) : query.is("session_id", null));
  if (error) throw new Error(error.message);
}

export async function removeKey(supabase: SupabaseClient, userId: string, sessionId: string | null) {
  const query = supabase.from("ai_keys").delete().eq("user_id", userId);
  await (sessionId ? query.eq("session_id", sessionId) : query.is("session_id", null));
}

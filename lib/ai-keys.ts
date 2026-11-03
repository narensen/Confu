import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seal, unseal } from "@/lib/crypto";

// What the UI may know about a stored key: never the key itself.
// `id` identifies this exact key (replacing a key creates a new id), which is
// what usage is tracked against.
export type KeyInfo = { id: string; source: "session" | "account"; last4: string };

type Row = { id: string; session_id: string | null; ciphertext: string; iv: string; auth_tag: string; last4: string };

// The session's own key wins over the account key.
async function findRow(supabase: SupabaseClient, userId: string, sessionId: string | null): Promise<Row | null> {
  const { data } = await supabase
    .from("groq_keys")
    .select("id, session_id, ciphertext, iv, auth_tag, last4")
    .eq("user_id", userId)
    .or(sessionId ? `session_id.is.null,session_id.eq.${sessionId}` : "session_id.is.null");
  const rows = (data ?? []) as Row[];
  return rows.find((r) => r.session_id && r.session_id === sessionId) ?? rows.find((r) => !r.session_id) ?? null;
}

export async function getKeyInfo(supabase: SupabaseClient, userId: string, sessionId: string | null): Promise<KeyInfo | null> {
  const row = await findRow(supabase, userId, sessionId);
  return row ? { id: row.id, source: row.session_id ? "session" : "account", last4: row.last4 } : null;
}

export async function loadKey(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string | null,
): Promise<{ id: string; key: string; source: KeyInfo["source"] } | null> {
  const row = await findRow(supabase, userId, sessionId);
  if (!row) return null;
  try {
    return { id: row.id, key: unseal(row, userId), source: row.session_id ? "session" : "account" };
  } catch {
    // Wrong or rotated encryption secret: treat as missing so the user re-enters it.
    return null;
  }
}

export async function storeKey(supabase: SupabaseClient, userId: string, sessionId: string | null, key: string) {
  await removeKey(supabase, userId, sessionId);
  const { error } = await supabase.from("groq_keys").insert({
    user_id: userId,
    session_id: sessionId,
    ...seal(key, userId),
    last4: key.slice(-4),
  });
  if (error) throw new Error(error.message);
}

export async function removeKey(supabase: SupabaseClient, userId: string, sessionId: string | null) {
  const query = supabase.from("groq_keys").delete().eq("user_id", userId);
  await (sessionId ? query.eq("session_id", sessionId) : query.is("session_id", null));
}

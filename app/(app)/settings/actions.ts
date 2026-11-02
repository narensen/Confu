"use server";

import { z } from "zod";
import { looksLikeGroqKey } from "@/lib/ai-key";
import { isEncryptionConfigured } from "@/lib/crypto";
import { requireUser } from "@/lib/dal";
import { groqClient } from "@/lib/groq";
import { getKeyInfo, removeKey, storeKey, type KeyInfo } from "@/lib/groq-keys";
import { createClient } from "@/lib/supabase/server";

const SessionId = z.uuid().nullable();

export type SaveKeyResult = { ok: true; info: KeyInfo } | { ok: false; error: string };

// Verify a Groq key with Groq, then store it encrypted, either as the account
// default (sessionId = null) or for one study session.
export async function saveGroqKey(rawKey: string, sessionId: string | null): Promise<SaveKeyResult> {
  const user = await requireUser();
  const key = String(rawKey ?? "").trim();
  if (!SessionId.safeParse(sessionId).success) return { ok: false, error: "Invalid session." };
  if (!looksLikeGroqKey(key)) return { ok: false, error: "That doesn't look like a Groq API key. They start with gsk_." };
  if (!isEncryptionConfigured()) return { ok: false, error: "Key storage isn't configured on the server yet (KEY_ENCRYPTION_SECRET)." };

  try {
    await groqClient(key).models.list();
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 401 || status === 403) return { ok: false, error: "Groq rejected this key. Copy it again from console.groq.com/keys." };
    return { ok: false, error: "Couldn't reach Groq to check the key. Try again." };
  }

  const supabase = await createClient();
  try {
    await storeKey(supabase, user.id, sessionId, key);
  } catch {
    return { ok: false, error: "Couldn't save the key. Try again." };
  }
  const info = await getKeyInfo(supabase, user.id, sessionId);
  return info ? { ok: true, info } : { ok: false, error: "Couldn't save the key. Try again." };
}

// Remove a stored key. Returns what the session falls back to (if anything).
export async function deleteGroqKey(sessionId: string | null): Promise<KeyInfo | null> {
  const user = await requireUser();
  if (!SessionId.safeParse(sessionId).success) return null;
  const supabase = await createClient();
  await removeKey(supabase, user.id, sessionId);
  return getKeyInfo(supabase, user.id, sessionId);
}

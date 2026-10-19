"use client";

import { useSyncExternalStore } from "react";
import { GROQ_KEY_HEADER, KEY_ERRORS } from "@/lib/ai-key";

// A user's Groq key lives only in this browser, one per study session. It is
// sent with each AI request and never stored on the server.
const PREFIX = "confu:groq-key:";
const memory = new Map<string, string>(); // fallback when storage is blocked
const notices = new Map<string, string>(); // why a key was cleared, shown in the gate
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith(PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getKey(sessionId: string): string | null {
  try {
    const stored = localStorage.getItem(PREFIX + sessionId);
    if (stored) return stored;
  } catch {}
  return memory.get(sessionId) ?? null;
}

export function saveKey(sessionId: string, key: string) {
  memory.set(sessionId, key);
  try {
    localStorage.setItem(PREFIX + sessionId, key);
  } catch {}
  notices.delete(sessionId);
  emit();
}

export function forgetKey(sessionId: string, notice?: string) {
  memory.delete(sessionId);
  try {
    localStorage.removeItem(PREFIX + sessionId);
  } catch {}
  if (notice) notices.set(sessionId, notice);
  emit();
}

export function keyNotice(sessionId: string) {
  return notices.get(sessionId) ?? null;
}

// Server render has no key; the real value is read after hydration.
export function useSessionKey(sessionId: string) {
  return useSyncExternalStore(
    subscribe,
    () => getKey(sessionId),
    () => null,
  );
}

export function aiHeaders(sessionId: string): Record<string, string> {
  const key = getKey(sessionId);
  return { "Content-Type": "application/json", ...(key ? { [GROQ_KEY_HEADER]: key } : {}) };
}

// Read an API error. If it says the key is missing or rejected, forget the
// key so the session asks for a new one.
export async function readAiError(sessionId: string, res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let message = text || `Request failed (${res.status})`;
  let code: string | undefined;
  try {
    const json = JSON.parse(text) as { error?: string; code?: string };
    message = json.error ?? message;
    code = json.code;
  } catch {}
  if (code === KEY_ERRORS.invalid || code === KEY_ERRORS.required) forgetKey(sessionId, message);
  return message;
}

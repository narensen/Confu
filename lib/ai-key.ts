// Shared between client and server: how a user's own Groq key travels.
export const GROQ_KEY_HEADER = "x-groq-key";

export const KEY_ERRORS = {
  required: "GROQ_KEY_REQUIRED",
  invalid: "GROQ_KEY_INVALID",
} as const;

export function looksLikeGroqKey(key: string) {
  return /^gsk_[A-Za-z0-9]{20,}$/.test(key);
}

"use client";

import { KEY_ERRORS } from "@/lib/ai-key";

export const KEY_ERROR_EVENT = "confu:key-error";
export const JSON_HEADERS = { "Content-Type": "application/json" };

// Read an API error message. If it says the Groq key is missing or was
// rejected, announce it so the workspace can ask for a key.
export async function readAiError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let message = text || `Request failed (${res.status})`;
  let code: string | undefined;
  try {
    const json = JSON.parse(text) as { error?: string; code?: string };
    message = json.error ?? message;
    code = json.code;
  } catch {}
  if (code === KEY_ERRORS.invalid || code === KEY_ERRORS.required) {
    window.dispatchEvent(new CustomEvent(KEY_ERROR_EVENT, { detail: { message, code } }));
  }
  return message;
}

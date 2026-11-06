import "server-only";
import Groq from "groq-sdk";
import { stripReasoning } from "@/lib/visible-text";

export type { Groq };
export { stripReasoning };

// The server's own key, used only for admin accounts. Prefer the server-only
// GROQ_API_KEY; NEXT_PUBLIC_GROQ_API_KEY is accepted as a fallback but is only
// ever read here, on the server.
export const SERVER_GROQ_KEY = process.env.GROQ_API_KEY ?? process.env.NEXT_PUBLIC_GROQ_API_KEY;

// `fetchImpl` lets a usage meter observe every request (see lib/usage.ts).
export function groqClient(apiKey: string, fetchImpl?: typeof fetch) {
  return new Groq({ apiKey, maxRetries: 1, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

export const MODELS = {
  // Tutor answers and plan generation.
  chat: process.env.GROQ_CHAT_MODEL ?? "openai/gpt-oss-120b",
  // Cheap background work: updating learner memory.
  fast: process.env.GROQ_FAST_MODEL ?? "openai/gpt-oss-20b",
  // Vision-language model for figures, tables and equations.
  vision: process.env.GROQ_VISION_MODEL ?? "qwen/qwen3.8-27b",
};

// Parse a JSON object out of a model reply, tolerating code fences and a
// scratchpad that leaked into the text.
export function parseJsonObject(text: string): unknown {
  const cleaned = stripReasoning(text).trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Model did not return JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Reasoning tokens count toward max_completion_tokens and toward the bill.
// gpt-oss cannot turn reasoning off; "low" is its shortest setting, and
// include_reasoning false keeps the scratchpad out of the reply (it must not
// be combined with reasoning_format, which gpt-oss does not support).
// Qwen can be told "none", which spends no reasoning tokens at all. "hidden"
// is a backstop so a scratchpad cannot land in a page transcript.
export function modelBudget(model: string, maxTokens: number, effort: "low" | "medium" = "low") {
  if (/qwen/i.test(model)) {
    return {
      max_completion_tokens: maxTokens,
      reasoning_effort: "none" as const,
      reasoning_format: "hidden" as const,
    };
  }
  return {
    max_completion_tokens: maxTokens,
    reasoning_effort: effort,
    include_reasoning: false as const,
  };
}

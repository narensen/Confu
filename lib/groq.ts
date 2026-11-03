import "server-only";
import Groq from "groq-sdk";
import { PROVIDERS } from "@/lib/ai/providers";
import { stripReasoning } from "@/lib/visible-text";

export type { Groq };
export { stripReasoning };

// `fetchImpl` lets a usage meter observe every request (see lib/usage.ts).
export function groqClient(apiKey: string, fetchImpl?: typeof fetch) {
  return new Groq({ apiKey, maxRetries: 1, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

// The model for each job, named by call sites: the server's Groq models
// (GROQ_*_MODEL to override). On a student's own AI each one stands for the
// model they picked for that job (lib/ai/connection.ts).
//   chat:   tutor answers, plans, practice, marking
//   fast:   cheap background work: updating learner memory
//   vision: figures, tables, equations and scanned pages
export const MODELS = PROVIDERS.groq.defaults;

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

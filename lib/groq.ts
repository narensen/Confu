import "server-only";
import Groq from "groq-sdk";

// Prefer a server-only GROQ_API_KEY. NEXT_PUBLIC_GROQ_API_KEY is accepted as a
// fallback but is only ever read on the server here; rename it so it can never
// be inlined into a client bundle.
const apiKey = process.env.GROQ_API_KEY ?? process.env.NEXT_PUBLIC_GROQ_API_KEY;

export const groq = new Groq({ apiKey });

export const MODELS = {
  // Tutor answers and plan generation.
  chat: process.env.GROQ_CHAT_MODEL ?? "openai/gpt-oss-120b",
  // Cheap background work: updating learner memory.
  fast: process.env.GROQ_FAST_MODEL ?? "openai/gpt-oss-20b",
  // Vision-language model for figures, tables and equations.
  vision: process.env.GROQ_VISION_MODEL ?? "qwen/qwen3.8-27b",
};

// Parse a JSON object out of a model reply, tolerating code fences.
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Model did not return JSON");
  return JSON.parse(text.slice(start, end + 1));
}

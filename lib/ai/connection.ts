import "server-only";
import { MODELS } from "@/lib/groq";
import { anthropicFetch } from "./anthropic";
import { openAiCompatFetch } from "./openai-compat";
import type { ModelRoles, ProviderId } from "./providers";

// A student's own AI, ready to use: the provider, the decrypted key, where
// to send requests, and the models picked for each job.
export type Connection = {
  id: string; // the stored key's id (usage is counted per key)
  provider: ProviderId;
  key: string;
  baseUrl: string;
  models: ModelRoles;
  via: "key" | "oauth";
};

// Call sites name a model by its job: MODELS.chat, MODELS.fast and
// MODELS.vision (the server's Groq defaults). On a student's connection
// each one becomes the model they picked for that job.
export function withModels(models: ModelRoles, next: typeof fetch): typeof fetch {
  const roles: [string, keyof ModelRoles][] = [
    [MODELS.chat, "chat"],
    [MODELS.vision, "vision"],
    [MODELS.fast, "fast"],
  ];
  return (input, init) => {
    if (typeof init?.body !== "string") return next(input, init);
    try {
      const body = JSON.parse(init.body) as { model?: string };
      const role = roles.find(([id]) => id === body.model)?.[1];
      if (role && models[role] && models[role] !== body.model) {
        return next(input, { ...init, body: JSON.stringify({ ...body, model: models[role] }) });
      }
    } catch {}
    return next(input, init);
  };
}

// Where a connection's requests go.
export function transportFor(conn: Connection): typeof fetch {
  return conn.provider === "anthropic" ? anthropicFetch(conn) : openAiCompatFetch(conn);
}

// Providers that report rate limits in OpenAI-style x-ratelimit headers.
export const reportsLimits = (provider: ProviderId) => provider === "groq" || provider === "openai";

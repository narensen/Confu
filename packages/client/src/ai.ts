import { transportFor, withModels, type Connection } from "@confu/ai/connection";
import { groqClient, type Groq } from "@confu/ai/groq";
import { describeAiError } from "@confu/ai/errors";
import { meteredFetch } from "@confu/ai/meter";
import type { ProviderId } from "@confu/ai/providers";
import type { Store } from "@confu/storage/store";
import type { DeviceKeys } from "./keys";

// An AI client for a session, straight from this device to the student's
// provider, with every request's tokens recorded in ai_usage.

export type Feature = "chat" | "plan" | "figure" | "quiz" | "grade" | "triage" | "pass1" | "probe" | "ocr" | "recommend" | "related" | "compare";
export type DeviceAi = { groq: Groq; provider: ProviderId; keyId: string };

export async function deviceAi(store: Store, keys: DeviceKeys, sessionId: string | null, feature: Feature): Promise<DeviceAi | null> {
  const conn = await keys.connection(sessionId);
  return conn ? aiFor(store, conn, sessionId, feature) : null;
}

// The same, for a given connection (e.g. the Groq voice key standing in).
export function aiFor(store: Store, conn: Connection, sessionId: string | null, feature: Feature): DeviceAi {
  const record = meteredFetch(transportFor(conn), (u) => {
    void store.put("ai_usage", {
      session_id: sessionId,
      key_ref: `key:${conn.id}`,
      model: u.model,
      feature,
      prompt_tokens: u.promptTokens,
      completion_tokens: u.completionTokens,
      total_tokens: u.totalTokens,
    });
  });
  // Call sites name a job's model (MODELS.chat …); withModels swaps in the
  // student's choice before the meter sees the request.
  return { groq: groqClient("connection", withModels(conn.models, record)), provider: conn.provider, keyId: conn.id };
}

// An AI request, with a failure put in words for the student (a busy free
// model, a rejected key, no credit) instead of the provider's raw reply.
export async function aiRequest<T>(request: Promise<T>, fallback: string): Promise<T> {
  try {
    return await request;
  } catch (err) {
    throw new Error(describeAiError(err, fallback).error);
  }
}

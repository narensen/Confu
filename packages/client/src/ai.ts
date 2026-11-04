import { transportFor, withModels } from "@confu/ai/connection";
import { groqClient, type Groq } from "@confu/ai/groq";
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
  if (!conn) return null;
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

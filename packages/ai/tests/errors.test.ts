import { describe, expect, test } from "bun:test";
import { describeAiError } from "../src/errors";

const err = (status: number, message: string, provider: string) => ({ status, message, headers: new Headers({ "x-confu-provider": provider }) });

describe("describeAiError", () => {
  test("a busy OpenRouter free model is named, with what to do", () => {
    // What OpenRouter sends when a :free model's shared pool is full.
    const raw =
      '429 {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemma-4-31b-it:free is temporarily rate-limited upstream. Please retry shortly","limit_source":"upstream_provider_shared_pool"}}}';
    const p = describeAiError(err(429, raw, "openrouter"), "fallback");
    expect(p.code).toBe("FREE_MODEL_BUSY");
    expect(p.error).toContain("google/gemma-4-31b-it:free");
    expect(p.error).toContain("Your AI");
  });

  test("other rate limits keep the general message", () => {
    expect(describeAiError(err(429, "Rate limit reached for requests", "openai"), "fallback").error).toBe("OpenAI's rate limit was reached. Wait a minute and try again.");
  });
});

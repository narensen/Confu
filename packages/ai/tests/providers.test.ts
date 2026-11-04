import { describe, expect, test } from "bun:test";
import { keyLabel, keyProblem, pickModels } from "@confu/ai/providers";

describe("keyProblem", () => {
  test("accepts well-formed keys", () => {
    expect(keyProblem("groq", "gsk_" + "a".repeat(40))).toBeNull();
    expect(keyProblem("anthropic", "sk-ant-" + "a".repeat(40))).toBeNull();
    expect(keyProblem("custom", "")).toBeNull(); // a local server may need no key
  });
  test("rejects keys for the wrong provider", () => {
    expect(keyProblem("groq", "sk-" + "a".repeat(40))).toMatch(/gsk_/);
    expect(keyProblem("openai", "sk-ant-" + "a".repeat(40))).toMatch(/Anthropic/);
    expect(keyProblem("openai", "sk-or-" + "a".repeat(40))).toMatch(/OpenRouter/);
  });
  test("rejects empty, short and spaced keys", () => {
    expect(keyProblem("openai", "")).not.toBeNull();
    expect(keyProblem("openai", "sk-abc")).not.toBeNull();
    expect(keyProblem("openai", "sk-" + "a".repeat(20) + " " + "b".repeat(5))).not.toBeNull();
  });
});

describe("keyLabel", () => {
  test("never shows more than the last four characters", () => {
    expect(keyLabel("groq", "abcd")).toBe("gsk_••••abcd");
    expect(keyLabel("openrouter", "wxyz", "oauth")).toBe("OpenRouter (connected)");
  });
});

describe("pickModels", () => {
  test("OpenAI: the newest mini and nano", () => {
    const m = pickModels("openai", ["gpt-4.1-mini", "gpt-5-mini", "gpt-5.1-mini", "gpt-5-nano", "gpt-5-mini-2025-08-07"]);
    expect(m.chat).toBe("gpt-5.1-mini");
    expect(m.fast).toBe("gpt-5-nano");
  });
  test("Gemini: the newest flash", () => {
    expect(pickModels("gemini", ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-3-flash", "gemini-2.5-flash-lite"]).chat).toBe("gemini-3-flash");
  });
  test("Anthropic: pinned defaults when the key has them", () => {
    expect(pickModels("anthropic", ["claude-opus-5-5", "claude-haiku-5-5", "claude-sonnet-5-5"])).toEqual({
      chat: "claude-opus-5-5",
      fast: "claude-haiku-5-5",
      vision: "claude-opus-5-5",
    });
  });
  test("custom: the server's first model for every job", () => {
    expect(pickModels("custom", ["llama3.2", "qwen2.5vl"])).toEqual({ chat: "llama3.2", fast: "llama3.2", vision: "llama3.2" });
  });
});

import { describe, expect, test } from "bun:test";
import { adaptBody } from "@confu/ai/openai-compat";
import { modelBudget } from "@confu/ai/groq";

// Call sites build Groq-shaped requests; each provider must get what it accepts.
const groqShape = (model: string, extra: object = {}) =>
  JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], temperature: 0.5, ...modelBudget("openai/gpt-oss-120b", 1800), ...extra });
const adapt = (provider: Parameters<typeof adaptBody>[0], body: string) => JSON.parse(adaptBody(provider, body));

describe("adaptBody", () => {
  test("OpenAI reasoning models: low effort, no temperature, room to think, usage in streams", () => {
    const b = adapt("openai", groqShape("gpt-5-mini", { stream: true }));
    expect(b.reasoning_effort).toBe("low");
    expect(b.temperature).toBeUndefined();
    expect(b.include_reasoning).toBeUndefined();
    expect(b.max_completion_tokens).toBe(1800 + 1024);
    expect(b.stream_options).toEqual({ include_usage: true });
  });
  test("OpenAI non-reasoning models keep sampling and drop reasoning", () => {
    const b = adapt("openai", groqShape("gpt-4.1-mini"));
    expect(b.reasoning_effort).toBeUndefined();
    expect(b.temperature).toBe(0.5);
    expect(b.max_completion_tokens).toBe(1800);
  });
  test("Gemini uses max_tokens", () => {
    const b = adapt("gemini", groqShape("gemini-2.5-flash"));
    expect(b.max_tokens).toBe(2824);
    expect(b.max_completion_tokens).toBeUndefined();
  });
  test("OpenRouter uses its own reasoning field", () => {
    const b = adapt("openrouter", groqShape("google/gemini-2.5-flash"));
    expect(b.reasoning).toEqual({ effort: "low", exclude: true });
    expect(b.reasoning_effort).toBeUndefined();
  });
  test("custom servers get the widest-supported subset", () => {
    const b = adapt("custom", groqShape("llama3.2", { response_format: { type: "json_object" } }));
    expect(b.response_format).toBeUndefined();
    expect(b.reasoning_effort).toBeUndefined();
    expect(b.max_tokens).toBe(1800);
  });
  test("Groq adapts to the model the student picked", () => {
    expect(adapt("groq", groqShape("qwen/qwen3-32b")).reasoning_effort).toBe("default");
    expect(adapt("groq", groqShape("llama-3.3-70b-versatile")).reasoning_effort).toBeUndefined();
  });
  test("leaves non-JSON bodies alone", () => {
    expect(adaptBody("openai", "not json")).toBe("not json");
  });
});

import { openAiCompatFetch } from "@confu/ai/openai-compat";

describe("openAiCompatFetch", () => {
  const conn = (provider: "custom" | "openrouter", baseUrl: string) => ({ id: "k", provider, key: "k-1", baseUrl, models: { chat: "m", fast: "m", vision: "m" }, via: "key" as const });

  test("the server's guard can refuse a custom address, with a message for the student", async () => {
    const fetchVia = openAiCompatFetch(conn("custom", "http://10.0.0.5/v1"), {
      guard: async () => {
        throw new Error("That address is on a private network.");
      },
    });
    const res = await fetchVia("https://api.groq.com/openai/v1/chat/completions", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    expect(decodeURIComponent(res.headers.get("x-confu-message") ?? "")).toBe("That address is on a private network.");
  });

  test("sends only the allowed headers, plus OpenRouter's attribution", async () => {
    let got: Headers | null = null;
    const server = Bun.serve({ port: 0, fetch: (req) => ((got = req.headers), Response.json({ ok: true })) });
    try {
      const fetchVia = openAiCompatFetch(conn("openrouter", `http://127.0.0.1:${server.port}/api/v1`));
      await fetchVia("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json", accept: "application/json", "x-stainless-os": "Linux", "user-agent": "Groq/JS", authorization: "Bearer placeholder" },
      });
      const names = [...got!.keys()].filter((h) => !["host", "connection", "accept-encoding", "content-length", "user-agent"].includes(h)).sort();
      expect(names).toEqual(["accept", "authorization", "content-type", "http-referer", "x-title"]);
      expect(got!.get("authorization")).toBe("Bearer k-1");
    } finally {
      server.stop(true);
    }
  });
});

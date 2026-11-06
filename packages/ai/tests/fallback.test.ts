import { afterEach, describe, expect, test } from "bun:test";
import { transportFor, type Connection } from "@confu/ai/connection";
import { describeAiError } from "@confu/ai/errors";
import { resetFreeModels } from "@confu/ai/fallback";

// A fake OpenRouter: some models are busy, the catalog lists a few free ones.
const BUSY = '{"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"is temporarily rate-limited upstream","limit_source":"upstream_provider_shared_pool"}}}';
const CATALOG = [
  { id: "small/tiny:free", context_length: 4_000, architecture: { output_modalities: ["text"], input_modalities: ["text"] } },
  { id: "meta/llama:free", context_length: 128_000, architecture: { output_modalities: ["text"], input_modalities: ["text"] } },
  { id: "qwen/vl:free", context_length: 64_000, architecture: { output_modalities: ["text"], input_modalities: ["text", "image"] } },
  { id: "openai/gpt-paid", context_length: 400_000, architecture: { output_modalities: ["text"], input_modalities: ["text", "image"] } },
  { id: "openrouter/router:free", context_length: 200_000, architecture: { output_modalities: ["text"], tokenizer: "Router" } },
];

function fakeOpenRouter(busy: Set<string>) {
  const asked: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/models")) return Response.json({ data: CATALOG });
      const body = (await req.json()) as { model: string };
      asked.push(body.model);
      if (busy.has(body.model)) return new Response(`429 ${BUSY.replace("is temporarily", `${body.model} is temporarily`)}`, { status: 429 });
      return Response.json({ model: body.model, choices: [{ message: { role: "assistant", content: "hi" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    },
  });
  return { server, asked };
}

const conn = (port: number, models: Connection["models"]): Connection => ({
  id: "k",
  provider: "openrouter",
  key: "sk-or-test",
  baseUrl: `http://127.0.0.1:${port}/api/v1`,
  models,
  via: "key",
});

const ask = (c: Connection, model: string, content: unknown = "hi") =>
  transportFor(c)("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content }] }),
  });

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  resetFreeModels();
});

describe("a busy model hands over to another", () => {
  test("a busy free model falls back to another free model, never a paid one", async () => {
    const { server, asked } = fakeOpenRouter(new Set(["google/gemma:free"]));
    stop = () => server.stop(true);
    const res = await ask(conn(server.port!, { chat: "google/gemma:free", fast: "openai/gpt-paid", vision: "openai/gpt-paid" }), "google/gemma:free");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-confu-model")).toBe("meta/llama:free");
    expect(asked).toEqual(["google/gemma:free", "meta/llama:free"]);
  });

  test("works for any busy model, and prefers the student's own free picks", async () => {
    const { server, asked } = fakeOpenRouter(new Set(["deepseek/r1:free"]));
    stop = () => server.stop(true);
    const res = await ask(conn(server.port!, { chat: "deepseek/r1:free", fast: "qwen/vl:free", vision: "qwen/vl:free" }), "deepseek/r1:free");
    expect(res.ok).toBe(true);
    expect(asked).toEqual(["deepseek/r1:free", "qwen/vl:free"]);
  });

  test("a request with a picture only falls back to free models that can see", async () => {
    const { server, asked } = fakeOpenRouter(new Set(["google/gemma:free"]));
    stop = () => server.stop(true);
    const picture = [{ type: "text", text: "what is this" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }];
    const res = await ask(conn(server.port!, { chat: "google/gemma:free", fast: "google/gemma:free", vision: "google/gemma:free" }), "google/gemma:free", picture);
    expect(res.ok).toBe(true);
    expect(asked).toEqual(["google/gemma:free", "qwen/vl:free"]);
  });

  test("when every free model is busy, says so and stops the SDK retrying", async () => {
    const { server, asked } = fakeOpenRouter(new Set(["google/gemma:free", "meta/llama:free", "qwen/vl:free"]));
    stop = () => server.stop(true);
    const res = await ask(conn(server.port!, { chat: "google/gemma:free", fast: "google/gemma:free", vision: "google/gemma:free" }), "google/gemma:free");
    expect(res.status).toBe(429);
    expect(res.headers.get("x-should-retry")).toBe("false");
    expect(asked).toEqual(["google/gemma:free", "meta/llama:free", "qwen/vl:free"]);
    const p = describeAiError({ status: res.status, message: "", headers: res.headers }, "fallback");
    expect(p.error).toContain("free models are all busy");
    expect(p.error).toContain("google/gemma:free");
  });

  test("a model that answers is left alone", async () => {
    const { server, asked } = fakeOpenRouter(new Set());
    stop = () => server.stop(true);
    const res = await ask(conn(server.port!, { chat: "google/gemma:free", fast: "google/gemma:free", vision: "google/gemma:free" }), "google/gemma:free");
    expect(res.ok).toBe(true);
    expect(res.headers.get("x-confu-model")).toBeNull();
    expect(asked).toEqual(["google/gemma:free"]);
  });

  test("out of credit is not a busy model", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('{"error":{"message":"This request requires more credits"}}', { status: 402 }) });
    stop = () => server.stop(true);
    const res = await ask(conn(server.port!, { chat: "openai/gpt-paid", fast: "meta/llama:free", vision: "openai/gpt-paid" }), "openai/gpt-paid");
    expect(res.status).toBe(402);
  });
});

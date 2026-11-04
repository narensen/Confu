import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// Claude through the real Anthropic SDK, against a local stand-in for the
// Messages API, driven through the same client the app uses.
type Sent = {
  model: string;
  stream?: boolean;
  temperature?: number;
  output_config?: unknown;
  fallbacks?: unknown;
  system?: string;
  messages: { role: string; content: unknown[] }[];
  tools: { eager_input_streaming?: boolean }[];
};
type Seen = { body: Sent; headers: Headers };
const seen: Seen[] = [];
let mode: "json" | "tool-sse" | "refusal" | "401" = "json";
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as Sent;
      seen.push({ body, headers: req.headers });
      if (mode === "401") return Response.json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 });
      if (!body.stream) {
        return Response.json({
          id: "msg_1", type: "message", role: "assistant", model: body.model,
          content: mode === "refusal" ? [] : [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: '{"ok":true}' }],
          stop_reason: mode === "refusal" ? "refusal" : "end_turn", stop_sequence: null,
          usage: { input_tokens: 11, output_tokens: 7 },
        });
      }
      const events = [
        { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "(p. 3)" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "search_papers", input: {} } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"query":' } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"attention"}' } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 9 } },
        { type: "message_stop" },
      ];
      const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    },
  });
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

async function client() {
  const { transportFor, withModels } = await import("@confu/ai/connection");
  const { groqClient } = await import("@confu/ai/groq");
  const models = { chat: "claude-opus-5-5", fast: "claude-haiku-5-5", vision: "claude-opus-5-5" };
  return groqClient("connection", withModels(models, transportFor({ id: "k", provider: "anthropic", key: "sk-ant-test", baseUrl: "", models, via: "key" })));
}

describe("Claude adapter", () => {
  test("translates a JSON request and its answer", async () => {
    const { MODELS, modelBudget } = await import("@confu/ai/groq");
    seen.length = 0; mode = "json";
    const res = await (await client()).chat.completions.create({
      model: MODELS.fast,
      messages: [
        { role: "system", content: "You are a tutor." },
        { role: "assistant", content: "Earlier answer" },
        { role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }] },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      ...modelBudget(MODELS.fast, 600),
    });
    const sent = seen[0].body;
    expect(sent.model).toBe("claude-haiku-5-5");
    expect(sent.temperature).toBeUndefined();
    expect(sent.output_config).toEqual({ effort: "low" });
    expect(sent.fallbacks).toBeUndefined(); // Haiku has no server-side fallback
    expect(sent.system).toMatch(/single JSON object/);
    expect(sent.messages[0].role).toBe("user"); // must open with the student
    expect(sent.messages[2].content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } });
    expect(res.choices[0].message.content).toBe('{"ok":true}');
    expect(res.usage?.total_tokens).toBe(18);
  });

  test("streams text, holds the tool call to the end, reports usage; Opus gets the fallback", async () => {
    const { MODELS, modelBudget } = await import("@confu/ai/groq");
    seen.length = 0; mode = "tool-sse";
    const stream = await (await client()).chat.completions.create({
      model: MODELS.chat,
      messages: [{ role: "user", content: "find papers" }],
      stream: true,
      tools: [{ type: "function", function: { name: "search_papers", parameters: { type: "object", properties: { query: { type: "string" } } } } }],
      tool_choice: "auto",
      ...modelBudget(MODELS.chat, 1800),
    });
    let text = ""; const calls: { function?: { name?: string; arguments?: string } }[] = []; let usage: unknown = null; let finish = "";
    for await (const chunk of stream) {
      const c = chunk.choices[0];
      if (c?.delta?.content) text += c.delta.content;
      calls.push(...(c?.delta?.tool_calls ?? []));
      if (c?.finish_reason) finish = c.finish_reason;
      if ((chunk as { usage?: unknown }).usage) usage = (chunk as { usage?: unknown }).usage;
    }
    expect(seen[0].body.fallbacks).toBe("default");
    expect(seen[0].headers.get("anthropic-beta")).toMatch(/server-side-fallback-2026-07-01/);
    expect(seen[0].body.tools[0].eager_input_streaming).toBe(true);
    expect(text).toBe("Hello (p. 3)");
    expect(calls).toHaveLength(1);
    expect(calls[0].function).toEqual({ name: "search_papers", arguments: '{"query":"attention"}' });
    expect(finish).toBe("tool_calls");
    expect(usage).toEqual({ prompt_tokens: 20, completion_tokens: 9, total_tokens: 29 });
  });

  test("a refusal says so, and a rejected key asks for a new one", async () => {
    const { MODELS, modelBudget } = await import("@confu/ai/groq");
    const { aiErrorResponse } = await import("@/lib/ai-access");
    const c = await client();
    mode = "refusal";
    const r = await c.chat.completions.create({ model: MODELS.chat, messages: [{ role: "user", content: "x" }], ...modelBudget(MODELS.chat, 100) });
    expect(r.choices[0].message.content).toMatch(/declined/);
    mode = "401";
    const err = await c.chat.completions.create({ model: MODELS.chat, messages: [{ role: "user", content: "x" }], ...modelBudget(MODELS.chat, 100) }).catch((e) => e);
    const out = (await aiErrorResponse(err, "fallback").json()) as { code: string; error: string };
    expect(out.code).toBe("AI_KEY_INVALID");
    expect(out.error).toMatch(/^Anthropic rejected/);
  });
});

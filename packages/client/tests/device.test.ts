import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MODELS, modelBudget } from "@confu/ai/groq";
import { deviceAi } from "@confu/client/ai";
import { DeviceKeys } from "@confu/client/keys";
import { bunDriver } from "@confu/storage/drivers/bun";
import { newSealingKey } from "@confu/storage/keys";
import { Store } from "@confu/storage/store";

// A stand-in OpenAI-compatible provider that records what reaches it.
const seen: { path: string; headers: Headers; body: Record<string, unknown> | null }[] = [];
let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const body = req.method === "POST" ? ((await req.json()) as Record<string, unknown>) : null;
      seen.push({ path, headers: req.headers, body });
      if (req.headers.get("authorization") === "Bearer wrong") return Response.json({ error: { message: "bad key" } }, { status: 401 });
      if (path.endsWith("/models")) return Response.json({ data: [{ id: "llama3.2:3b" }, { id: "nomic-embed-text" }, { id: "qwen2.5vl:7b" }] });
      if (body?.stream) {
        const chunk = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
        const sse = [
          chunk({ choices: [{ index: 0, delta: { content: "Hi " }, finish_reason: null }] }),
          chunk({ choices: [{ index: 0, delta: { content: "there" }, finish_reason: "stop" }] }),
          chunk({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 2, total_tokens: 32 } }),
          "data: [DONE]\n\n",
        ].join("");
        return new Response(sse, { headers: { "content-type": "text/event-stream" } });
      }
      return Response.json({ id: "c", object: "chat.completion", created: 1, model: body?.model, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } });
    },
  });
  base = `http://127.0.0.1:${server.port}/v1`;
});
afterAll(() => server.stop(true));

async function setup() {
  const store = await Store.open(bunDriver(), { device: "dev-a" });
  const sealing = await newSealingKey();
  return { store, keys: new DeviceKeys(store, async () => sealing) };
}

describe("DeviceKeys", () => {
  test("checks the key, picks models, and stores it sealed", async () => {
    const { store, keys } = await setup();
    const res = await keys.add({ provider: "custom", key: "secret-key-1234", baseUrl: base });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.models).toEqual(["llama3.2:3b", "qwen2.5vl:7b"]); // the embedding model is left out
    expect(res.info).toMatchObject({ provider: "custom", last4: "1234", source: "account", models: { chat: "llama3.2:3b" } });
    const [row] = await store.list<{ secret: string }>("ai_keys");
    expect(row.secret).toStartWith("v1.");
    expect(row.secret).not.toContain("secret-key-1234");
    expect((await keys.connection())?.key).toBe("secret-key-1234");
  });

  test("a rejected key isn't saved", async () => {
    const { store, keys } = await setup();
    const res = await keys.add({ provider: "custom", key: "wrong", baseUrl: base });
    expect(res).toEqual({ ok: false, error: "The server rejected this key." });
    expect(await store.list("ai_keys")).toEqual([]);
  });

  test("a sealed key only opens on its own row", async () => {
    const { store, keys } = await setup();
    await keys.add({ provider: "custom", key: "secret-key-1234", baseUrl: base });
    const [row] = await store.list<{ id: string; secret: string }>("ai_keys");
    await store.put("ai_keys", { id: "other", provider: "custom", secret: row.secret, session_id: "s9", base_url: base });
    expect(await keys.connection("s9")).toBeNull();
  });

  test("a session's own key wins over the account's", async () => {
    const { keys } = await setup();
    await keys.add({ provider: "custom", key: "account-key-aaaa", baseUrl: base });
    await keys.add({ provider: "custom", key: "session-key-bbbb", baseUrl: base, sessionId: "s1" });
    expect((await keys.connection("s1"))?.key).toBe("session-key-bbbb");
    expect((await keys.connection("s2"))?.key).toBe("account-key-aaaa");
    await keys.remove("s1");
    expect((await keys.connection("s1"))?.key).toBe("account-key-aaaa");
  });
});

describe("deviceAi", () => {
  test("calls the provider straight from the device, with only the allowed headers", async () => {
    const { store, keys } = await setup();
    await keys.add({ provider: "custom", key: "secret-key-1234", baseUrl: base });
    const ai = await deviceAi(store, keys, null, "chat");
    seen.length = 0;
    const res = await ai!.groq.chat.completions.create({ model: MODELS.vision, messages: [{ role: "user", content: "hi" }], ...modelBudget(MODELS.vision, 100) });
    expect(res.choices[0].message.content).toBe("ok");
    const req = seen[0];
    expect(req.path).toBe("/v1/chat/completions");
    expect(req.headers.get("authorization")).toBe("Bearer secret-key-1234");
    expect(req.body?.model).toBe("llama3.2:3b"); // the student's model for the job
    expect([...req.headers.keys()].filter((h) => h.startsWith("x-stainless"))).toEqual([]);
  });

  test("records usage, also for streamed answers", async () => {
    const { store, keys } = await setup();
    await keys.add({ provider: "custom", key: "secret-key-1234", baseUrl: base });
    const ai = await deviceAi(store, keys, "s1", "chat");
    await ai!.groq.chat.completions.create({ model: MODELS.chat, messages: [{ role: "user", content: "hi" }], ...modelBudget(MODELS.chat, 100) });
    const stream = await ai!.groq.chat.completions.create({ model: MODELS.chat, messages: [{ role: "user", content: "hi" }], stream: true, ...modelBudget(MODELS.chat, 100) });
    let text = "";
    for await (const c of stream) text += c.choices[0]?.delta?.content ?? "";
    expect(text).toBe("Hi there");
    await Bun.sleep(20);
    const usage = await store.list<{ total_tokens: number; model: string; feature: string; session_id: string }>("ai_usage", {}, { order: "total_tokens" });
    expect(usage.map((u) => u.total_tokens)).toEqual([11, 32]);
    expect(usage[0]).toMatchObject({ model: "llama3.2:3b", feature: "chat", session_id: "s1" });
  });

  test("no key, no client", async () => {
    const { store, keys } = await setup();
    expect(await deviceAi(store, keys, null, "chat")).toBeNull();
  });
});

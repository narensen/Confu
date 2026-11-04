import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { DeviceKeys } from "@confu/client/keys";
import { askTutor, type AskInput, type PaperTools, type TutorEvent } from "@confu/client/tutor/ask";
import { NOT_CITED } from "@confu/core/tutor/keep-cited";
import { bunDriver } from "@confu/storage/drivers/bun";
import { newSealingKey } from "@confu/storage/keys";
import { Store } from "@confu/storage/store";

type Body = { model: string; stream?: boolean; messages: { role: string; content: string | null }[]; tools?: unknown[]; tool_choice?: string; response_format?: unknown };
const requests: Body[] = [];
let answer = "Principal components are the eigenvectors of the covariance matrix (p. 2).";
let rejectKey = false;
let server: ReturnType<typeof Bun.serve>;
let base = "";

const sse = (chunks: object[]) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path.endsWith("/models")) return Response.json({ data: [{ id: "tutor-model" }] });
      if (rejectKey) return Response.json({ error: { message: "invalid key" } }, { status: 401 });
      const body = (await req.json()) as Body;
      requests.push(body);
      if (!body.stream) {
        // The progress-notes update.
        return Response.json({
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ summary: "Getting PCA.", understood_add: ["covariance"], explained_add: ["eigenvectors"], topic_mastery: 0.6 }) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        });
      }
      if (body.tools && body.tool_choice === "auto") {
        return sse([{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search_papers", arguments: '{"query":"attention"}' } }] }, finish_reason: "tool_calls" }] }]);
      }
      const words = answer.split(/(?<= )/);
      return sse([...words.map((w) => ({ choices: [{ index: 0, delta: { content: w }, finish_reason: null }] })), { choices: [], usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 } }]);
    },
  });
  base = `http://127.0.0.1:${server.port}/v1`;
});
afterAll(() => server.stop(true));
beforeEach(() => {
  requests.length = 0;
  answer = "Principal components are the eigenvectors of the covariance matrix (p. 2).";
  rejectKey = false;
});

async function setup(kind: "study" | "paper" = "study", opts: { citeMode?: boolean; key?: boolean } = {}) {
  const store = await Store.open(bunDriver(), { device: "dev-a" });
  const sealing = await newSealingKey();
  const keys = new DeviceKeys(store, async () => sealing);
  if (opts.key !== false) await keys.add({ provider: "custom", key: "k-1234", baseUrl: base });
  await store.put("study_sessions", { id: "s1", title: "Linear algebra", kind, cite_mode: opts.citeMode ?? false });
  await store.put("documents", { id: "d1", session_id: "s1", title: "PCA notes", page_count: 3, status: "ready" });
  await store.put("document_pages", { document_id: "d1", page_number: 1, content: "Vectors and matrices. A matrix maps vectors to vectors." });
  await store.put("document_pages", { document_id: "d1", page_number: 2, content: "Principal components are the eigenvectors of the covariance matrix of the data." });
  await store.put("document_pages", { document_id: "d1", page_number: 3, content: "Each eigenvalue measures the variance captured along its direction." });
  if (kind === "study") {
    await store.put("study_plans", { id: "p1", session_id: "s1", goal: "Understand PCA", deadline: "2030-01-01" });
    await store.put("plan_topics", { id: "t1", plan_id: "p1", position: 0, title: "Eigenvectors", due_date: "2030-01-01", key_concepts: ["eigenvector"] });
  }
  return { store, keys };
}

async function run(deps: Parameters<typeof askTutor>[0], input: AskInput) {
  const events: TutorEvent[] = [];
  for await (const e of askTutor(deps, input)) events.push(e);
  const done = events.find((e) => e.type === "done");
  if (done?.type === "done") await done.notes;
  return events;
}

describe("askTutor on the device", () => {
  test("answers from the right page, streams, saves, and updates the notes", async () => {
    const { store, keys } = await setup();
    const events = await run({ store, keys }, { sessionId: "s1", action: "chat", message: "What are the eigenvectors of the covariance matrix?" });
    const text = events.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.text : "")).join("");
    expect(events.filter((e) => e.type === "text").length).toBeGreaterThan(3); // streamed, not all at once
    expect(text).toBe(answer);
    // The prompt carried page 2's text as an excerpt.
    const system = requests[0].messages[0].content ?? "";
    expect(system).toContain("Principal components are the eigenvectors of the covariance matrix");
    expect(requests[0].model).toBe("tutor-model");
    // Saved, in order.
    const msgs = await store.list<{ role: string; content: string }>("messages", { session_id: "s1" }, { order: "created_at" });
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].content).toBe(answer);
    // The topic started; the notes and mastery were updated in the background.
    const topic = await store.get<{ status: string; mastery: number }>("plan_topics", { id: "t1" });
    expect(topic).toMatchObject({ status: "in_progress", mastery: 0.6 });
    const memory = await store.get<{ summary: string; understood: string[] }>("learner_memory", { session_id: "s1" });
    expect(memory).toMatchObject({ summary: "Getting PCA.", understood: ["covariance"] });
    // Both requests' tokens were counted.
    expect((await store.list<{ total_tokens: number }>("ai_usage", {}, { order: "total_tokens" })).map((u) => u.total_tokens)).toEqual([70, 940]);
  });

  test("the next turn remembers the conversation", async () => {
    const { store, keys } = await setup();
    await run({ store, keys }, { sessionId: "s1", action: "chat", message: "What are eigenvectors?" });
    requests.length = 0;
    await run({ store, keys }, { sessionId: "s1", action: "chat", message: "And eigenvalues?" });
    const roles = requests[0].messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(requests[0].messages[2].content).toBe(answer);
  });

  test("a passage the student asks about goes to spaced review once", async () => {
    const { store, keys } = await setup();
    const selection = { text: "Principal components are the eigenvectors of the covariance matrix", page: 2, documentId: "d1" };
    await run({ store, keys }, { sessionId: "s1", action: "ask", message: "Why?", selection, documentId: "d1", page: 2 });
    await run({ store, keys }, { sessionId: "s1", action: "ask", message: "Why again?", selection, documentId: "d1", page: 2 });
    const items = await store.list<{ question: string; page_number: number }>("review_items", { session_id: "s1" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ question: "Why?", page_number: 2 });
  });

  test("cite mode keeps only cited claims and says so once", async () => {
    const { store, keys } = await setup("study", { citeMode: true });
    answer = "Principal components are the eigenvectors of the covariance matrix, as page nine of the book explains in detail (p. 9).";
    const events = await run({ store, keys }, { sessionId: "s1", action: "chat", message: "What are principal components?" });
    const texts = events.filter((e) => e.type === "text");
    expect(texts).toHaveLength(1); // held until filtered
    const reply = texts[0].type === "text" ? texts[0].text : "";
    expect(reply).not.toContain("p. 9");
    expect(reply).toContain(NOT_CITED);
  });

  test("a paper session can search papers, then answers with sources", async () => {
    const { store, keys } = await setup("paper");
    const tools: PaperTools = {
      definitions: [{ type: "function", function: { name: "search_papers", parameters: { type: "object", properties: {} } } }],
      async run(name, args) {
        expect(name).toBe("search_papers");
        expect(JSON.parse(args)).toEqual({ query: "attention" });
        return { label: "Searching papers…", sources: [{ title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762" }], result: { results: [] } };
      },
    };
    answer = "Here is related work.";
    const events = await run({ store, keys, tools }, { sessionId: "s1", action: "chat", message: "Find related work on attention" });
    expect(events.filter((e) => e.type === "status").map((e) => (e.type === "status" ? e.label : ""))).toEqual(["Searching papers…", "Reading the results…"]);
    const done = events.find((e) => e.type === "done");
    expect(done?.type === "done" && done.reply).toContain("[Attention Is All You Need](https://arxiv.org/abs/1706.03762)");
    expect(requests[1].tool_choice).toBe("none"); // the second round must answer
  });

  test("no AI connected: asks the student to connect one", async () => {
    const { store, keys } = await setup("study", { key: false });
    const events = await run({ store, keys }, { sessionId: "s1", action: "chat", message: "Hi" });
    expect(events).toEqual([{ type: "error", error: "Connect your own AI to use the tutor: an API key, or your OpenRouter account.", code: "AI_KEY_REQUIRED" }]);
  });

  test("a rejected key: says which provider, and nothing is saved", async () => {
    const { store, keys } = await setup();
    rejectKey = true;
    const events = await run({ store, keys }, { sessionId: "s1", action: "chat", message: "Hi" });
    expect(events).toEqual([{ type: "error", error: "Your model server rejected the saved API key. Replace it in Settings or below.", code: "AI_KEY_INVALID" }]);
    expect(await store.list("messages")).toEqual([]);
  });
});

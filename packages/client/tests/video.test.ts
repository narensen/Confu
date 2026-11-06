import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Connection } from "@confu/ai/connection";
import { writeVideo } from "@confu/client/video";
import { bunDriver } from "@confu/storage/drivers/bun";
import { Store } from "@confu/storage/store";

let server: ReturnType<typeof Bun.serve>;
let base = "";
const calls: { last: string; count: number }[] = [];

const say = (a: string, b: string) => [
  { speaker: "A", text: a },
  { speaker: "B", text: b },
];
const board = (line: string) =>
  JSON.stringify({
    title: "PCA",
    scenes: [
      { template: "title", title: "PCA", subtitle: "Why it matters to the data", narration: say(line, "Why does that matter here?") },
      { template: "bars", title: "Variance", unit: "%", bars: [{ label: "PC1", value: 62 }, { label: "PC2", value: 24 }], narration: say(line, "And the second component?") },
      { template: "recap", title: "Remember", points: ["Centre the data", "Keep the top components"], narration: say(line, "That is the whole idea.") },
    ],
  });

let reply: (n: number, last: string) => string = () => board("Principal component analysis finds the directions where a cloud of data varies the most and keeps those.");

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { messages: { role: string; content: string }[] };
      const last = body.messages[body.messages.length - 1]?.content ?? "";
      calls.push({ last, count: body.messages.length });
      return Response.json({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "lab-model",
        choices: [{ index: 0, message: { role: "assistant", content: reply(calls.length, last) }, finish_reason: "stop" }],
      });
    },
  });
  base = `http://127.0.0.1:${server.port}/v1`;
});
afterAll(() => server.stop(true));

async function run() {
  const store = await Store.open(bunDriver(), { device: "video-write" });
  const conn: Connection = { id: "lab", provider: "custom", key: "k", baseUrl: base, models: { chat: "lab-model", fast: "lab-model", vision: "lab-model" }, via: "key" };
  return writeVideo(store, conn, {
    sessionId: "lab",
    title: "PCA",
    minutes: 1,
    pages: [{ page: 1, text: "PC1 explains 62 percent of the variance and PC2 explains 24 percent." }],
  });
}

describe("writing a video", () => {
  test("a prose refusal is asked again as a JSON task", async () => {
    calls.length = 0;
    reply = (n) => (n === 1 ? "I only answer programming questions, not history." : board("Principal component analysis finds the directions where a cloud of data varies the most and keeps those."));
    const out = await run();
    expect(out.script?.title).toBe("PCA");
    expect(calls).toHaveLength(2);
    expect(calls[1].last).toContain("code-generation");
    expect(calls[1].count).toBeGreaterThan(2);
  });

  test("a storyboard that is far too short is rewritten once", async () => {
    calls.length = 0;
    const long = "Principal component analysis finds the directions where a cloud of data varies the most and keeps those.";
    reply = (n) => (n === 1 ? board("PCA shrinks data.") : board(long));
    const out = await run();
    expect(out.issues).toContain("length:rewritten");
    expect(out.script?.scenes[0].narration[0].text).toBe(long);
    expect(calls).toHaveLength(2);
    expect(calls[1].last).toContain("seconds");
  });
});

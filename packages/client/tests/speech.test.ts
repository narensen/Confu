import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Connection } from "@confu/ai/connection";
import { DeviceKeys } from "@confu/client/keys";
import { addPdf, createSession, deleteSession, type PdfExtractor } from "@confu/client/library";
import { pieceAudio, pieces, podcastAudioPaths, SpeechError } from "@confu/client/speech";
import { canTranscribe, deletePodcast, makePodcast, saveRecording, transcribe } from "@confu/client/tools";
import { ORPHEUS } from "@confu/core/podcast";
import { bunDriver } from "@confu/storage/drivers/bun";
import { memoryFiles } from "@confu/storage/files";
import { newSealingKey } from "@confu/storage/keys";
import { Store } from "@confu/storage/store";

// Two fake providers: OpenRouter as the main AI, its chat busy (429), and Groq, which
// lists models, writes scripts, voices text and transcribes.
let main: ReturnType<typeof Bun.serve>;
let groq: ReturnType<typeof Bun.serve>;
const voiced: { input: string; voice: string; model: string; response_format?: string }[] = [];
const groqPaths: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  main = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path.endsWith("/models")) return Response.json({ data: [{ id: "busy/model:free" }] });
      if (path.endsWith("/key")) return Response.json({ data: {} });
      return Response.json({ error: { message: "Rate limit reached" } }, { status: 429, headers: { "x-should-retry": "false" } });
    },
  });
  groq = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      groqPaths.push(path);
      if (path.endsWith("/models")) return Response.json({ data: [{ id: "llama-3.3-70b-versatile" }, { id: "llama-3.1-8b-instant" }] });
      if (path.endsWith("/audio/speech")) {
        const body = (await req.json()) as { input: string; voice: string; model: string };
        voiced.push(body);
        return new Response(new Blob([`RIFF${body.voice}:${body.input}`], { type: "audio/wav" }));
      }
      if (path.endsWith("/audio/transcriptions")) return Response.json({ text: "Entropy grows.", segments: [{ start: 0, end: 2, text: "Entropy grows." }] });
      const content = JSON.stringify({ title: "From Groq", lines: [{ speaker: "A", text: "Hello." }, { speaker: "B", text: "Why?" }] });
      return Response.json({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
    },
  });
  // Groq's real address, answered by the fake.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    return realFetch(url.replace("https://api.groq.com/openai/v1", `http://127.0.0.1:${groq.port}/v1`).replace("https://openrouter.ai/api/v1", `http://127.0.0.1:${main.port}/v1`), init);
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  main.stop(true);
  groq.stop(true);
});

const conn = (): Connection => ({ id: "c", provider: "groq", key: "gsk_test", baseUrl: `http://127.0.0.1:${groq.port}/v1`, models: { chat: "x", fast: "x", vision: "x" }, via: "key" });
const podcast = { id: "pod-1", script: [{ speaker: "A" as const, text: "Short line." }, { speaker: "B" as const, text: "A longer line. ".repeat(20).trim() }] };

describe("natural voices", () => {
  test("each piece is voiced once with the speaker's voice, then comes from the device", async () => {
    const files = memoryFiles();
    const all = pieces(podcast);
    expect(all.length).toBeGreaterThan(2);
    for (const p of all) expect(p.text.length).toBeLessThanOrEqual(ORPHEUS.maxChars);
    voiced.length = 0;
    const first = await pieceAudio(files, conn(), podcast.id, all[0]);
    const again = await pieceAudio(files, conn(), podcast.id, all[0]);
    expect(await again.text()).toBe(await first.text());
    expect(voiced).toEqual([{ model: ORPHEUS.model, input: "Short line.", voice: ORPHEUS.voices.A, response_format: "wav" }]);
    await pieceAudio(files, conn(), podcast.id, all[1]);
    expect(voiced[1].voice).toBe(ORPHEUS.voices.B);
    expect(podcastAudioPaths({ ...podcast, session_id: "s", title: "t", created_at: "" })).toHaveLength(all.length);
  });

  test("a short rate limit is waited out; a used-up allowance and missing terms are said plainly", async () => {
    const files = memoryFiles();
    let calls = 0;
    const flaky = (async () => (++calls === 1 ? new Response("{}", { status: 429, headers: { "retry-after": "1" } }) : new Response(new Blob(["RIFF"])))) as unknown as typeof fetch;
    await pieceAudio(files, conn(), "p2", { line: 0, part: 0, speaker: "A", text: "Hi." }, { fetch: flaky });
    expect(calls).toBe(2);

    const spent = (async () => new Response(JSON.stringify({ error: { message: "Rate limit reached for requests per day (RPD)" } }), { status: 429 })) as unknown as typeof fetch;
    const e1 = await pieceAudio(files, conn(), "p3", { line: 0, part: 0, speaker: "A", text: "Hi." }, { fetch: spent }).catch((e) => e);
    expect(e1).toBeInstanceOf(SpeechError);
    expect(e1.kind).toBe("limit");

    const terms = (async () => new Response(JSON.stringify({ error: { message: "The model requires terms acceptance." } }), { status: 400 })) as unknown as typeof fetch;
    const e2 = await pieceAudio(files, conn(), "p4", { line: 0, part: 0, speaker: "A", text: "Hi." }, { fetch: terms }).catch((e) => e);
    expect(e2.kind).toBe("terms");
    expect(e2.message).toContain("console.groq.com/playground");
  });
});

const extract: PdfExtractor = async (file) => {
  const pages = (await file.text()).split("\n");
  return { pageCount: pages.length, pages, outline: [] };
};

describe("the Groq voice key", () => {
  async function setup() {
    const store = await Store.open(bunDriver(), { device: "dev-v" });
    const files = memoryFiles();
    const sealing = await newSealingKey();
    const keys = new DeviceKeys(store, async () => sealing);
    expect((await keys.add({ provider: "openrouter", key: "sk-or-v1-" + "e".repeat(64), via: "oauth" })).ok).toBe(true);
    const s = await createSession(store, { title: "Physics" });
    await addPdf(store, files, { sessionId: s.id, file: new Blob(["Entropy is a measure of disorder in a system and it tends to grow over time."]), title: "Notes", extract });
    return { store, files, keys, s };
  }

  test("kept apart from the tutor's key", async () => {
    const { keys } = await setup();
    expect(await keys.groq()).toBeNull();
    expect((await keys.addVoice("gsk_" + "a".repeat(52))).ok).toBe(true);
    expect((await keys.get(null))?.provider).toBe("openrouter"); // the tutor's AI is unchanged
    expect((await keys.voiceInfo())?.provider).toBe("groq");
    expect((await keys.groq())?.provider).toBe("groq");
    await keys.removeVoice();
    expect(await keys.groq()).toBeNull();
    expect((await keys.get(null))?.provider).toBe("openrouter");
  });

  test("writes the script when the main AI is busy", async () => {
    const { store, keys, s } = await setup();
    await expect(makePodcast(store, keys, { sessionId: s.id, title: "Entropy" })).rejects.toThrow(/rate limit/i);
    await keys.addVoice("gsk_" + "b".repeat(52));
    const pod = await makePodcast(store, keys, { sessionId: s.id, title: "Entropy" });
    expect(pod.title).toBe("From Groq");
  });

  test("transcribes lectures when the main AI can't", async () => {
    const { store, files, keys, s } = await setup();
    // OpenRouter has no speech-to-text: no transcripts without help.
    expect(await canTranscribe(keys, s.id)).toBe(false);
    await keys.addVoice("gsk_" + "c".repeat(52));
    const id = await saveRecording(store, files, { sessionId: s.id, audio: new Blob(["x"], { type: "audio/webm" }), seconds: 2, title: "Lecture" });
    expect(await canTranscribe(keys, s.id)).toBe(true);
    groqPaths.length = 0;
    await transcribe(store, files, keys, id);
    expect(groqPaths).toContain("/v1/audio/transcriptions");
  });

  test("deleting an episode or the session removes its audio", async () => {
    const { store, files, keys, s } = await setup();
    await keys.addVoice("gsk_" + "d".repeat(52));
    const pod = await makePodcast(store, keys, { sessionId: s.id, title: "Entropy" });
    const [first] = pieces(pod);
    await pieceAudio(files, (await keys.groq())!, pod.id, first);
    const [path] = podcastAudioPaths(pod);
    expect(await files.get(path)).not.toBeNull();
    await deletePodcast(store, files, pod.id);
    expect(await files.get(path)).toBeNull();

    const pod2 = await makePodcast(store, keys, { sessionId: s.id, title: "Entropy" });
    await pieceAudio(files, (await keys.groq())!, pod2.id, pieces(pod2)[0]);
    await deleteSession(store, files, s.id);
    expect(await files.get(podcastAudioPaths(pod2)[0])).toBeNull();
  });
});

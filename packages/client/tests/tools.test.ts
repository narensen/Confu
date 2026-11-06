import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DeviceKeys } from "@confu/client/keys";
import { addPdf, createSession, deleteSession, listDocuments, type PdfExtractor } from "@confu/client/library";
import { answerCard, dueCards, listCards, makeCards, makePodcast, saveNote, listNotes, saveRecording, transcribe, listRecordings } from "@confu/client/tools";
import { bunDriver } from "@confu/storage/drivers/bun";
import { memoryFiles } from "@confu/storage/files";
import { newSealingKey } from "@confu/storage/keys";
import { searchPages } from "@confu/storage/search";
import { Store } from "@confu/storage/store";

let server: ReturnType<typeof Bun.serve>;
let base = "";
const seen: { path: string; model?: string; json?: boolean }[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path.endsWith("/models")) return Response.json({ data: [{ id: "tutor-model" }, { id: "whisper-small" }] });
      if (path.endsWith("/audio/transcriptions")) {
        const form = await req.formData();
        seen.push({ path, model: String(form.get("model")) });
        return Response.json({ text: "Entropy. Disorder grows.", segments: [{ start: 0, end: 3, text: "Entropy." }, { start: 320, end: 330, text: "Disorder grows." }] });
      }
      const body = (await req.json()) as { messages: { content: string }[]; response_format?: unknown };
      const all = body.messages.map((m) => m.content).join("\n");
      seen.push({ path, json: Boolean(body.response_format) });
      const content = /flashcards/.test(all)
        ? JSON.stringify({ cards: [{ front: "What do principal components point along?", back: "Directions of most variance.", page: 2 }, { front: "Eigenvalue?", back: "Variance along its direction.", page: 3 }] })
        : JSON.stringify({ title: "PCA", lines: [{ speaker: "A", text: "Hi." }, { speaker: "B", text: "Why PCA?" }] });
      return Response.json({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
    },
  });
  base = `http://127.0.0.1:${server.port}/v1`;
});
afterAll(() => server.stop(true));

const extract: PdfExtractor = async (file) => {
  const pages = (await file.text()).split("\n");
  return { pageCount: pages.length, pages, outline: [] };
};

async function setup() {
  const store = await Store.open(bunDriver(), { device: "dev-a" });
  const files = memoryFiles();
  const sealing = await newSealingKey();
  const keys = new DeviceKeys(store, async () => sealing);
  await keys.add({ provider: "custom", key: "k-1234", baseUrl: base });
  const s = await createSession(store, { title: "PCA" });
  const doc = await addPdf(store, files, {
    sessionId: s.id,
    file: new Blob(["Chapter one: vectors, matrices, and the maps between them in many dimensions.\nPrincipal components are the eigenvectors of the covariance matrix, ordered by variance.\nEach eigenvalue measures the variance captured along its own principal direction here."]),
    title: "PCA notes",
    extract,
  });
  return { store, files, keys, s, doc };
}

describe("flashcards", () => {
  test("written from the pages, due at once, then scheduled by the answer", async () => {
    const { store, keys, s, doc } = await setup();
    const cards = await makeCards(store, keys, { sessionId: s.id, documentId: doc.id, title: doc.title, count: 5 });
    expect(cards.map((c) => [c.front, c.page_number])).toEqual([
      ["What do principal components point along?", 2],
      ["Eigenvalue?", 3],
    ]);
    expect(seen.at(-1)?.path).toEndWith("/chat/completions");
    const due = await dueCards(store, s.id);
    expect(due.length).toBe(2);
    await answerCard(store, due[0], 4);
    await answerCard(store, due[1], 1);
    const later = await dueCards(store, s.id, new Date(Date.now() + 10 * 60_000));
    expect(later.map((c) => c.front)).toEqual(["Eigenvalue?"]); // Again comes back soon; Easy doesn't
    expect((await listCards(store, s.id)).find((c) => c.front === "Eigenvalue?")?.reps).toBe(1);
  });
});

describe("lectures", () => {
  test("a recording is transcribed by the student's provider into a citable document", async () => {
    const { store, files, keys, s } = await setup();
    const id = await saveRecording(store, files, { sessionId: s.id, audio: new Blob(["fake-audio"], { type: "audio/webm" }), seconds: 330, title: "Lecture 1" });
    const docId = await transcribe(store, files, keys, id);
    expect(seen.find((r) => r.path.endsWith("/audio/transcriptions"))?.model).toBe("whisper-1");
    const doc = (await listDocuments(store, s.id)).find((d) => d.id === docId)!;
    expect(doc).toMatchObject({ title: "Lecture 1", page_count: 2, meta: { kind: "lecture", starts: [0, 300] } });
    expect((await searchPages(store, docId, "disorder"))[0]?.page_number).toBe(2);
    expect((await listRecordings(store, s.id))[0]).toMatchObject({ status: "ready", document_id: docId });
  });

  test("a provider that can't transcribe says what to do", async () => {
    const store = await Store.open(bunDriver(), { device: "dev-a" });
    const files = memoryFiles();
    const keys = { connection: async () => ({ id: "k", provider: "anthropic", key: "x", baseUrl: "https://api.anthropic.com/v1", models: { chat: "c", fast: "f", vision: "v" }, via: "key" }), groq: async () => null } as unknown as DeviceKeys;
    const s = await createSession(store);
    const id = await saveRecording(store, files, { sessionId: s.id, audio: new Blob(["a"]), seconds: 5, title: "L" });
    await expect(transcribe(store, files, keys, id)).rejects.toThrow(/Groq key/);
  });
});

describe("notes, podcasts, and deleting a session", () => {
  test("notes save and update; a podcast script is written; deleting the session removes them all", async () => {
    const { store, files, keys, s } = await setup();
    const id = await saveNote(store, { sessionId: s.id, title: "PCA", content: "# Eigen" });
    await saveNote(store, { id, sessionId: s.id, content: "# Eigen\nvectors" });
    expect((await listNotes(store, s.id)).map((n) => n.content)).toEqual(["# Eigen\nvectors"]);
    const pod = await makePodcast(store, keys, { sessionId: s.id, title: "PCA" });
    expect(pod.script).toEqual([
      { speaker: "A", text: "Hi." },
      { speaker: "B", text: "Why PCA?" },
    ]);
    const rec = await saveRecording(store, files, { sessionId: s.id, audio: new Blob(["x"]), seconds: 1, title: "L" });
    const path = (await listRecordings(store, s.id))[0].storage_path!;
    await deleteSession(store, files, s.id);
    for (const t of ["notes", "podcasts", "recordings", "cards"]) expect(await store.list(t)).toEqual([]);
    expect(await files.get(path)).toBeNull();
    expect(rec).toBeTruthy();
  });
});

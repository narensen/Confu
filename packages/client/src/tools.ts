import type { FetchLike } from "@confu/ai/fetch-like";
import { MODELS, modelBudget } from "@confu/ai/groq";
import { cardsPrompt, grade as gradeSchedule, newSchedule, parseCards, type CardSchedule } from "@confu/core/cards";
import { transcriptionModel, transcriptPages, type Segment } from "@confu/core/lecture";
import { parsePodcast, podcastPrompt, type PodcastScript } from "@confu/core/podcast";
import type { FileStore } from "@confu/storage/files";
import type { Store } from "@confu/storage/store";
import { deviceAi } from "./ai";
import type { DeviceKeys } from "./keys";
import { touchSession } from "./library";

// The study tools on the device: flashcards, notes, recorded lectures and
// audio overviews. AI work goes straight to the student's own provider.

const NO_AI = "Connect your AI first (the button at the top right).";

// ---- flashcards ----

export type LocalCard = CardSchedule & {
  id: string;
  session_id: string;
  document_id: string | null;
  page_number: number | null;
  front: string;
  back: string;
  suspended: boolean;
  created_at: string;
};

async function pagesFor(store: Store, input: { sessionId: string; documentId?: string | null; from?: number; to?: number; max?: number }) {
  const docs = input.documentId
    ? [{ id: input.documentId }]
    : await store.list<{ id: string }>("documents", { session_id: input.sessionId }, { order: "position" });
  const out: { docId: string; page: number; text: string }[] = [];
  for (const d of docs) {
    const rows = await store.query<{ page_number: number; content: string }>(
      `SELECT page_number, content FROM document_pages WHERE document_id = ? AND page_number BETWEEN ? AND ? AND length(trim(content)) > 40 ORDER BY page_number`,
      [d.id, input.from ?? 1, input.to ?? 1_000_000],
    );
    for (const r of rows) out.push({ docId: d.id, page: r.page_number, text: r.content });
  }
  // Long material: an even spread of pages, so cards cover all of it.
  const max = input.max ?? 12;
  if (out.length <= max) return out;
  const step = out.length / max;
  return Array.from({ length: max }, (_, i) => out[Math.floor(i * step)]);
}

export async function makeCards(
  store: Store,
  keys: DeviceKeys,
  input: { sessionId: string; documentId: string; title: string; from?: number; to?: number; count?: number; focus?: string | null },
): Promise<LocalCard[]> {
  const ai = await deviceAi(store, keys, input.sessionId, "quiz");
  if (!ai) throw new Error(NO_AI);
  const pages = await pagesFor(store, { ...input, max: 10 });
  if (!pages.length) throw new Error("There's no readable text on those pages (a scanned file?).");
  const count = Math.max(3, Math.min(30, input.count ?? 10));
  const res = await ai.groq.chat.completions.create({
    model: MODELS.chat,
    messages: cardsPrompt({ pages: pages.map((p) => ({ page: p.page, text: p.text })), count, title: input.title, focus: input.focus }),
    response_format: { type: "json_object" },
    temperature: 0.3,
    ...modelBudget(MODELS.chat, 2400),
  });
  const drafts = parseCards(res.choices[0]?.message?.content ?? "", new Set(pages.map((p) => p.page)));
  if (!drafts.length) throw new Error("The AI didn't write any usable cards. Try again, or pick other pages.");
  const now = new Date();
  const rows = drafts.map((d) => ({ id: crypto.randomUUID(), session_id: input.sessionId, document_id: input.documentId, page_number: d.page, front: d.front, back: d.back, ...newSchedule(now) }));
  await store.putMany("cards", rows);
  await touchSession(store, input.sessionId);
  const saved = new Map((await store.query<LocalCard>(`SELECT * FROM cards WHERE id IN (${rows.map(() => "?").join(",")})`, rows.map((r) => r.id))).map((c) => [c.id, fixBools(c)]));
  return rows.map((r) => saved.get(r.id)!).filter(Boolean);
}

const fixBools = (c: LocalCard): LocalCard => ({ ...c, suspended: Boolean(c.suspended) });

export const listCards = (store: Store, sessionId: string) => store.list<LocalCard>("cards", { session_id: sessionId }, { order: "created_at" });

export async function dueCards(store: Store, sessionId: string, now = new Date()): Promise<LocalCard[]> {
  return (await store.query<LocalCard>(`SELECT * FROM cards WHERE session_id = ? AND suspended = 0 AND due <= ? ORDER BY due LIMIT 200`, [sessionId, now.toISOString()])).map(fixBools);
}

export async function answerCard(store: Store, card: LocalCard, g: 1 | 2 | 3 | 4, now = new Date()) {
  await store.put("cards", { id: card.id, ...gradeSchedule(card, g, now) });
}

export const saveCard = (store: Store, card: Pick<LocalCard, "id"> & Partial<Pick<LocalCard, "front" | "back" | "suspended">>) => store.put("cards", card);
export const deleteCard = (store: Store, id: string) => store.remove("cards", { id });

export async function addCard(store: Store, input: { sessionId: string; front: string; back: string; documentId?: string | null; page?: number | null }) {
  return store.put("cards", { session_id: input.sessionId, front: input.front.trim(), back: input.back.trim(), document_id: input.documentId ?? null, page_number: input.page ?? null, ...newSchedule() });
}

// ---- notes ----

export type LocalNote = { id: string; session_id: string; title: string; content: string; ydoc: string | null; created_at: string; updated_at: string };

export const listNotes = (store: Store, sessionId: string) => store.list<LocalNote>("notes", { session_id: sessionId }, { order: "updated_at", desc: true });

export async function saveNote(store: Store, note: { id?: string; sessionId: string; title?: string; content: string; ydoc?: string | null }) {
  const row = await store.put("notes", {
    ...(note.id ? { id: note.id } : {}),
    session_id: note.sessionId,
    ...(note.title !== undefined ? { title: note.title.trim() || "Notes" } : {}),
    content: note.content,
    ...(note.ydoc !== undefined ? { ydoc: note.ydoc } : {}),
    updated_at: new Date().toISOString(),
  });
  return row.id!;
}

export const deleteNote = (store: Store, id: string) => store.remove("notes", { id });

// ---- recorded lectures ----

export type LocalRecording = {
  id: string;
  session_id: string;
  title: string;
  storage_path: string | null;
  mime: string;
  seconds: number;
  status: "recorded" | "transcribing" | "ready" | "failed";
  document_id: string | null;
  error: string | null;
  created_at: string;
};

export const listRecordings = (store: Store, sessionId: string) => store.list<LocalRecording>("recordings", { session_id: sessionId }, { order: "created_at", desc: true });

const MAX_UPLOAD = 25 * 1024 * 1024; // Groq's and OpenAI's limit per file

export async function saveRecording(store: Store, files: FileStore, input: { sessionId: string; audio: Blob; seconds: number; title: string }): Promise<string> {
  const id = crypto.randomUUID();
  const ext = input.audio.type.includes("mp4") ? "m4a" : input.audio.type.includes("ogg") ? "ogg" : "webm";
  const path = `audio/${id}.${ext}`;
  await files.put(path, input.audio);
  await store.put("recordings", { id, session_id: input.sessionId, title: input.title, storage_path: path, mime: input.audio.type || "audio/webm", seconds: Math.round(input.seconds), status: "recorded" });
  await touchSession(store, input.sessionId);
  return id;
}

// Can this connection transcribe? Groq and OpenAI can; a custom server
// might (if it runs whisper), so it gets to try.
export async function canTranscribe(keys: DeviceKeys, sessionId: string): Promise<boolean> {
  const conn = await keys.connection(sessionId);
  return Boolean(conn && (transcriptionModel(conn.provider) || conn.provider === "custom"));
}

// Sends the recording to the student's provider for a transcript, then
// adds the transcript to the session as a document the tutor can cite.
export async function transcribe(store: Store, files: FileStore, keys: DeviceKeys, recordingId: string, opts: { fetch?: FetchLike; language?: string } = {}): Promise<string> {
  const rec = await store.get<LocalRecording>("recordings", { id: recordingId });
  if (!rec?.storage_path) throw new Error("That recording isn't on this device.");
  const conn = await keys.connection(rec.session_id);
  if (!conn) throw new Error(NO_AI);
  const model = transcriptionModel(conn.provider, [conn.models.chat, conn.models.fast, conn.models.vision]) ?? (conn.provider === "custom" ? "whisper-1" : null);
  if (!model) throw new Error("Your AI provider can't transcribe audio. Add a Groq key (free) or an OpenAI key for lectures.");
  const audio = await files.get(rec.storage_path);
  if (!audio) throw new Error("The recording's audio is missing on this device.");
  if (audio.size > MAX_UPLOAD) throw new Error("This recording is over 25 MB, more than providers accept in one go. Record lectures in parts of about an hour.");

  await store.put("recordings", { id: rec.id, status: "transcribing", error: null });
  try {
    const form = new FormData();
    form.append("file", new File([audio], `${rec.id}.${rec.storage_path.split(".").pop()}`, { type: rec.mime }));
    form.append("model", model);
    form.append("response_format", "verbose_json");
    if (opts.language) form.append("language", opts.language);
    const res = await (opts.fetch ?? fetch)(`${conn.baseUrl}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${conn.key}` }, body: form });
    const body = (await res.json().catch(() => ({}))) as { text?: string; segments?: Segment[]; error?: { message?: string } };
    if (!res.ok || typeof body.text !== "string") throw new Error(body.error?.message ?? `The provider answered ${res.status}.`);
    const { pages, starts } = transcriptPages({ text: body.text, segments: body.segments });
    const docId = crypto.randomUUID();
    const [last] = await store.query<{ p: number | null }>(`SELECT max(position) AS p FROM documents WHERE session_id = ?`, [rec.session_id]);
    await store.putMany(
      "document_pages",
      pages.map((content, i) => ({ document_id: docId, page_number: i + 1, content })),
    );
    await store.put("documents", {
      id: docId,
      session_id: rec.session_id,
      title: rec.title,
      storage_path: null,
      page_count: pages.length,
      status: "ready",
      position: (last?.p ?? -1) + 1,
      meta: { kind: "lecture", recording_id: rec.id, starts, seconds: rec.seconds },
    });
    await store.put("recordings", { id: rec.id, status: "ready", document_id: docId });
    await touchSession(store, rec.session_id);
    return docId;
  } catch (e) {
    await store.put("recordings", { id: rec.id, status: "failed", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export async function deleteRecording(store: Store, files: FileStore, rec: LocalRecording) {
  if (rec.storage_path) await files.remove(rec.storage_path);
  await store.remove("recordings", { id: rec.id });
}

// ---- audio overviews ----

export type LocalPodcast = { id: string; session_id: string; title: string; script: PodcastScript["lines"]; created_at: string };

export const listPodcasts = (store: Store, sessionId: string) => store.list<LocalPodcast>("podcasts", { session_id: sessionId }, { order: "created_at", desc: true });

export async function makePodcast(store: Store, keys: DeviceKeys, input: { sessionId: string; documentId?: string | null; title: string; minutes?: number; focus?: string | null }): Promise<LocalPodcast> {
  const ai = await deviceAi(store, keys, input.sessionId, "plan");
  if (!ai) throw new Error(NO_AI);
  const pages = await pagesFor(store, { sessionId: input.sessionId, documentId: input.documentId, max: 10 });
  if (!pages.length) throw new Error("Add a file with readable text first.");
  const res = await ai.groq.chat.completions.create({
    model: MODELS.chat,
    messages: podcastPrompt({ title: input.title, pages: pages.map((p) => ({ page: p.page, text: p.text })), minutes: input.minutes ?? 5, focus: input.focus }),
    response_format: { type: "json_object" },
    temperature: 0.6,
    ...modelBudget(MODELS.chat, 4000),
  });
  const script = parsePodcast(res.choices[0]?.message?.content ?? "");
  if (!script) throw new Error("The AI didn't write a usable script. Try again.");
  const row = await store.put("podcasts", { session_id: input.sessionId, title: script.title, script: script.lines });
  return (await store.get<LocalPodcast>("podcasts", { id: row.id! }))!;
}

export const deletePodcast = (store: Store, id: string) => store.remove("podcasts", { id });

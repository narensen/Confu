import type { OutlineItem, SessionKind } from "@confu/core/types";
import type { FileStore } from "@confu/storage/files";
import type { Store } from "@confu/storage/store";
import { podcastAudioPaths } from "./speech";
import type { LocalPodcast } from "./tools";

// The student's library on this device: sessions, the files in them, and
// the chat. Rows go to the database (and from there to the sync); the
// original files go to the device's file store.

export type LocalSession = {
  id: string;
  title: string;
  kind: SessionKind;
  research_goal: string;
  exam_date: string | null;
  archived_at: string | null;
  cite_mode: boolean;
  created_at: string;
  updated_at: string;
};

export type LocalDocument = {
  id: string;
  session_id: string;
  title: string;
  storage_path: string | null;
  page_count: number;
  outline: OutlineItem[];
  status: "processing" | "ready" | "failed";
  last_page: number;
  position: number;
  source_url: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type LocalMessage = {
  id: string;
  session_id: string;
  document_id: string | null;
  role: "user" | "assistant";
  action: string;
  content: string;
  page_number: number | null;
  created_at: string;
};

// Text and outline from a PDF. The app passes in the browser's extractor
// (pdf.js); tests pass a fake.
export type Extracted = { pageCount: number; pages: string[]; outline: OutlineItem[] };
export type PdfExtractor = (file: Blob, onProgress?: (done: number, total: number) => void) => Promise<Extracted>;

const nowIso = () => new Date().toISOString();

// ---- sessions ----

export const listSessions = (store: Store) => store.list<LocalSession>("study_sessions", { archived_at: null }, { order: "updated_at", desc: true });

export const getSession = (store: Store, id: string) => store.get<LocalSession>("study_sessions", { id });

export async function createSession(store: Store, input: { title?: string; kind?: SessionKind } = {}): Promise<LocalSession> {
  const row = await store.put("study_sessions", { title: input.title?.trim() || "Untitled session", kind: input.kind ?? "study" });
  return (await getSession(store, row.id!))!;
}

export async function updateSession(store: Store, id: string, patch: Partial<Pick<LocalSession, "title" | "cite_mode" | "exam_date" | "research_goal">>) {
  const clean = { ...patch, ...(patch.title !== undefined ? { title: patch.title.trim() || "Untitled session" } : {}) };
  await store.put("study_sessions", { id, ...clean, updated_at: nowIso() });
}

// Moves the session to the top of the library.
export const touchSession = (store: Store, id: string) => store.put("study_sessions", { id, updated_at: nowIso() });

// The session and everything in it: files, pages, chat, notes, plans,
// reviews, and a key kept for this session only.
export async function deleteSession(store: Store, files: FileStore, id: string) {
  for (const doc of await listDocuments(store, id)) await removeDocument(store, files, doc);
  for (const plan of await store.list<{ id: string }>("study_plans", { session_id: id })) {
    await store.removeWhere("plan_topics", { plan_id: plan.id });
  }
  for (const rec of await store.list<{ storage_path: string | null }>("recordings", { session_id: id })) if (rec.storage_path) await files.remove(rec.storage_path);
  for (const p of await store.list<LocalPodcast>("podcasts", { session_id: id })) for (const path of podcastAudioPaths(p)) await files.remove(path);
  for (const table of ["messages", "saved_answers", "study_plans", "review_items", "exam_attempts", "explain_backs", "page_pins", "cards", "notes", "recordings", "podcasts", "ai_keys"]) {
    await store.removeWhere(table, { session_id: id });
  }
  await store.removeWhere("learner_memory", { session_id: id });
  await store.remove("study_sessions", { id });
}

// ---- documents ----

export const listDocuments = (store: Store, sessionId: string) => store.list<LocalDocument>("documents", { session_id: sessionId }, { order: "position" });

export const getDocument = (store: Store, id: string) => store.get<LocalDocument>("documents", { id });

export const pdfTitle = (name: string) => name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim() || "Untitled";

// Reads the PDF's text first (a file pdf.js can't open is refused before
// anything is saved), then keeps the file, its pages and its row.
export async function addPdf(
  store: Store,
  files: FileStore,
  input: { sessionId: string; file: Blob; title: string; extract: PdfExtractor; onProgress?: (done: number, total: number) => void },
): Promise<LocalDocument> {
  const { pageCount, pages, outline } = await input.extract(input.file, input.onProgress);
  const id = crypto.randomUUID();
  const path = `docs/${id}.pdf`;
  const [last] = await store.query<{ p: number | null }>(`SELECT max(position) AS p FROM documents WHERE session_id = ?`, [input.sessionId]);
  await files.put(path, input.file);
  try {
    await store.putMany(
      "document_pages",
      pages.map((content, i) => ({ document_id: id, page_number: i + 1, content })),
    );
    await store.put("documents", {
      id,
      session_id: input.sessionId,
      title: input.title.trim() || "Untitled",
      storage_path: path,
      page_count: pageCount,
      outline,
      status: "ready",
      position: (last?.p ?? -1) + 1,
      meta: { bytes: input.file.size, readable: pages.filter((p) => p.trim().length > 40).length },
    });
  } catch (e) {
    await store.removeWhere("document_pages", { document_id: id }).catch(() => {});
    await files.remove(path).catch(() => {});
    throw e;
  }
  await touchSession(store, input.sessionId);
  return (await getDocument(store, id))!;
}

export async function documentFile(files: FileStore, doc: Pick<LocalDocument, "storage_path">): Promise<Blob | null> {
  return doc.storage_path ? files.get(doc.storage_path) : null;
}

export async function renameDocument(store: Store, id: string, title: string) {
  await store.put("documents", { id, title: title.trim() || "Untitled", updated_at: nowIso() });
}

export async function setLastPage(store: Store, id: string, page: number) {
  await store.put("documents", { id, last_page: Math.max(1, Math.floor(page)) });
}

export async function removeDocument(store: Store, files: FileStore, doc: Pick<LocalDocument, "id" | "storage_path">) {
  for (const table of ["document_pages", "highlights", "page_time", "page_pins"]) await store.removeWhere(table, { document_id: doc.id });
  await store.removeWhere("paper_reviews", { document_id: doc.id });
  await store.remove("documents", { id: doc.id });
  if (doc.storage_path) await files.remove(doc.storage_path);
}

// ---- chat ----

export const listMessages = (store: Store, sessionId: string) => store.list<LocalMessage>("messages", { session_id: sessionId }, { order: "created_at" });

export const clearChat = (store: Store, sessionId: string) => store.removeWhere("messages", { session_id: sessionId });

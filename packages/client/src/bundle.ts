import type { FileStore } from "@confu/storage/files";
import type { Store } from "@confu/storage/store";
import { TABLE } from "@confu/storage/tables";
import { getSession, touchSession, type LocalSession } from "./library";

// A session in one file (".confu"): its rows and its PDFs and recordings.
// Used to share a session (as a file, or a Drive link) and to back one up.
//
// Layout: "CONFU1\n", a 4-byte big-endian header length, the header (JSON),
// then the files' bytes one after another.

const MAGIC = "CONFU1\n";
export const BUNDLE_TYPE = "application/x-confu-session";

// What travels with a shared session. The student's own progress (tutor
// notes about them, review schedule, exam scores, reading time) stays home.
const SHARED = ["documents", "document_pages", "highlights", "saved_answers", "study_plans", "plan_topics", "notes", "cards", "recordings", "podcasts", "videos"] as const;
const WITH_CHAT = [...SHARED, "messages"] as const;

type Row = Record<string, unknown>;
type Header = {
  format: "confu-session";
  version: 1;
  exported_at: string;
  session: LocalSession;
  tables: Record<string, Row[]>;
  files: { path: string; offset: number; size: number; type: string }[];
};

async function rowsOf(store: Store, sessionId: string, table: string, docIds: string[], planIds: string[]): Promise<Row[]> {
  if (table === "document_pages") return docIds.length ? (await Promise.all(docIds.map((id) => store.list<Row>(table, { document_id: id })))).flat() : [];
  if (table === "highlights") return (await Promise.all(docIds.map((id) => store.list<Row>(table, { document_id: id })))).flat();
  if (table === "plan_topics") return (await Promise.all(planIds.map((id) => store.list<Row>(table, { plan_id: id })))).flat();
  return store.list<Row>(table, { session_id: sessionId });
}

export async function exportSession(store: Store, files: FileStore, sessionId: string, opts: { chat?: boolean } = {}): Promise<Blob> {
  const session = await getSession(store, sessionId);
  if (!session) throw new Error("That session isn't on this device.");
  const docs = await store.list<{ id: string }>("documents", { session_id: sessionId });
  const plans = await store.list<{ id: string }>("study_plans", { session_id: sessionId });
  const tables: Record<string, Row[]> = {};
  for (const table of opts.chat ? WITH_CHAT : SHARED) {
    tables[table] = await rowsOf(
      store,
      sessionId,
      table,
      docs.map((d) => d.id),
      plans.map((p) => p.id),
    );
  }
  const parts: Blob[] = [];
  const list: Header["files"] = [];
  let offset = 0;
  for (const row of [...(tables.documents ?? []), ...(tables.recordings ?? [])]) {
    const path = row.storage_path as string | null;
    if (!path) continue;
    const blob = await files.get(path);
    if (!blob) continue;
    list.push({ path, offset, size: blob.size, type: blob.type });
    parts.push(blob);
    offset += blob.size;
  }
  const header: Header = { format: "confu-session", version: 1, exported_at: new Date().toISOString(), session, tables, files: list };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, json.length);
  return new Blob([MAGIC, len, json, ...parts], { type: BUNDLE_TYPE });
}

export async function readBundleHeader(bundle: Blob): Promise<{ header: Header; dataStart: number }> {
  const head = new Uint8Array(await bundle.slice(0, MAGIC.length + 4).arrayBuffer());
  if (new TextDecoder().decode(head.slice(0, MAGIC.length)) !== MAGIC) throw new Error("That isn't a Confu session file.");
  const len = new DataView(head.buffer).getUint32(MAGIC.length);
  const start = MAGIC.length + 4;
  const header = JSON.parse(await bundle.slice(start, start + len).text()) as Header;
  if (header.format !== "confu-session" || header.version !== 1) throw new Error("This session file is from a newer Confu. Update Confu and try again.");
  return { header, dataStart: start + len };
}

// Adds the session in `bundle` as a new session on this device (new ids
// throughout, so importing twice gives two copies). Flashcards come back
// as new cards. Returns the new session.
export async function importSession(store: Store, files: FileStore, bundle: Blob, opts: { title?: string } = {}): Promise<LocalSession> {
  const { header, dataStart } = await readBundleHeader(bundle);
  const ids = new Map<string, string>();
  const fresh = (old: unknown) => {
    if (typeof old !== "string") return old ?? null;
    if (!ids.has(old)) ids.set(old, crypto.randomUUID());
    return ids.get(old)!;
  };
  const mapped = (old: unknown) => (typeof old === "string" && ids.has(old) ? ids.get(old)! : (old ?? null));
  const sessionId = crypto.randomUUID();
  const t = header.tables;

  // Ids that other rows point at, first.
  for (const table of ["documents", "study_plans", "plan_topics", "highlights", "recordings"]) for (const r of t[table] ?? []) fresh(r.id);
  const paths = new Map<string, string>();
  const newPath = (old: unknown) => {
    if (typeof old !== "string") return null;
    if (!paths.has(old)) paths.set(old, old.replace(/[^/]+(?=\.[a-z0-9]+$)/i, crypto.randomUUID()));
    return paths.get(old)!;
  };

  // Only the tables a shared session carries, and only columns this version
  // knows: a session file can't write anywhere else (keys, settings).
  const rows: [string, Row[]][] = [];
  for (const table of WITH_CHAT) {
    const list = t[table];
    if (!Array.isArray(list)) continue;
    const known = new Set(TABLE[table].columns.map((c) => c.name));
    rows.push([
      table,
      list.map((r) => {
        const out: Row = Object.fromEntries(Object.entries(r).filter(([k]) => known.has(k)));
        if ("id" in r) out.id = fresh(r.id);
        if ("session_id" in r) out.session_id = sessionId;
        for (const k of ["document_id", "plan_id", "topic_id", "highlight_id"]) if (k in r) out[k] = mapped(r[k]);
        if ("storage_path" in r) out.storage_path = newPath(r.storage_path);
        if (table === "cards") Object.assign(out, { due: new Date().toISOString(), stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null });
        return out;
      }),
    ]);
  }

  // Files first: a row is never left pointing at a file that isn't here.
  for (const f of header.files) {
    const to = paths.get(f.path) ?? newPath(f.path);
    if (to) await files.put(to, new Blob([await bundle.slice(dataStart + f.offset, dataStart + f.offset + f.size).arrayBuffer()], { type: f.type }));
  }
  const s = header.session;
  await store.put("study_sessions", { id: sessionId, title: opts.title?.trim() || s.title, kind: s.kind, research_goal: s.research_goal, exam_date: s.exam_date, cite_mode: s.cite_mode });
  for (const [table, list] of rows) await store.putMany(table, list);
  await touchSession(store, sessionId);
  return (await getSession(store, sessionId))!;
}

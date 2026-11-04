import { describe, expect, test } from "bun:test";
import { bunDriver } from "@confu/storage/drivers/bun";
import { Clock, formatHlc, parseHlc } from "@confu/storage/hlc";
import { pageSnippets, searchPages, searchSessionPages } from "@confu/storage/search";
import { memoryFiles } from "@confu/storage/files";
import { Store } from "@confu/storage/store";

const open = (device = "dev-a") => Store.open(bunDriver(), { device });

async function sessionWithPages(store: Store) {
  await store.put("study_sessions", { id: "s1", title: "Linear algebra" });
  await store.put("documents", { id: "d1", session_id: "s1", title: "PCA notes", page_count: 3 });
  await store.put("document_pages", { document_id: "d1", page_number: 1, content: "Vectors and matrices. A matrix maps vectors to vectors." });
  await store.put("document_pages", { document_id: "d1", page_number: 2, content: "Principal components are the eigenvectors of the covariance matrix." });
  await store.put("document_pages", { document_id: "d1", page_number: 3, content: "Each eigenvalue measures the variance captured along its direction." });
}

describe("Store", () => {
  test("creates the schema once and keeps its device id", async () => {
    const raw = bunDriver();
    const a = await Store.open(raw, { device: "dev-a" });
    expect(a.device).toBe("dev-a");
    expect(await a.query<{ user_version: number }>("PRAGMA user_version")).toEqual([{ user_version: 1 }]);
  });

  test("converts JSON and booleans both ways", async () => {
    const s = await open();
    await s.put("study_sessions", { id: "s1", title: "T", cite_mode: true });
    await s.put("documents", { id: "d1", session_id: "s1", title: "Doc", outline: [{ title: "Intro", page: 1 }], meta: { arxiv: "1706.03762" } });
    const doc = await s.get<{ outline: unknown; meta: unknown; status: string }>("documents", { id: "d1" });
    expect(doc?.outline).toEqual([{ title: "Intro", page: 1 }]);
    expect(doc?.meta).toEqual({ arxiv: "1706.03762" });
    expect(doc?.status).toBe("processing"); // the column default
    expect((await s.get<{ cite_mode: boolean }>("study_sessions", { id: "s1" }))?.cite_mode).toBe(true);
  });

  test("an update changes only the columns given", async () => {
    const s = await open();
    await s.put("study_sessions", { id: "s1", title: "Before", research_goal: "Keep me" });
    await s.put("study_sessions", { id: "s1", title: "After" });
    const row = await s.get<{ title: string; research_goal: string }>("study_sessions", { id: "s1" });
    expect(row).toMatchObject({ title: "After", research_goal: "Keep me" });
  });

  test("creates ids, filters and orders lists", async () => {
    const s = await open();
    const m1 = await s.put("messages", { session_id: "s1", role: "user", content: "first", created_at: "2026-01-01T00:00:00Z" });
    await s.put("messages", { session_id: "s1", role: "assistant", content: "second", created_at: "2026-01-02T00:00:00Z" });
    await s.put("messages", { session_id: "s2", role: "user", content: "other", created_at: "2026-01-03T00:00:00Z" });
    expect(m1.id).toMatch(/^[0-9a-f-]{36}$/);
    const list = await s.list<{ content: string }>("messages", { session_id: "s1" }, { order: "created_at", desc: true });
    expect(list.map((m) => m.content)).toEqual(["second", "first"]);
  });

  test("rejects unknown tables and columns", async () => {
    const s = await open();
    await expect(s.put("nope", { id: "x" })).rejects.toThrow(/Unknown table/);
    await expect(s.put("messages", { id: "x", "content; DROP TABLE messages": 1 })).rejects.toThrow(/no column/);
  });
});

describe("page search", () => {
  test("finds the right page first, within the session", async () => {
    const s = await open();
    await sessionWithPages(s);
    await s.put("documents", { id: "d2", session_id: "other", title: "Other" });
    await s.put("document_pages", { document_id: "d2", page_number: 1, content: "Eigenvectors of the covariance matrix, again." });
    const hits = await searchSessionPages(s, "s1", "What are the eigenvectors of the covariance matrix?");
    expect(hits[0]).toMatchObject({ document_id: "d1", page_number: 2 });
    expect(hits.every((h) => h.document_id === "d1")).toBe(true);
  });

  test("stems words (eigenvalues finds eigenvalue)", async () => {
    const s = await open();
    await sessionWithPages(s);
    expect((await searchPages(s, "d1", "eigenvalues variance"))[0]?.page_number).toBe(3);
  });

  test("treats query syntax in a question as plain words", async () => {
    const s = await open();
    await sessionWithPages(s);
    for (const q of ['"unclosed', "NEAR(matrix", "matrix* OR -vectors", "col:umn", "AND OR NOT"]) {
      await expect(searchSessionPages(s, "s1", q)).resolves.toBeArray();
    }
    expect(await searchSessionPages(s, "s1", "what is the")).toEqual([]); // only stopwords
  });

  test("stays in step when a page changes or is removed", async () => {
    const s = await open();
    await sessionWithPages(s);
    await s.put("document_pages", { document_id: "d1", page_number: 2, content: "Rewritten: singular value decomposition." });
    expect(await searchPages(s, "d1", "covariance")).toEqual([]);
    expect((await searchPages(s, "d1", "singular decomposition"))[0]?.page_number).toBe(2);
    await s.remove("document_pages", { document_id: "d1", page_number: 2 });
    expect(await searchPages(s, "d1", "singular decomposition")).toEqual([]);
  });

  test("page snippets collapse whitespace", async () => {
    const s = await open();
    await s.put("document_pages", { document_id: "d1", page_number: 1, content: "Line one\n\n   line   two" });
    expect(await pageSnippets(s, "d1", 20)).toEqual([{ page_number: 1, snippet: "Line one line two" }]);
  });
});

describe("change log and sync", () => {
  test("logs every change to a synced table, and nothing for device-only ones", async () => {
    const s = await open();
    await s.put("study_sessions", { id: "s1", title: "T" });
    await s.remove("study_sessions", { id: "s1" });
    await s.put("ai_keys", { id: "k1", provider: "groq", secret: "sealed" });
    const pending = await s.pending();
    expect(pending.map((c) => [c.tbl, c.op])).toEqual([
      ["study_sessions", "put"],
      ["study_sessions", "delete"],
    ]);
    await s.markSynced(pending[1].seq);
    expect(await s.pending()).toEqual([]);
  });

  test("another device receives the changes", async () => {
    const a = await open("dev-a");
    const b = await open("dev-b");
    await sessionWithPages(a);
    expect(await b.applyRemote(await a.pending())).toBe(5);
    expect((await b.get<{ title: string }>("study_sessions", { id: "s1" }))?.title).toBe("Linear algebra");
    // Search works on the receiving device too (the triggers ran).
    expect((await searchSessionPages(b, "s1", "covariance eigenvectors"))[0]?.page_number).toBe(2);
    // Applying the same changes twice changes nothing.
    expect(await b.applyRemote(await a.pending())).toBe(0);
  });

  test("the later edit wins, whichever arrives first", async () => {
    let t = 1_000;
    const a = await Store.open(bunDriver(), { device: "dev-a" });
    const b = await Store.open(bunDriver(), { device: "dev-b" });
    // Fixed clocks: a edits at t=1000, b at t=2000.
    (a.clock as unknown as { now: () => number }).now = () => t;
    (b.clock as unknown as { now: () => number }).now = () => t + 1000;
    await a.put("study_sessions", { id: "s1", title: "From A" });
    await b.put("study_sessions", { id: "s1", title: "From B" });
    const fromA = await a.pending();
    const fromB = await b.pending();
    await a.applyRemote(fromB);
    await b.applyRemote(fromA); // older than b's own edit: ignored
    expect((await a.get<{ title: string }>("study_sessions", { id: "s1" }))?.title).toBe("From B");
    expect((await b.get<{ title: string }>("study_sessions", { id: "s1" }))?.title).toBe("From B");
    t = 0;
  });

  test("a delete beats older edits, and a newer edit restores the row", async () => {
    const a = await open("dev-a");
    const b = await open("dev-b");
    await a.put("highlights", { id: "h1", document_id: "d1", kind: "text", page_number: 1 });
    const created = await a.pending();
    await a.remove("highlights", { id: "h1" });
    const deleted = (await a.pending()).slice(created.length);
    await b.applyRemote(deleted); // the delete arrives first
    await b.applyRemote(created); // the older create must not bring it back
    expect(await b.get("highlights", { id: "h1" })).toBeNull();
    await b.put("highlights", { id: "h1", document_id: "d1", kind: "text", page_number: 1, note: "back" });
    expect((await b.get<{ note: string }>("highlights", { id: "h1" }))?.note).toBe("back");
  });

  test("composite keys sync too", async () => {
    const a = await open("dev-a");
    const b = await open("dev-b");
    await a.put("page_time", { document_id: "d1", page_number: 7, seconds: 42, visits: 1 });
    await b.applyRemote(await a.pending());
    expect(await b.get<{ seconds: number }>("page_time", { document_id: "d1", page_number: 7 })).toMatchObject({ seconds: 42 });
  });
});

describe("Clock", () => {
  test("always moves forward, even if the wall clock goes back", () => {
    let wall = 5_000;
    const c = new Clock("d", undefined, () => wall);
    const one = c.tick();
    wall = 4_000;
    const two = c.tick();
    expect(two > one).toBe(true);
    expect(parseHlc(two)).toEqual({ ms: 5_000, counter: 1, device: "d" });
  });

  test("moves past a remote time", () => {
    const c = new Clock("d", undefined, () => 1_000);
    c.receive(formatHlc({ ms: 9_000, counter: 3, device: "x" }));
    expect(c.tick() > formatHlc({ ms: 9_000, counter: 3, device: "x" })).toBe(true);
  });
});

describe("partial updates", () => {
  test("can change one column of a row whose other columns are required", async () => {
    const s = await open();
    await s.put("plan_topics", { id: "t1", plan_id: "p1", position: 0, title: "Eigenvectors", due_date: "2030-01-01" });
    await s.put("plan_topics", { id: "t1", status: "in_progress" });
    expect(await s.get("plan_topics", { id: "t1" })).toMatchObject({ title: "Eigenvectors", status: "in_progress", plan_id: "p1" });
  });

  test("a new row without its required columns is refused", async () => {
    const s = await open();
    await expect(s.put("plan_topics", { id: "t2", status: "in_progress" })).rejects.toThrow(/NOT NULL/);
  });

  test("the change log carries the whole row after a partial update", async () => {
    const a = await open("dev-a");
    const b = await open("dev-b");
    await a.put("plan_topics", { id: "t1", plan_id: "p1", position: 0, title: "Eigenvectors", due_date: "2030-01-01" });
    await a.put("plan_topics", { id: "t1", status: "done" });
    await b.applyRemote((await a.pending()).slice(1)); // only the partial update arrives
    expect(await b.get("plan_topics", { id: "t1" })).toMatchObject({ title: "Eigenvectors", status: "done" });
  });
});

describe("batches", () => {
  test("putMany writes every row, searchable and logged", async () => {
    const s = await open();
    await s.put("documents", { id: "d1", session_id: "s1", title: "Notes" });
    await s.putMany(
      "document_pages",
      Array.from({ length: 40 }, (_, i) => ({ document_id: "d1", page_number: i + 1, content: i === 29 ? "The spectral theorem." : `Page ${i + 1}.` })),
    );
    expect((await s.list("document_pages", { document_id: "d1" })).length).toBe(40);
    expect((await searchPages(s, "d1", "spectral theorem"))[0]?.page_number).toBe(30);
    expect((await s.pending()).length).toBe(41);
  });

  test("removeWhere deletes only the matching rows and logs each delete", async () => {
    const s = await open();
    await sessionWithPages(s);
    await s.put("document_pages", { document_id: "d2", page_number: 1, content: "Another file." });
    expect(await s.removeWhere("document_pages", { document_id: "d1" })).toBe(3);
    expect((await s.list("document_pages")).map((p) => p.document_id)).toEqual(["d2"]);
    expect((await searchPages(s, "d1", "eigenvalue")).length).toBe(0);
    const deletes = (await s.pending()).filter((c) => c.op === "delete");
    expect(deletes.map((c) => c.key).sort()).toEqual(["d1|1", "d1|2", "d1|3"]);
  });

  test("removeWhere refuses to delete everything", async () => {
    const s = await open();
    await expect(s.removeWhere("messages", {})).rejects.toThrow(/condition/);
  });
});

describe("files", () => {
  test("keeps, returns and removes bytes by path", async () => {
    const f = memoryFiles();
    await f.put("docs/a.pdf", new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    expect(await (await f.get("docs/a.pdf"))?.text()).toBe("%PDF-1.7");
    await f.remove("docs/a.pdf");
    expect(await f.get("docs/a.pdf")).toBeNull();
    await expect(f.put("../x", new Blob([]))).rejects.toThrow(/Bad file path/);
  });
});

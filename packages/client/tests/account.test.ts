import { describe, expect, test } from "bun:test";
import { importAccount, sessionIndex, type AccountExport } from "@confu/client/account";
import { listDocuments, listSessions } from "@confu/client/library";
import { bunDriver } from "@confu/storage/drivers/bun";
import { memoryFiles } from "@confu/storage/files";
import { searchPages } from "@confu/storage/search";
import { Store } from "@confu/storage/store";

const S = "11111111-1111-4111-8111-111111111111";
const D = "22222222-2222-4222-8222-222222222222";

// What /api/export/device returns: server rows (extra server columns included).
const exported: AccountExport = {
  format: "confu-account",
  version: 1,
  tables: {
    study_sessions: [{ id: S, user_id: "u1", title: "Biology", kind: "study", cite_mode: true, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" }],
    documents: [{ id: D, session_id: S, user_id: "u1", title: "Cells", storage_path: `docs/${D}.pdf`, page_count: 2, outline: [{ title: "Intro", page: 1, level: 0 }], status: "ready" }],
    document_pages: [
      { document_id: D, page_number: 1, content: "Cells are the unit of life." },
      { document_id: D, page_number: 2, content: "Mitochondria make ATP." },
    ],
    review_items: [{ id: "33333333-3333-4333-8333-333333333333", session_id: S, source: "highlight", source_key: "k", prompt: "p", due_at: "2026-11-10T00:00:00.000Z" }],
    ai_keys: [{ id: "x", provider: "groq", secret: "server-sealed" }],
  },
  files: [{ path: `docs/${D}.pdf`, url: "https://storage.example/signed/cells.pdf" }],
};

describe("bringing an account over", () => {
  test("copies rows and files, keeps ids, skips device-only tables, and can run again", async () => {
    const store = await Store.open(bunDriver(), { device: "dev-a" });
    const files = memoryFiles();
    const fetched: string[] = [];
    const fake = async (url: RequestInfo | URL) => (fetched.push(String(url)), new Response(new Blob(["%PDF cells"])));
    const r = await importAccount(store, files, exported, { fetch: fake });
    expect(r).toEqual({ sessions: 1, rows: 5, files: 1, missing: 0 });
    expect(await listSessions(store)).toMatchObject([{ id: S, title: "Biology", cite_mode: true }]);
    expect(await listDocuments(store, S)).toMatchObject([{ id: D, outline: [{ title: "Intro" }] }]);
    expect((await searchPages(store, D, "mitochondria"))[0]?.page_number).toBe(2);
    expect(await (await files.get(`docs/${D}.pdf`))?.text()).toBe("%PDF cells");
    expect(await store.list("ai_keys")).toEqual([]);
    // Again: nothing doubles, the file isn't fetched twice.
    await importAccount(store, files, exported, { fetch: fake });
    expect((await listSessions(store)).length).toBe(1);
    expect(fetched.length).toBe(1);
  });

  test("a file that can't be fetched is counted, not fatal", async () => {
    const store = await Store.open(bunDriver(), { device: "dev-a" });
    const r = await importAccount(store, memoryFiles(), exported, { fetch: async () => new Response("gone", { status: 404 }) });
    expect(r.missing).toBe(1);
    expect((await listSessions(store)).length).toBe(1);
  });

  test("the index holds titles, file counts and the next review, nothing else", async () => {
    const store = await Store.open(bunDriver(), { device: "dev-a" });
    await importAccount(store, memoryFiles(), exported, { fetch: async () => new Response("x") });
    await store.put("cards", { session_id: S, front: "ATP?", back: "Energy", due: "2026-11-08T00:00:00.000Z" });
    expect(await sessionIndex(store, Date.parse("2026-11-09T12:00:00Z"))).toEqual([
      { session_id: S, title: "Biology", kind: "study", updated_at: "2026-10-02T00:00:00Z", files: 1, next_review_at: "2026-11-08T00:00:00.000Z", reviews_due: 2, device: "dev-a" },
    ]);
    expect((await sessionIndex(store, Date.parse("2026-11-01T00:00:00Z")))[0].reviews_due).toBe(0);
  });
});

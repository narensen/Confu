import { afterAll, describe, expect, test } from "bun:test";
import { exportSession, importSession } from "@confu/client/bundle";
import { addPdf, createSession, listDocuments, listSessions, updateSession, type PdfExtractor } from "@confu/client/library";
import { driveRemote, readPublicDriveFile } from "@confu/client/sync/drive";
import { changeFileName, syncOnce } from "@confu/client/sync/engine";
import { memoryRemote } from "@confu/client/sync/remote";
import { bunDriver } from "@confu/storage/drivers/bun";
import { memoryFiles } from "@confu/storage/files";
import { searchPages } from "@confu/storage/search";
import { Store } from "@confu/storage/store";
import { fakeDrive } from "./fake-drive";

const extract: PdfExtractor = async (file) => {
  const pages = (await file.text()).split("\n");
  return { pageCount: pages.length, pages, outline: [] };
};
const device = async (name: string) => ({ store: await Store.open(bunDriver(), { device: name }), files: memoryFiles() });

describe("sync between devices", () => {
  test("a session made on one device shows up on another, file and all", async () => {
    const remote = memoryRemote();
    const a = await device("dev-a");
    const b = await device("dev-b");
    const s = await createSession(a.store, { title: "Linear algebra" });
    const doc = await addPdf(a.store, a.files, { sessionId: s.id, file: new Blob(["Vectors.\nEigenvectors of the covariance matrix."]), title: "Notes", extract });

    const sentA = await syncOnce(a.store, a.files, remote);
    expect(sentA.sent).toBeGreaterThan(0);
    expect(sentA.uploaded).toBe(1);
    const gotB = await syncOnce(b.store, b.files, remote);
    expect(gotB.received).toBe(sentA.sent);
    expect(gotB.downloaded).toBe(1);

    expect((await listSessions(b.store)).map((x) => x.title)).toEqual(["Linear algebra"]);
    expect(await (await b.files.get(doc.storage_path!))?.text()).toContain("covariance");
    expect((await searchPages(b.store, doc.id, "covariance"))[0]?.page_number).toBe(2);
    // Nothing goes back and forth for nothing.
    expect(await syncOnce(b.store, b.files, remote)).toEqual({ sent: 0, received: 0, uploaded: 0, downloaded: 0 });
    expect((await syncOnce(a.store, a.files, remote)).received).toBe(0);
  });

  test("edits and deletes travel both ways; the later edit wins", async () => {
    const remote = memoryRemote();
    const a = await device("dev-a");
    const b = await device("dev-b");
    const s = await createSession(a.store, { title: "One" });
    const other = await createSession(a.store, { title: "Two" });
    await syncOnce(a.store, a.files, remote);
    await syncOnce(b.store, b.files, remote);

    await updateSession(a.store, s.id, { title: "From A" });
    await Bun.sleep(2);
    await updateSession(b.store, s.id, { title: "From B, later" });
    await b.store.remove("study_sessions", { id: other.id });
    await syncOnce(a.store, a.files, remote);
    await syncOnce(b.store, b.files, remote);
    await syncOnce(a.store, a.files, remote);
    for (const d of [a, b]) expect((await listSessions(d.store)).map((x) => x.title)).toEqual(["From B, later"]);
  });

  test("an upload that was retried (overlapping files) applies once", async () => {
    const remote = memoryRemote();
    const a = await device("dev-a");
    const b = await device("dev-b");
    await createSession(a.store, { title: "First" });
    // A crash after uploading but before remembering it: the same changes go
    // up again, with more after them.
    const pending = await a.store.pending();
    await remote.write(changeFileName("dev-a", pending[0].seq, pending.at(-1)!.seq), new Blob([JSON.stringify({ changes: pending.map(({ tbl, key, op, hlc, data }) => ({ tbl, key, op, hlc, data })) })]));
    await createSession(a.store, { title: "Second" });
    await syncOnce(a.store, a.files, remote);
    await syncOnce(b.store, b.files, remote);
    expect((await listSessions(b.store)).map((x) => x.title).sort()).toEqual(["First", "Second"]);
  });

  test("a device waits for a missing earlier file instead of skipping it", async () => {
    const remote = memoryRemote();
    const b = await device("dev-b");
    await remote.write(changeFileName("dev-a", 5, 6), new Blob([JSON.stringify({ changes: [] })]));
    await syncOnce(b.store, b.files, remote);
    expect(await b.store.getMeta("sync.in.dev-a")).toBeNull();
  });
});

describe("Google Drive", () => {
  const drive = fakeDrive();
  afterAll(() => drive.stop());
  let fresh = 0;
  const token = async (o?: { fresh?: boolean }) => (o?.fresh && fresh++, "tok");

  test("syncs two devices through Drive, with a big file uploaded in a resumable upload", async () => {
    const remoteA = driveRemote(token, { api: drive.url });
    const remoteB = driveRemote(token, { api: drive.url });
    const a = await device("dev-a");
    const b = await device("dev-b");
    const s = await createSession(a.store, { title: "Physics" });
    const big = "x".repeat(6 * 1024 * 1024) + "\nLast page about entropy.";
    const doc = await addPdf(a.store, a.files, { sessionId: s.id, file: new Blob([big], { type: "application/pdf" }), title: "Book", extract });
    await syncOnce(a.store, a.files, remoteA);
    expect(drive.requests).toContain("POST /upload/drive/v3/files?uploadType=resumable");
    await syncOnce(b.store, b.files, remoteB);
    expect((await listDocuments(b.store, s.id)).map((d) => d.title)).toEqual(["Book"]);
    expect((await b.files.get(doc.storage_path!))?.size).toBe(new Blob([big]).size);
    // One folder, found again by its tag rather than made twice.
    expect([...drive.files.values()].filter((f) => f.mimeType.endsWith("folder")).length).toBe(1);
  });

  test("asks for a fresh token when Drive refuses the old one", async () => {
    const remote = driveRemote(token, { api: drive.url });
    drive.expireToken();
    await remote.list("changes.");
    expect(fresh).toBe(1);
  });

  test("a shared session opens from its link without signing in", async () => {
    const remote = driveRemote(token, { api: drive.url });
    const a = await device("dev-a");
    const s = await createSession(a.store, { title: "Shared" });
    await addPdf(a.store, a.files, { sessionId: s.id, file: new Blob(["Page one."]), title: "Doc", extract });
    const file = await remote.write(`share.${s.id}.confu`, await exportSession(a.store, a.files, s.id));
    await expect(readPublicDriveFile(file.id, "api-key", fetch, drive.url)).rejects.toThrow(/isn't there/);
    expect(drive.requests).toContain("POST /upload/drive/v3/files?uploadType=multipart");
    await remote.share(file.id);
    const friend = await device("dev-friend");
    const got = await importSession(friend.store, friend.files, await readPublicDriveFile(file.id, "api-key", fetch, drive.url));
    expect(got.title).toBe("Shared");
    expect((await listDocuments(friend.store, got.id)).length).toBe(1);
  });
});

describe("session files", () => {
  test("round-trip with new ids, files, pages, plans; chat only when asked; progress stays home", async () => {
    const a = await device("dev-a");
    const s = await createSession(a.store, { title: "Chem" });
    await updateSession(a.store, s.id, { cite_mode: true });
    const doc = await addPdf(a.store, a.files, { sessionId: s.id, file: new Blob(["Atoms.\nMoles and molar mass."], { type: "application/pdf" }), title: "Ch 1", extract });
    const plan = await a.store.put("study_plans", { session_id: s.id, goal: "Pass", deadline: "2030-01-01" });
    await a.store.put("plan_topics", { plan_id: plan.id, position: 0, title: "Moles", due_date: "2030-01-01", document_id: doc.id, page_start: 2 });
    await a.store.put("messages", { session_id: s.id, role: "user", content: "What is a mole?", document_id: doc.id });
    await a.store.put("learner_memory", { session_id: s.id, summary: "Private notes about me" });
    await a.store.put("cards", { session_id: s.id, front: "Mole?", back: "6.022e23 things", reps: 5, state: 2 });

    const b = await device("dev-b");
    const plain = await importSession(b.store, b.files, await exportSession(a.store, a.files, s.id));
    expect(plain.id).not.toBe(s.id);
    expect(plain).toMatchObject({ title: "Chem", cite_mode: true });
    const [copy] = await listDocuments(b.store, plain.id);
    expect(copy.id).not.toBe(doc.id);
    expect(await (await b.files.get(copy.storage_path!))?.text()).toContain("Moles");
    expect((await searchPages(b.store, copy.id, "molar mass"))[0]?.page_number).toBe(2);
    const [topic] = await b.store.list<{ document_id: string; plan_id: string }>("plan_topics");
    expect(topic.document_id).toBe(copy.id);
    expect(await b.store.list("messages")).toEqual([]);
    expect(await b.store.list("learner_memory")).toEqual([]);
    expect(await b.store.list("cards")).toMatchObject([{ front: "Mole?", reps: 0, state: 0 }]);

    const withChat = await importSession(b.store, b.files, await exportSession(a.store, a.files, s.id, { chat: true }));
    expect(await b.store.list("messages", { session_id: withChat.id })).toMatchObject([{ content: "What is a mole?" }]);
  });

  test("a session file can't write outside a session's tables", async () => {
    const a = await device("dev-a");
    const s = await createSession(a.store, { title: "X" });
    const real = await exportSession(a.store, a.files, s.id);
    const text = new TextDecoder().decode(new Uint8Array(await real.arrayBuffer()));
    const header = JSON.parse(text.slice(11));
    header.tables.ai_keys = [{ id: "evil", provider: "groq", secret: "x" }];
    header.tables.documents = [{ id: "d", session_id: s.id, title: "Doc", sneaky_column: 1 }];
    const json = new TextEncoder().encode(JSON.stringify(header));
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, json.length);
    const b = await device("dev-b");
    const got = await importSession(b.store, b.files, new Blob(["CONFU1\n", len, json]));
    expect(await b.store.list("ai_keys")).toEqual([]);
    expect((await listDocuments(b.store, got.id)).map((d) => d.title)).toEqual(["Doc"]);
    await expect(importSession(b.store, b.files, new Blob(["%PDF-1.7"]))).rejects.toThrow(/isn't a Confu session/);
  });
});

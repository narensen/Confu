import { describe, expect, test } from "bun:test";
import { addPdf, clearChat, createSession, deleteSession, documentFile, listDocuments, listMessages, listSessions, pdfTitle, removeDocument, updateSession, type PdfExtractor } from "@confu/client/library";
import { bunDriver } from "@confu/storage/drivers/bun";
import { memoryFiles } from "@confu/storage/files";
import { searchPages } from "@confu/storage/search";
import { Store } from "@confu/storage/store";

const open = () => Store.open(bunDriver(), { device: "dev-a" });
const pdf = (text: string) => new Blob([`%PDF-1.7 ${text}`], { type: "application/pdf" });

// Stands in for pdf.js: one page per line of the "file".
const extract: PdfExtractor = async (file, onProgress) => {
  const pages = (await file.text()).replace(/^%PDF-1\.7 /, "").split("\n");
  pages.forEach((_, i) => onProgress?.(i + 1, pages.length));
  return { pageCount: pages.length, pages, outline: [{ title: "Start", page: 1, level: 0 }] };
};

describe("library", () => {
  test("creates, lists newest first, renames", async () => {
    const store = await open();
    const a = await createSession(store, { title: "  Linear algebra " });
    await Bun.sleep(2);
    const b = await createSession(store);
    expect(a.title).toBe("Linear algebra");
    expect(b.title).toBe("Untitled session");
    expect((await listSessions(store)).map((s) => s.id)).toEqual([b.id, a.id]);
    await Bun.sleep(2);
    await updateSession(store, a.id, { title: "Matrices", cite_mode: true });
    const [first] = await listSessions(store);
    expect(first).toMatchObject({ id: a.id, title: "Matrices", cite_mode: true });
  });

  test("adds a PDF: file, searchable pages, outline, order", async () => {
    const store = await open();
    const files = memoryFiles();
    const s = await createSession(store, { title: "PCA" });
    const progress: number[] = [];
    const d1 = await addPdf(store, files, { sessionId: s.id, file: pdf("Vectors.\nEigenvectors of the covariance matrix."), title: pdfTitle("pca_notes.pdf"), extract, onProgress: (n) => progress.push(n) });
    const d2 = await addPdf(store, files, { sessionId: s.id, file: pdf("More."), title: "Second", extract });
    expect(d1).toMatchObject({ title: "pca notes", page_count: 2, status: "ready", position: 0, outline: [{ title: "Start", page: 1, level: 0 }] });
    expect(d2.position).toBe(1);
    expect(progress).toEqual([1, 2]);
    expect(await (await documentFile(files, d1))?.text()).toContain("covariance");
    expect((await searchPages(store, d1.id, "covariance eigenvectors"))[0]?.page_number).toBe(2);
    expect((await listDocuments(store, s.id)).map((d) => d.id)).toEqual([d1.id, d2.id]);
  });

  test("a PDF that can't be read saves nothing", async () => {
    const store = await open();
    const files = memoryFiles();
    const s = await createSession(store);
    const broken: PdfExtractor = async () => {
      throw new Error("Invalid PDF structure");
    };
    await expect(addPdf(store, files, { sessionId: s.id, file: pdf("x"), title: "Broken", extract: broken })).rejects.toThrow(/Invalid PDF/);
    expect(await listDocuments(store, s.id)).toEqual([]);
  });

  test("removing a document removes its file and pages", async () => {
    const store = await open();
    const files = memoryFiles();
    const s = await createSession(store);
    const d = await addPdf(store, files, { sessionId: s.id, file: pdf("One.\nTwo."), title: "Doc", extract });
    await removeDocument(store, files, d);
    expect(await listDocuments(store, s.id)).toEqual([]);
    expect(await store.list("document_pages", { document_id: d.id })).toEqual([]);
    expect(await documentFile(files, d)).toBeNull();
  });

  test("deleting a session removes everything in it, and nothing else", async () => {
    const store = await open();
    const files = memoryFiles();
    const keep = await createSession(store, { title: "Keep" });
    const gone = await createSession(store, { title: "Gone" });
    const kept = await addPdf(store, files, { sessionId: keep.id, file: pdf("Kept page."), title: "Kept", extract });
    const d = await addPdf(store, files, { sessionId: gone.id, file: pdf("Gone page."), title: "Gone", extract });
    await store.put("messages", { session_id: gone.id, role: "user", content: "hi" });
    await store.put("messages", { session_id: keep.id, role: "user", content: "hello" });
    await store.put("learner_memory", { session_id: gone.id, summary: "Knows vectors." });
    const plan = await store.put("study_plans", { session_id: gone.id, goal: "Pass", deadline: "2030-01-01" });
    await store.put("plan_topics", { plan_id: plan.id, position: 0, title: "Vectors", due_date: "2030-01-01" });

    await deleteSession(store, files, gone.id);
    expect((await listSessions(store)).map((s) => s.id)).toEqual([keep.id]);
    expect(await documentFile(files, d)).toBeNull();
    expect(await documentFile(files, kept)).not.toBeNull();
    expect((await store.list("messages")).length).toBe(1);
    expect(await store.list("plan_topics")).toEqual([]);
    expect(await store.get("learner_memory", { session_id: gone.id })).toBeNull();
    expect((await store.list("document_pages")).map((p) => p.document_id)).toEqual([kept.id]);
  });

  test("clears the chat of one session", async () => {
    const store = await open();
    const s = await createSession(store);
    await store.put("messages", { session_id: s.id, role: "user", content: "hi" });
    await store.put("messages", { session_id: s.id, role: "assistant", content: "hello" });
    expect((await listMessages(store, s.id)).length).toBe(2);
    expect(await clearChat(store, s.id)).toBe(2);
    expect(await listMessages(store, s.id)).toEqual([]);
  });
});

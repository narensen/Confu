"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addPdf, documentFile, getSession, listDocuments, pdfTitle, removeDocument, setLastPage, updateSession, type LocalDocument } from "@confu/client/library";
import { docLabel } from "@confu/core/types";
import { buttonClass, ghostButtonClass } from "@confu/ui/classes";
import { dropHandlers, InTopBar, isPdf, Notice } from "./chrome";
import { useDevice, useLocal } from "./local";
import { extractPdf } from "./pdf";
import { Reader, type Selection } from "./Reader";
import { Tutor, type Ask } from "./Tutor";

type Upload = { name: string; done: number; total: number };

export function SessionView({ sessionId, initialFiles, onFilesTaken, onBack }: { sessionId: string; initialFiles: File[] | null; onFilesTaken: () => void; onBack: () => void }) {
  const device = useDevice();
  const { store, files, changed } = device;
  const { data: session } = useLocal((d) => getSession(d.store, sessionId), [sessionId]);
  const { data: docs = [] } = useLocal((d) => listDocuments(d.store, sessionId), [sessionId]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [blob, setBlob] = useState<{ id: string; file: Blob | null } | null>(null);
  const [page, setPage] = useState(1);
  const [jump, setJump] = useState<{ page: number; seq: number } | null>(null);
  const [incoming, setIncoming] = useState<(Ask & { seq: number }) | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tab, setTab] = useState<"read" | "tutor">("read");
  const [title, setTitle] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Record<string, number>>({}); // where each file was left, this visit
  const taken = useRef<File[] | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = docs.find((d) => d.id === activeId) ?? docs[0] ?? null;

  // The open file's bytes, read once per file (not on every change).
  useEffect(() => {
    if (!active || blob?.id === active.id) return;
    let live = true;
    documentFile(files, active).then((file) => live && setBlob({ id: active.id, file }));
    return () => {
      live = false;
    };
  }, [active, blob?.id, files]);

  const addFiles = useCallback(
    async (picked: File[]) => {
      setProblem(null);
      const pdfs = picked.filter(isPdf);
      if (pdfs.length < picked.length) setProblem("Only PDFs can be added here for now.");
      let first = true;
      for (const file of pdfs) {
        setUpload({ name: file.name, done: 0, total: 0 });
        try {
          const doc = await addPdf(store, files, {
            sessionId,
            file,
            title: pdfTitle(file.name),
            extract: extractPdf,
            onProgress: (done, total) => setUpload({ name: file.name, done, total }),
          });
          const current = await getSession(store, sessionId);
          if (first && current?.title === "Untitled session") await updateSession(store, sessionId, { title: doc.title });
          first = false;
          setActiveId(doc.id);
          setTab("read");
          changed();
        } catch (e) {
          setProblem(`${file.name} couldn't be added: ${e instanceof Error ? e.message : "unknown error"}.`);
        }
      }
      setUpload(null);
    },
    [store, files, sessionId, changed],
  );

  // Files chosen in the library before this session existed.
  useEffect(() => {
    if (!initialFiles?.length || taken.current === initialFiles) return;
    taken.current = initialFiles;
    onFilesTaken();
    void addFiles(initialFiles);
  }, [initialFiles, onFilesTaken, addFiles]);

  const onPageChange = useCallback(
    (p: number) => {
      if (!active) return;
      setPage(p);
      const id = active.id;
      setPages((m) => (m[id] === p ? m : { ...m, [id]: p }));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void setLastPage(store, id, p), 800);
    },
    [active, store],
  );

  // Open a file, at a page when one is given (a citation).
  function open(doc: LocalDocument, at?: number) {
    if (at) setPages((m) => ({ ...m, [doc.id]: at }));
    if (doc.id !== active?.id) {
      setActiveId(doc.id);
      setPage(at ?? pages[doc.id] ?? doc.last_page);
    }
    setJump((j) => (at ? { page: at, seq: (j?.seq ?? 0) + 1 } : null));
    if (at) setTab("read");
  }

  async function remove(doc: LocalDocument) {
    if (!window.confirm(`Remove “${doc.title}” from this session? The file is deleted from this device.`)) return;
    await removeDocument(store, files, doc);
    if (doc.id === active?.id) {
      setActiveId(null);
      setBlob(null);
    }
    changed();
  }

  function onAsk(s: Selection) {
    if (!active) return;
    const selection = { text: s.text, page: s.page, documentId: active.id };
    setIncoming((prev) => ({ action: s.action, selection, seq: (prev?.seq ?? 0) + 1 }));
    setTab("tutor");
  }

  if (session === null) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <h1 className="font-serif text-2xl">This session isn&apos;t on this device</h1>
        <p className="mt-2 text-sm text-muted">It may have been deleted, or made on another device.</p>
        <button type="button" onClick={onBack} className={`${buttonClass} mt-6`}>
          Back to your library
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" {...dropHandlers((f) => void addFiles(f))}>
      <InTopBar>
        <button type="button" onClick={onBack} aria-label="Back to your library" className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-paper hover:text-ink">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <input
          value={title ?? session?.title ?? ""}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={async () => {
            if (title !== null && title.trim() !== session?.title) {
              await updateSession(store, sessionId, { title });
              changed();
            }
            setTitle(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          aria-label="Session title"
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:bg-paper focus:bg-paper"
        />
      </InTopBar>

      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-panel px-3 py-1.5 sm:px-4">
        {docs.map((d, i) => (
          <div
            key={d.id}
            className={`group flex max-w-60 shrink-0 items-center rounded-full border text-xs transition ${d.id === active?.id ? "border-ink bg-ink text-white" : "border-ink/20 text-muted hover:border-ink hover:text-ink"}`}
          >
            <button type="button" onClick={() => open(d)} className="flex min-w-0 items-center gap-1.5 py-1 pr-1 pl-3" title={d.title}>
              <span className="font-mono text-[10px] opacity-70">{docLabel(i)}</span>
              <span className="truncate">{d.title}</span>
            </button>
            <button type="button" onClick={() => remove(d)} aria-label={`Remove ${d.title}`} className="mr-1 flex size-5 shrink-0 items-center justify-center rounded-full opacity-50 transition hover:opacity-100">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
        <button type="button" onClick={() => picker.current?.click()} disabled={Boolean(upload)} className="shrink-0 rounded-full border border-dashed border-ink/40 px-3 py-1 text-xs font-medium text-muted transition hover:border-ink hover:text-ink disabled:opacity-40">
          + Add PDF
        </button>
        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            e.target.value = "";
            if (picked.length) void addFiles(picked);
          }}
        />
      </div>

      {upload && (
        <Notice tone="ok">
          Reading {upload.name}
          {upload.total ? ` — page ${upload.done} of ${upload.total}` : "…"}
        </Notice>
      )}
      {problem && (
        <Notice tone="danger" onDismiss={() => setProblem(null)}>
          {problem}
        </Notice>
      )}

      <div className="flex min-h-0 flex-1">
        <section className={`min-w-0 flex-1 ${tab === "tutor" ? "hidden lg:block" : ""}`}>
          {active && blob?.id === active.id && blob.file ? (
            <Reader key={active.id} file={blob.file} initialPage={pages[active.id] ?? active.last_page} jump={jump} onPageChange={onPageChange} onAsk={onAsk} />
          ) : active && blob?.id === active.id ? (
            <p className="m-6 text-sm text-danger">This file is missing from this device. Remove it and add it again.</p>
          ) : docs.length === 0 && session ? (
            <div className="flex h-full items-center justify-center bg-viewer p-6">
              <div className="w-full max-w-sm rounded-2xl border border-dashed border-ink/40 bg-panel p-8 text-center">
                <h2 className="font-serif text-xl">Add a PDF to study</h2>
                <p className="mt-1.5 text-sm text-muted">Drop it here, or choose a file. It stays on this device.</p>
                <button type="button" onClick={() => picker.current?.click()} disabled={Boolean(upload)} className={`${buttonClass} mt-5`}>
                  Choose a PDF
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full bg-viewer" />
          )}
        </section>
        <aside className={`w-full min-w-0 border-ink lg:w-[440px] lg:shrink-0 lg:border-l xl:w-[520px] ${tab === "read" ? "hidden lg:block" : ""}`}>
          {session && <Tutor sessionId={sessionId} citeMode={session.cite_mode} docs={docs} activeDoc={active} page={page} incoming={incoming} onCite={(id, p) => open(docs.find((d) => d.id === id)!, p)} />}
        </aside>
      </div>

      <nav className="flex shrink-0 gap-1 border-t border-ink bg-panel p-1.5 lg:hidden">
        {(["read", "tutor"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`${t === tab ? buttonClass : ghostButtonClass} flex-1 border-transparent`}>
            {t === "read" ? "Read" : "Tutor"}
          </button>
        ))}
      </nav>
    </div>
  );
}

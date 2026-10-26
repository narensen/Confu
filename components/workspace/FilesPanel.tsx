"use client";

import { eyebrowClass, ghostButtonClass } from "@/components/ui";
import type { SessionDoc } from "@/lib/types";
import { ToAddSection, type ToAddProps } from "./ToAddSection";

// A file on its way in: waiting its turn, being read and indexed, or failed
// (with Retry). Done ones simply appear in the list below.
export type UploadItem = { key: string; name: string; status: "waiting" | "working" | "failed"; note?: string };

export type FilesProps = {
  docs: SessionDoc[];
  activeId: string | null;
  open: Set<string>; // PDFs open as tabs above the viewer
  addLabel: string;
  onAdd: () => void;
  onAddPapers?: () => void; // study sessions: the paper search too
  uploads: UploadItem[];
  onRetry: (key: string) => void;
  onDismiss: (key: string) => void;
  later?: ToAddProps; // study sessions: what the goal names that isn't in yet
  onOpen: (docId: string) => void;
  onCloseTab: (doc: SessionDoc) => void;
  onDelete: (doc: SessionDoc) => void;
  // Study sessions: read a PDF as a paper, or not.
  paperIds?: Set<string>;
  onPaper?: (docId: string) => void;
  onNotPaper?: (docId: string) => void;
};

// Every file in the session (PDFs, and slides or documents converted to
// PDF), open as a tab or not. The tabs above the viewer are only what's
// open; this is where files are opened, closed and deleted.
export function FilesPanel({ docs, activeId, open, addLabel, onAdd, onAddPapers, uploads, onRetry, onDismiss, later, onOpen, onCloseTab, onDelete, paperIds, onPaper, onNotPaper }: FilesProps) {
  const openCount = docs.filter((d) => open.has(d.id)).length;
  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className={eyebrowClass}>Files</p>
          <h2 className="mt-1 font-serif text-2xl leading-tight">Everything in this session</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {docs.length
              ? `${docs.length} ${docs.length === 1 ? "file" : "files"}, ${openCount} open as ${openCount === 1 ? "a tab" : "tabs"}. New files land here: open one to read it. Closing a tab keeps the file here.`
              : "Nothing yet."}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button type="button" onClick={onAdd} className="rounded-md border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-white transition hover:-translate-y-px">
            {addLabel}
          </button>
          {onAddPapers && (
            <button type="button" onClick={onAddPapers} className={`${ghostButtonClass} py-1 text-xs`}>
              + Add papers
            </button>
          )}
        </div>
      </header>

      {uploads.length > 0 && (
        <section className="mt-5" aria-live="polite">
          <p className={eyebrowClass}>Coming in</p>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {uploads.map((u) => (
              <li key={u.key} className="flex items-center gap-3 px-3 py-2.5">
                <span
                  aria-hidden
                  className={`size-2 shrink-0 rounded-full ${u.status === "failed" ? "bg-danger" : u.status === "working" ? "animate-pulse bg-ink" : "bg-line"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{u.name}</span>
                  <span className={`block truncate text-xs ${u.status === "failed" ? "text-danger" : "text-muted"}`}>
                    {u.status === "waiting" ? "Waiting its turn" : (u.note ?? (u.status === "failed" ? "Couldn't add it" : "Working…"))}
                  </span>
                </span>
                {u.status === "failed" && (
                  <span className="flex shrink-0 items-center gap-1 text-xs">
                    <button type="button" onClick={() => onRetry(u.key)} className="rounded-md border border-ink px-2 py-0.5 font-medium transition hover:bg-ink hover:text-white">
                      Retry
                    </button>
                    <button type="button" onClick={() => onDismiss(u.key)} className="rounded px-1.5 py-0.5 text-muted transition hover:text-ink">
                      Dismiss
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {later && (later.later.papers.length > 0 || later.later.links.length > 0) && (
        <div className="mt-5">
          <ToAddSection {...later} />
        </div>
      )}

      {docs.length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-xl border border-line">
          {docs.map((d) => {
            const isOpen = open.has(d.id);
            const viewing = isOpen && d.id === activeId;
            const isPaperDoc = paperIds?.has(d.id);
            return (
              <li key={d.id} className={`group flex items-start gap-2.5 px-3 py-2.5 ${viewing ? "bg-yellow-50" : ""}`}>
                <span className={`mt-0.5 shrink-0 rounded px-1 font-mono text-[10px] ${viewing ? "bg-ink text-white" : "border border-ink/30 text-muted"}`}>{d.label}</span>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => onOpen(d.id)} title={isOpen ? "Show it" : "Open it as a tab"} className="block w-full truncate text-left text-sm font-medium hover:underline">
                    {d.title}
                  </button>
                  <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 text-xs">
                    <span className="text-muted">
                      {[d.hasPdf ? `${d.pageCount} ${d.pageCount === 1 ? "page" : "pages"}` : "No PDF yet", isPaperDoc ? "Paper" : "", viewing ? "Viewing" : isOpen ? "Open tab" : "Closed"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className="-mr-1.5 flex items-center">
                      {onPaper && onNotPaper && (
                        <button
                          type="button"
                          onClick={() => (isPaperDoc ? onNotPaper(d.id) : onPaper(d.id))}
                          title={isPaperDoc ? "Read it as a regular document (its pass notes are kept)" : "Read it with the three-pass method"}
                          className="rounded px-1.5 py-0.5 text-muted transition hover:bg-paper hover:text-ink"
                        >
                          {isPaperDoc ? "Not a paper" : "Read as paper"}
                        </button>
                      )}
                      {isOpen ? (
                        <button type="button" onClick={() => onCloseTab(d)} title="Close its tab (it stays here)" className="rounded px-1.5 py-0.5 text-muted transition hover:bg-paper hover:text-ink">
                          Close tab
                        </button>
                      ) : (
                        <button type="button" onClick={() => onOpen(d.id)} title="Open it as a tab" className="rounded px-1.5 py-0.5 text-muted transition hover:bg-paper hover:text-ink">
                          Open
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDelete(d)}
                        aria-label={`Delete ${d.title}`}
                        title="Delete it from the session"
                        className="rounded px-1.5 py-0.5 text-muted transition hover:bg-danger/10 hover:text-danger"
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useRef } from "react";
import type { SessionDoc } from "@/lib/types";

type Props = {
  docs: SessionDoc[];
  activeId: string | null;
  uploadStatus: string | null;
  onSelect: (id: string) => void;
  onAdd: (files: File[]) => void;
  onClose: (doc: SessionDoc) => void; // close the tab; the PDF stays in Files
  // Paper sessions open the "Add papers" dialog instead of a file picker.
  onAddClick?: () => void;
  addLabel?: string;
  // Study sessions: which files are papers (recognised automatically), and the way to their passes.
  paperIds?: Set<string>;
  onPaper?: (docId: string) => void;
};

// The PDFs open as tabs above the viewer. Closing one only hides it: every
// PDF is in the Files tab, where they're opened again or deleted.
export function DocTabs({ docs, activeId, uploadStatus, onSelect, onAdd, onClose, onAddClick, addLabel = "+ Add PDF", paperIds, onPaper }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const active = docs.find((d) => d.id === activeId);
  const activeIsPaper = Boolean(active && paperIds?.has(active.id));

  return (
    <div className="flex h-11 shrink-0 items-stretch border-b border-ink bg-paper">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Open files">
        {docs.map((d) => {
          const active = d.id === activeId;
          return (
            <div
              key={d.id}
              className={`group relative flex max-w-60 shrink-0 items-center border-r border-ink/15 transition-colors duration-200 ${
                active ? "bg-panel" : "hover:bg-panel/60"
              }`}
            >
              <button
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(d.id)}
                title={`${d.label}: ${d.title} (${d.pageCount} pages)`}
                className="flex min-w-0 items-center gap-2 py-2 pr-1 pl-3 text-left text-sm"
              >
                <span
                  className={`shrink-0 rounded px-1 font-mono text-[10px] transition-colors duration-200 ${
                    active ? "bg-ink text-white" : "border border-ink/30 text-muted"
                  }`}
                >
                  {d.label}
                </span>
                <span className={`truncate ${active ? "font-medium" : "text-muted"}`}>{d.title}</span>
                {paperIds?.has(d.id) && <span className="shrink-0 rounded bg-yellow-300 px-1 font-mono text-[9px] font-medium tracking-wide text-ink uppercase">Paper</span>}
              </button>
              <button
                onClick={() => onClose(d)}
                aria-label={`Close ${d.title}`}
                title="Close tab (it stays in Files)"
                className="mr-1.5 flex size-5 shrink-0 items-center justify-center rounded text-xs text-muted opacity-0 transition group-hover:opacity-100 hover:bg-ink/10 hover:text-ink focus:opacity-100"
              >
                ✕
              </button>
              {active && <span className="animate-fade absolute inset-x-0 -bottom-px h-0.5 bg-ink" />}
            </div>
          );
        })}
      </div>

      <input
        ref={input}
        type="file"
        accept="application/pdf,.pptx,.ppt,.odp,.docx,.doc,.odt,.rtf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onAdd(files);
        }}
      />
      {/* A paper (recognised automatically) gets a shortcut to its three passes. */}
      {onPaper && active && activeIsPaper && (
        <button
          type="button"
          onClick={() => onPaper(active.id)}
          title="Open this paper's three passes"
          className="hidden shrink-0 items-center gap-1.5 border-l border-ink bg-yellow-300 px-3 text-xs font-medium transition duration-200 hover:bg-yellow-400 sm:flex"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 2h9l5 5v15H6zM14 2v6h6M9 13h7M9 17h5" />
          </svg>
          Open its passes
        </button>
      )}
      <button
        onClick={() => (onAddClick ? onAddClick() : input.current?.click())}
        disabled={Boolean(uploadStatus)}
        className="flex shrink-0 items-center gap-1.5 border-l border-ink px-3 text-xs font-medium transition duration-200 hover:bg-ink hover:text-white disabled:pointer-events-none"
      >
        {uploadStatus ? (
          <>
            <span className="size-2 animate-pulse rounded-full bg-ink" />
            <span className="max-w-56 truncate text-muted">{uploadStatus}</span>
          </>
        ) : (
          addLabel
        )}
      </button>
    </div>
  );
}

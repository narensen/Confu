"use client";

import { useRef } from "react";
import type { SessionDoc } from "@/lib/types";

type Props = {
  docs: SessionDoc[];
  activeId: string | null;
  uploadStatus: string | null;
  onSelect: (id: string) => void;
  onAdd: (files: File[]) => void;
  onRemove: (doc: SessionDoc) => void;
};

// The session's PDFs as tabs above the viewer.
export function DocTabs({ docs, activeId, uploadStatus, onSelect, onAdd, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="flex h-11 shrink-0 items-stretch border-b border-ink bg-paper">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="PDFs in this session">
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
              </button>
              <button
                onClick={() => onRemove(d)}
                aria-label={`Remove ${d.title}`}
                title="Remove from session"
                className="mr-1.5 flex size-5 shrink-0 items-center justify-center rounded text-xs text-muted opacity-0 transition group-hover:opacity-100 hover:bg-danger/10 hover:text-danger focus:opacity-100"
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
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onAdd(files);
        }}
      />
      <button
        onClick={() => input.current?.click()}
        disabled={Boolean(uploadStatus)}
        className="flex shrink-0 items-center gap-1.5 border-l border-ink px-3 text-xs font-medium transition duration-200 hover:bg-ink hover:text-white disabled:pointer-events-none"
      >
        {uploadStatus ? (
          <>
            <span className="size-2 animate-pulse rounded-full bg-ink" />
            <span className="max-w-56 truncate text-muted">{uploadStatus}</span>
          </>
        ) : (
          "+ Add PDF"
        )}
      </button>
    </div>
  );
}

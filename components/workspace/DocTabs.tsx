"use client";

import { useRef, useState } from "react";
import type { SessionDoc } from "@/lib/types";

type Props = {
  docs: SessionDoc[];
  activeId: string | null;
  uploadStatus: string | null;
  onSelect: (id: string) => void;
  onAdd: (files: File[]) => void;
  onClose: (doc: SessionDoc) => void; // close the tab; the PDF stays in Files
  onReorder: (ids: string[]) => void;
  // Paper sessions open the "Add papers" dialog instead of a file picker.
  onAddClick?: () => void;
  addLabel?: string;
  // Study sessions: which files are papers (recognised automatically), and the way to their passes.
  paperIds?: Set<string>;
  onPaper?: (docId: string) => void;
};

type Drop = { id: string; side: "before" | "after" };

function place(ids: string[], from: string, to: string, side: Drop["side"]): string[] {
  if (from === to) return ids;
  const next = ids.filter((id) => id !== from);
  let at = next.indexOf(to);
  if (at < 0) return ids;
  if (side === "after") at += 1;
  next.splice(at, 0, from);
  return next;
}

// The PDFs open as tabs above the viewer. Closing one only hides it: every
// PDF is in the Files tab, where they're opened again or deleted.
export function DocTabs({ docs, activeId, uploadStatus, onSelect, onAdd, onClose, onReorder, onAddClick, addLabel = "+ Add PDF", paperIds, onPaper }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<string | null>(null);
  const pending = useRef<{ id: string; x: number } | null>(null);
  const moved = useRef(false);
  const dropRef = useRef<Drop | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [dragging, setDragging] = useState(false);
  const active = docs.find((d) => d.id === activeId);
  const activeIsPaper = Boolean(active && paperIds?.has(active.id));
  const canMove = docs.length > 1;

  function markDrop(next: Drop | null) {
    const cur = dropRef.current;
    if (cur?.id === next?.id && cur?.side === next?.side) return;
    dropRef.current = next;
    setDrop(next);
  }

  function track(clientX: number) {
    const from = drag.current;
    if (!from) return;
    const box = strip.current?.getBoundingClientRect();
    if (box && strip.current) {
      if (clientX < box.left + 28) strip.current.scrollLeft -= 14;
      else if (clientX > box.right - 28) strip.current.scrollLeft += 14;
    }
    // A point inside the strip, so the cursor's height doesn't miss the tabs.
    const y = box ? box.top + box.height / 2 : 0;
    const hit = document.elementFromPoint(clientX, y)?.closest("[data-tab-id]");
    const overId = hit?.getAttribute("data-tab-id");
    if (!hit || !overId || overId === from) {
      markDrop(null);
      return;
    }
    const overBox = hit.getBoundingClientRect();
    markDrop({ id: overId, side: clientX < overBox.left + overBox.width / 2 ? "before" : "after" });
  }

  function finishDrag() {
    const from = drag.current;
    const at = dropRef.current;
    drag.current = null;
    pending.current = null;
    dropRef.current = null;
    setDragging(false);
    setDrop(null);
    // The click that ends a drag must not also switch files. Clear the flag
    // if that click never arrives.
    window.setTimeout(() => {
      moved.current = false;
    }, 0);
    if (!from || !at) return;
    const ids = docs.map((d) => d.id);
    const next = place(ids, from, at.id, at.side);
    if (next.some((id, i) => id !== ids[i])) onReorder(next);
  }

  return (
    <div className="flex h-11 shrink-0 items-stretch border-b border-ink bg-paper">
      <div ref={strip} className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Open files">
        {docs.map((d) => {
          const active = d.id === activeId;
          const marker = drop?.id === d.id ? drop.side : null;
          return (
            <div
              key={d.id}
              data-tab-id={d.id}
              onPointerDown={(e) => {
                if (!canMove || e.button !== 0) return;
                if ((e.target as HTMLElement).closest("[data-tab-close]")) return;
                pending.current = { id: d.id, x: e.clientX };
              }}
              onPointerMove={(e) => {
                const start = pending.current;
                if (start?.id === d.id && !drag.current && Math.abs(e.clientX - start.x) >= 6) {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = d.id;
                  moved.current = true;
                  setDragging(true);
                }
                if (drag.current === d.id) track(e.clientX);
              }}
              onPointerUp={() => {
                pending.current = null;
                if (drag.current === d.id) finishDrag();
              }}
              onPointerCancel={() => {
                pending.current = null;
                if (drag.current === d.id) finishDrag();
              }}
              className={`group relative flex max-w-60 shrink-0 items-center border-r border-ink/15 transition-colors duration-200 ${
                dragging ? "cursor-grabbing" : canMove ? "cursor-grab" : ""
              } ${active ? "bg-panel" : "hover:bg-panel/60"}`}
            >
              {canMove && (
                <span aria-hidden className="flex h-full w-4 shrink-0 items-center justify-center text-muted">
                  <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
                    <circle cx="2" cy="2" r="1" />
                    <circle cx="6" cy="2" r="1" />
                    <circle cx="2" cy="7" r="1" />
                    <circle cx="6" cy="7" r="1" />
                    <circle cx="2" cy="12" r="1" />
                    <circle cx="6" cy="12" r="1" />
                  </svg>
                </span>
              )}
              {marker && <span className={`pointer-events-none absolute inset-y-1 w-0.5 bg-ink ${marker === "before" ? "left-0" : "right-0"}`} />}
              <button
                role="tab"
                aria-selected={active}
                onClick={() => {
                  if (moved.current) {
                    moved.current = false;
                    return;
                  }
                  onSelect(d.id);
                }}
                title={canMove ? `${d.label}: ${d.title} (${d.pageCount} pages). Drag to move this tab.` : `${d.label}: ${d.title} (${d.pageCount} pages)`}
                className={`flex min-w-0 items-center gap-2 py-2 pr-1 text-left text-sm ${canMove ? "pl-1" : "pl-3"}`}
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
                type="button"
                data-tab-close
                onPointerDown={(e) => e.stopPropagation()}
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

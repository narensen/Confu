"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

type Slot = { id: string; left: number; width: number };

type Drag = {
  id: string;
  width: number;
  grab: number;
  x: number;
  insert: number;
  settling: boolean;
  slots: Slot[];
};

// Where the dragged tab sits once the others close up around the cursor.
// A point still inside the tab's own span keeps that span: no second gap.
function insertAt(contentX: number, slots: Slot[], from: string): number {
  let at = 0;
  for (const slot of slots) {
    if (slot.id === from) continue;
    if (contentX > slot.left + slot.width / 2) at += 1;
  }
  return at;
}

function liveOrder(ids: string[], from: string, insert: number): string[] {
  const next = ids.filter((id) => id !== from);
  next.splice(Math.max(0, Math.min(insert, next.length)), 0, from);
  return next;
}

// The PDFs open as tabs above the viewer. Closing one only hides it: every
// PDF is in the Files tab, where they're opened again or deleted.
export function DocTabs({ docs, activeId, uploadStatus, onSelect, onAdd, onClose, onReorder, onAddClick, addLabel = "+ Add PDF", paperIds, onPaper }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const pending = useRef<{ id: string; x: number } | null>(null);
  const moved = useRef(false);
  const dragRef = useRef<Drag | null>(null);
  const settleTimer = useRef<number | null>(null);
  const before = useRef<Map<string, number>>(new Map());
  const [drag, setDrag] = useState<Drag | null>(null);
  const active = docs.find((d) => d.id === activeId);
  const activeIsPaper = Boolean(active && paperIds?.has(active.id));
  const canMove = docs.length > 1;
  const ids = docs.map((d) => d.id);
  const shown = drag ? liveOrder(ids, drag.id, drag.insert) : ids;
  const orderKey = shown.join("|");
  const draggingId = drag?.id ?? "";

  function contentX(clientX: number) {
    const el = strip.current;
    if (!el) return 0;
    return clientX - el.getBoundingClientRect().left - el.clientLeft + el.scrollLeft;
  }

  function follow(clientX: number) {
    const cur = dragRef.current;
    const el = strip.current;
    if (!cur || !el || cur.settling) return;
    const box = el.getBoundingClientRect();
    if (clientX < box.left + 28) el.scrollLeft -= 16;
    else if (clientX > box.right - 28) el.scrollLeft += 16;
    const x = contentX(clientX);
    const insert = insertAt(x, cur.slots, cur.id);
    if (insert === cur.insert && Math.abs(x - cur.x) < 0.5) return;
    const next = { ...cur, x, insert };
    dragRef.current = next;
    setDrag(next);
  }

  function startDrag(id: string, clientX: number) {
    const el = strip.current?.querySelector<HTMLElement>(`[data-tab-id="${id}"]`);
    if (!el || !strip.current) return;
    const slots = [...strip.current.querySelectorAll<HTMLElement>("[data-tab-id]")].map((node) => ({
      id: node.dataset.tabId || "",
      left: node.offsetLeft,
      width: node.offsetWidth,
    }));
    const mine = slots.find((slot) => slot.id === id);
    if (!mine) return;
    const x = contentX(clientX);
    const next: Drag = { id, width: mine.width, grab: x - mine.left, x, insert: ids.indexOf(id), settling: false, slots };
    dragRef.current = next;
    setDrag(next);
  }

  function clearSettle() {
    if (settleTimer.current == null) return;
    window.clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }

  function commitDrag() {
    const cur = dragRef.current;
    if (!cur) return;
    clearSettle();
    const order = liveOrder(ids, cur.id, cur.insert);
    dragRef.current = null;
    setDrag(null);
    window.setTimeout(() => {
      moved.current = false;
    }, 0);
    if (order.some((id, i) => id !== ids[i])) onReorder(order);
  }

  // Drop the tab into the one gap. A plain click never captures the pointer, so the tab button still opens the file.
  function finishDrag() {
    pending.current = null;
    const cur = dragRef.current;
    if (!cur || cur.settling) return;
    const order = liveOrder(ids, cur.id, cur.insert);
    const at = order.indexOf(cur.id);
    let left = 0;
    for (let i = 0; i < at; i++) left += cur.slots.find((slot) => slot.id === order[i])?.width ?? 0;
    if (Math.abs(cur.x - cur.grab - left) < 1) {
      commitDrag();
      return;
    }
    const next = { ...cur, settling: true, x: left + cur.grab };
    dragRef.current = next;
    setDrag(next);
    clearSettle();
    settleTimer.current = window.setTimeout(() => {
      if (dragRef.current?.settling) commitDrag();
    }, 260);
  }

  useEffect(() => {
    return () => {
      if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
    };
  }, []);

  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    const nodes = [...el.querySelectorAll<HTMLElement>("[data-tab-id]")];
    if (!draggingId) {
      nodes.forEach((node) => {
        node.style.transition = "";
        node.style.transform = "";
      });
      before.current = new Map(nodes.map((node) => [node.dataset.tabId || "", node.offsetLeft]));
      return;
    }
    const prev = before.current;
    const moving: HTMLElement[] = [];
    for (const node of nodes) {
      const id = node.dataset.tabId || "";
      const was = prev.get(id);
      if (was == null) continue;
      const delta = was - node.offsetLeft;
      if (Math.abs(delta) < 1) continue;
      node.style.transition = "none";
      node.style.transform = `translateX(${delta}px)`;
      moving.push(node);
    }
    if (moving.length) {
      moving[0].getBoundingClientRect();
      for (const node of moving) {
        node.style.transition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
        node.style.transform = "translateX(0)";
      }
    }
    before.current = new Map(nodes.map((node) => [node.dataset.tabId || "", node.offsetLeft]));
  }, [draggingId, orderKey]);

  return (
    <div className="flex h-11 shrink-0 items-stretch border-b border-ink bg-paper">
      <div
        ref={strip}
        className={`relative flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] ${drag ? "cursor-grabbing touch-none select-none" : ""}`}
        role="tablist"
        aria-label="Open files"
        onPointerMove={(e) => {
          const start = pending.current;
          if (start && !dragRef.current && Math.abs(e.clientX - start.x) >= 6) {
            moved.current = true;
            strip.current?.setPointerCapture(e.pointerId);
            startDrag(start.id, e.clientX);
          }
          if (dragRef.current) follow(e.clientX);
        }}
        onPointerUp={() => finishDrag()}
        onPointerCancel={() => finishDrag()}
        onClickCapture={(e) => {
          if (!moved.current) return;
          e.preventDefault();
          e.stopPropagation();
          moved.current = false;
        }}
      >
        {shown.map((id) => {
          const d = docs.find((doc) => doc.id === id);
          if (!d) return null;
          if (drag?.id === d.id) {
            return <div key={d.id} data-tab-id={d.id} data-gap="" aria-hidden className="h-full shrink-0" style={{ width: drag.width }} />;
          }
          const isActive = d.id === activeId;
          return (
            <div
              key={d.id}
              data-tab-id={d.id}
              onPointerDown={(e) => {
                if (!canMove || e.button !== 0) return;
                if ((e.target as HTMLElement).closest("[data-tab-close]")) return;
                pending.current = { id: d.id, x: e.clientX };
                const stop = () => {
                  window.removeEventListener("pointerup", stop);
                  window.removeEventListener("pointercancel", stop);
                  if (!dragRef.current) pending.current = null;
                };
                window.addEventListener("pointerup", stop);
                window.addEventListener("pointercancel", stop);
              }}
              className={`group relative flex max-w-60 shrink-0 items-center border-r border-ink/15 ${
                drag ? "cursor-grabbing" : canMove ? "cursor-grab" : ""
              } ${isActive ? "bg-panel" : "hover:bg-panel/60"}`}
            >
              <TabFace doc={d} active={isActive} canMove={canMove} paper={Boolean(paperIds?.has(d.id))} onSelect={() => onSelect(d.id)} onClose={() => onClose(d)} />
            </div>
          );
        })}
        {drag && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-20 flex max-w-60 items-center border-r border-ink/15 bg-panel shadow-hard"
            style={{
              width: drag.width,
              transform: `translateX(${drag.x - drag.grab}px)`,
              transition: drag.settling ? "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none",
            }}
            onTransitionEnd={(e) => {
              if (e.target !== e.currentTarget || e.propertyName !== "transform") return;
              if (dragRef.current?.settling) commitDrag();
            }}
          >
            {docs
              .filter((d) => d.id === drag.id)
              .map((d) => (
                <TabFace key={d.id} doc={d} active={d.id === activeId} canMove={canMove} paper={Boolean(paperIds?.has(d.id))} />
              ))}
          </div>
        )}
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

function TabFace({
  doc,
  active,
  canMove,
  paper,
  onSelect,
  onClose,
}: {
  doc: SessionDoc;
  active: boolean;
  canMove: boolean;
  paper: boolean;
  onSelect?: () => void;
  onClose?: () => void;
}) {
  return (
    <>
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
      <button
        type="button"
        role="tab"
        aria-selected={active}
        tabIndex={onSelect ? undefined : -1}
        onClick={() => onSelect?.()}
        title={canMove ? `${doc.label}: ${doc.title} (${doc.pageCount} pages). Drag to move this tab.` : `${doc.label}: ${doc.title} (${doc.pageCount} pages)`}
        className={`flex h-full min-w-0 flex-1 items-center gap-2 py-2 pr-1 text-left text-sm ${canMove ? "pl-1" : "pl-3"}`}
      >
        <span className={`shrink-0 rounded px-1 font-mono text-[10px] transition-colors duration-200 ${active ? "bg-ink text-white" : "border border-ink/30 text-muted"}`}>
          {doc.label}
        </span>
        <span className={`truncate ${active ? "font-medium" : "text-muted"}`}>{doc.title}</span>
        {paper && <span className="shrink-0 rounded bg-yellow-300 px-1 font-mono text-[9px] font-medium tracking-wide text-ink uppercase">Paper</span>}
      </button>
      <button
        type="button"
        data-tab-close
        tabIndex={onClose ? undefined : -1}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onClose?.()}
        aria-label={`Close ${doc.title}`}
        title="Close tab (it stays in Files)"
        className="mr-1.5 flex size-5 shrink-0 items-center justify-center rounded text-xs text-muted opacity-0 transition group-hover:opacity-100 hover:bg-ink/10 hover:text-ink focus:opacity-100"
      >
        ✕
      </button>
      {active && <span className="animate-fade absolute inset-x-0 -bottom-px h-0.5 bg-ink" />}
    </>
  );
}

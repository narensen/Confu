"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";

// A page citation in an answer ("p. 12", "D2 p. 4"): a button that opens the
// page. Hovered (or focused) for a moment, it shows the start of that page's
// text, so you can tell whether it's worth the jump without leaving the chat.

export type CiteTarget = { documentId: string; label: string; title: string };

// Which file a citation means: its label, or the open file when it has none.
// Provided by the workspace; without it, citations are plain buttons.
export const CiteResolver = createContext<((page: number, label?: string) => CiteTarget | null) | null>(null);

const texts = new Map<string, Promise<string | null>>();

function pageText(documentId: string, page: number): Promise<string | null> {
  const key = `${documentId}:${page}`;
  let hit = texts.get(key);
  if (!hit) {
    hit = Promise.resolve(
      createClient()
        .from("document_pages")
        .select("content")
        .eq("document_id", documentId)
        .eq("page_number", page)
        .maybeSingle(),
    ).then(({ data, error }) => {
      if (error) {
        texts.delete(key); // try again next time
        return null;
      }
      return ((data as { content?: string } | null)?.content ?? "").replace(/\s+/g, " ").trim();
    });
    texts.set(key, hit);
  }
  return hit;
}

const WIDTH = 320;
const DELAY = 350;

export function CiteButton({ page, label, onOpen, children }: { page: number; label?: string; onOpen: () => void; children: ReactNode }) {
  const resolve = useContext(CiteResolver);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [show, setShow] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const [text, setText] = useState<string | null | undefined>(undefined); // undefined: loading
  const target = resolve?.(page, label) ?? null;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function open() {
    if (!target) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const box = button.current?.getBoundingClientRect();
      if (!box) return;
      const above = box.top > 220;
      const left = Math.min(Math.max(8, box.left + box.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8);
      setShow({ left, top: above ? box.top - 8 : box.bottom + 8, above });
      void pageText(target.documentId, page).then(setText);
    }, DELAY);
  }

  function close() {
    window.clearTimeout(timer.current);
    setShow(null);
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => {
          close();
          onOpen();
        }}
        onPointerEnter={(e) => e.pointerType === "mouse" && open()}
        onPointerLeave={close}
        onFocus={open}
        onBlur={close}
        aria-describedby={show ? `cite-${page}` : undefined}
        title={target ? undefined : `Open p. ${page}`}
        className="rounded bg-paper px-1 font-mono text-[0.85em] font-medium underline decoration-ink/30 underline-offset-2 transition hover:bg-ink hover:text-white"
      >
        {children}
      </button>
      {show &&
        target &&
        createPortal(
          <div
            id={`cite-${page}`}
            role="tooltip"
            className="animate-pop pointer-events-none fixed z-[75] rounded-xl border border-ink bg-panel p-3 text-left shadow-hard"
            style={{ left: show.left, top: show.top, width: WIDTH, transform: show.above ? "translateY(-100%)" : undefined }}
          >
            <p className="flex items-center gap-1.5 text-xs">
              <span className="shrink-0 rounded bg-ink px-1 font-mono text-[10px] text-white">{target.label}</span>
              <span className="shrink-0 font-mono text-muted">p. {page}</span>
              <span className="min-w-0 truncate text-muted">{target.title}</span>
            </p>
            <p className="mt-2 line-clamp-6 font-serif text-sm leading-relaxed">
              {text === undefined ? <span className="text-muted">Loading the page…</span> : text ? text.slice(0, 420) : <span className="text-muted">No text on this page (a scan or a figure, perhaps).</span>}
            </p>
            <p className="mt-2 font-mono text-[11px] text-muted">Click to open the page</p>
          </div>,
          document.body,
        )}
    </>
  );
}

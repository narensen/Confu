"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { TutorAction } from "@confu/core/types";

// Must be set in the module that renders <Document>/<Page>.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

// A lean reader for files on this device: every page in one scroll, drawn
// only near the screen; select text to ask the tutor about it.

export type Selection = { text: string; page: number; action: TutorAction };

const GAP = 12; // between pages, px (gap-3)
const NEAR = "1600px 0px"; // pages this far off screen are drawn ahead
const MAX_WIDTH = 920;
// Same open as the session viewer: the first 512 KB, then whatever pdf.js
// asks for. Handing it the whole blob makes it read every byte before the
// first page, which is the long "Opening this file…".
const FIRST_CHUNK = 512 * 1024;
const PDF_OPTIONS = { rangeChunkSize: FIRST_CHUNK };

function useBlobRange(file: Blob) {
  const [source, setSource] = useState<{ file: Blob; transport: pdfjs.PDFDataRangeTransport } | "error" | null>(null);
  useEffect(() => {
    let live = true;
    const length = file.size;
    const end = Math.min(length, FIRST_CHUNK);
    void file.slice(0, end).arrayBuffer().then(
      (buf) => {
        if (!live) return;
        const transport = new pdfjs.PDFDataRangeTransport(length, new Uint8Array(buf), end >= length);
        transport.requestDataRange = (begin, stop) => {
          void file.slice(begin, stop).arrayBuffer().then(
            (chunk) => {
              if (live) transport.onDataRange(begin, new Uint8Array(chunk));
            },
            () => {},
          );
        };
        setSource({ file, transport });
      },
      () => live && setSource("error"),
    );
    return () => {
      live = false;
    };
  }, [file]);
  if (source === "error") return "error" as const;
  return source?.file === file ? source.transport : null;
}
const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];

const SELECTION_ACTIONS: { action: TutorAction; label: string }[] = [
  { action: "ask", label: "Explain" },
  { action: "simplify", label: "Simpler" },
  { action: "summarize", label: "Summarize" },
];

export function Reader({
  file,
  initialPage,
  jump,
  onPageChange,
  onAsk,
}: {
  file: Blob;
  initialPage: number;
  jump: { page: number; seq: number } | null; // scroll here (seq changes each time)
  onPageChange: (page: number) => void;
  onAsk: (s: Selection) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [ratios, setRatios] = useState<Record<number, number>>({}); // height / width, per page once known
  const [defaultRatio, setDefaultRatio] = useState(1.294); // A4 until the first page says otherwise
  const [near, setNear] = useState<Set<number>>(() => new Set([initialPage]));
  const [page, setPage] = useState(initialPage);
  const [pageInput, setPageInput] = useState(String(initialPage));
  const [ask, setAsk] = useState<{ text: string; page: number; x: number; y: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const placed = useRef(false);
  const range = useBlobRange(file);
  // A fresh object every render makes react-pdf reload the document.
  const pdfFile = useMemo(() => (range && range !== "error" ? { range } : null), [range]);

  const pageWidth = Math.max(240, Math.min(width - 32, MAX_WIDTH) * zoom);
  const heightOf = useCallback((p: number) => Math.round(pageWidth * (ratios[p] ?? defaultRatio)), [pageWidth, ratios, defaultRatio]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Which pages are near the screen, so only those are drawn.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !numPages) return;
    const io = new IntersectionObserver(
      (entries) =>
        setNear((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const p = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(p);
            else next.delete(p);
          }
          return next;
        }),
      { root, rootMargin: NEAR },
    );
    for (const el of pageEls.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [numPages]);

  const scrollToPage = useCallback((p: number, smooth = false) => {
    const el = pageEls.current.get(p);
    const root = scroller.current;
    if (el && root) root.scrollTo({ top: el.offsetTop - GAP, behavior: smooth ? "smooth" : "instant" });
  }, []);

  // Open where the student left off, once the pages have their size.
  useLayoutEffect(() => {
    if (placed.current || !numPages || !width) return;
    placed.current = true;
    scrollToPage(Math.min(Math.max(1, initialPage), numPages));
  }, [numPages, width, initialPage, scrollToPage]);

  useEffect(() => {
    if (jump && numPages) scrollToPage(Math.min(Math.max(1, jump.page), numPages), true);
  }, [jump, numPages, scrollToPage]);

  // The current page: the one crossing the upper third of the view.
  const onScroll = useCallback(() => {
    const root = scroller.current;
    if (!root || !numPages) return;
    const line = root.scrollTop + root.clientHeight / 3;
    let lo = 1;
    let hi = numPages;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const top = pageEls.current.get(mid)?.offsetTop ?? 0;
      if (top <= line) lo = mid;
      else hi = mid - 1;
    }
    if (lo !== page) {
      setPage(lo);
      setPageInput(String(lo));
      onPageChange(lo);
    }
  }, [numPages, page, onPageChange]);

  function onSelect() {
    const sel = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, " ").trim() ?? "";
    const root = scroller.current;
    if (!sel || !root || text.length < 2 || !sel.rangeCount) return setAsk(null);
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const pageEl = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-page]");
    if (!pageEl || !root.contains(pageEl)) return setAsk(null);
    const r = range.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    setAsk({
      text: text.slice(0, 4000),
      page: Number(pageEl.dataset.page),
      x: Math.min(Math.max(r.left + r.width / 2 - box.left, 120), box.width - 120),
      y: r.top - box.top + root.scrollTop,
    });
  }

  const zoomBy = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i === -1 ? 3 : i) + dir))]);
    requestAnimationFrame(() => scrollToPage(page));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-viewer">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-xs">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(pageInput);
            if (Number.isFinite(n) && n >= 1 && n <= numPages) scrollToPage(Math.floor(n));
            else setPageInput(String(page));
          }}
          className="flex items-center gap-1.5 text-muted"
        >
          <span>Page</span>
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
            onBlur={() => setPageInput(String(page))}
            inputMode="numeric"
            aria-label="Go to page"
            className="w-10 rounded border border-ink/20 bg-paper px-1 py-0.5 text-center font-mono text-ink outline-none focus:border-ink"
          />
          <span>of {numPages || "…"}</span>
        </form>
        <div className="ml-auto flex items-center gap-1">
          <ToolButton label="Zoom out" onClick={() => zoomBy(-1)} disabled={zoom <= ZOOMS[0]}>
            −
          </ToolButton>
          <button type="button" onClick={() => setZoom(1)} className="w-11 rounded px-1 py-0.5 font-mono text-muted hover:bg-paper hover:text-ink" title="Fit width">
            {Math.round(zoom * 100)}%
          </button>
          <ToolButton label="Zoom in" onClick={() => zoomBy(1)} disabled={zoom >= ZOOMS.at(-1)!}>
            +
          </ToolButton>
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        onMouseUp={onSelect}
        onTouchEnd={() => setTimeout(onSelect, 0)}
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest("[data-ask]")) setAsk(null);
        }}
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain"
      >
        {failed || range === "error" ? (
          <p className="m-6 rounded-lg border border-danger/40 bg-panel px-4 py-3 text-sm text-danger">{failed ?? "This PDF couldn't be opened."}</p>
        ) : !range ? (
          <p className="p-6 text-sm text-muted">Opening…</p>
        ) : (
          <Document
            file={pdfFile}
            options={PDF_OPTIONS}
            suspense={false}
            onLoadSuccess={async (pdf) => {
              setNumPages(pdf.numPages);
              const first = await pdf.getPage(1);
              const v = first.getViewport({ scale: 1 });
              setDefaultRatio(v.height / v.width);
            }}
            onLoadError={(e) => setFailed(`This PDF couldn't be opened: ${e.message}`)}
            loading={<p className="p-6 text-sm text-muted">Opening…</p>}
            className="flex flex-col items-center gap-3 py-3"
          >
            {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
              <div
                key={p}
                data-page={p}
                ref={(el) => {
                  if (el) pageEls.current.set(p, el);
                  else pageEls.current.delete(p);
                }}
                className="relative shrink-0 bg-[#fff] shadow-[0_1px_3px_rgba(0,0,0,0.15)]"
                style={{ width: pageWidth, height: heightOf(p) }}
              >
                {near.has(p) && (
                  <Page
                    pageNumber={p}
                    width={pageWidth}
                    renderAnnotationLayer
                    renderTextLayer
                    loading={null}
                    onLoadSuccess={(pg) => {
                      const r = pg.originalHeight / pg.originalWidth;
                      if (Math.abs((ratios[p] ?? 0) - r) > 0.001) setRatios((m) => ({ ...m, [p]: r }));
                    }}
                  />
                )}
              </div>
            ))}
          </Document>
        )}

        {ask && (
          <div
            data-ask
            className="animate-pop absolute z-20 flex -translate-x-1/2 -translate-y-full gap-0.5 rounded-full border border-ink bg-panel p-0.5 shadow-hard-sm"
            style={{ left: ask.x, top: ask.y - 8 }}
          >
            {SELECTION_ACTIONS.map((a) => (
              <button
                key={a.action}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onAsk({ text: ask.text, page: ask.page, action: a.action });
                  setAsk(null);
                  window.getSelection()?.removeAllRanges();
                }}
                className="rounded-full px-3 py-1 text-xs font-medium transition hover:bg-ink hover:text-white"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-7 items-center justify-center rounded text-base leading-none text-muted transition hover:bg-paper hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { Highlight, Rect, TutorAction } from "@/lib/types";

// Must be set in the same module that renders <Document>/<Page>.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export type TextSelection = { text: string; page: number; rects: Rect[] };
export type RegionCapture = { page: number; rect: Rect; image: string };

type Props = {
  url: string;
  initialPage: number;
  goTo: { page: number; n: number } | null;
  highlights: Highlight[];
  busy: boolean;
  focusMode: boolean;
  toolbarStart?: ReactNode;
  onToggleFocus: () => void;
  onPageChange: (page: number) => void;
  onTextAction: (action: TutorAction, selection: TextSelection, message?: string) => void;
  onSaveHighlight: (selection: TextSelection) => void;
  onRegion: (capture: RegionCapture, message?: string) => void;
};

type Popover =
  | { kind: "text"; selection: TextSelection; x: number; y: number; top: number }
  | { kind: "region"; capture: RegionCapture; x: number; y: number; top: number };

type Draft = { page: number; x0: number; y0: number; x1: number; y1: number };

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const MAX_CAPTURE_SIDE = 2000;

// Merge the many small per-span rects of a text selection into line boxes.
function mergeRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.5 && r.x <= last.x + last.w + 0.015) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      const bottom = Math.max(last.y + last.h, r.y + r.h);
      last.x = Math.min(last.x, r.x);
      last.y = Math.min(last.y, r.y);
      last.w = right - last.x;
      last.h = bottom - last.y;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

function normalise(d: Draft): Rect {
  return { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
}

function cropCanvas(pageEl: HTMLElement, rect: Rect): string | null {
  const canvas = pageEl.querySelector("canvas");
  if (!canvas) return null;
  const sx = rect.x * canvas.width;
  const sy = rect.y * canvas.height;
  const sw = rect.w * canvas.width;
  const sh = rect.h * canvas.height;
  const scale = Math.min(1, MAX_CAPTURE_SIDE / Math.max(sw, sh));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.92);
}

export default function PdfViewer(props: Props) {
  const { url, initialPage, goTo, highlights, busy, focusMode, toolbarStart, onToggleFocus, onPageChange } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [numPages, setNumPages] = useState(0);
  const [aspects, setAspects] = useState<Record<number, number>>({});
  const [baseAspect, setBaseAspect] = useState(1.414);
  const [fitWidth, setFitWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  // The page in view. Pages near it are rendered; the rest are placeholders.
  const [current, setCurrent] = useState(initialPage);
  const [pageInput, setPageInput] = useState(String(initialPage));
  const [regionMode, setRegionMode] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [askText, setAskText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pendingJump = useRef<number | null>(initialPage);
  const dpr = typeof window === "undefined" ? 2 : Math.min(3, Math.max(2, window.devicePixelRatio || 1));

  const pageWidth = Math.round(fitWidth * zoom);
  const highlightsByPage = useMemo(() => {
    const map = new Map<number, Highlight[]>();
    for (const h of highlights) map.set(h.page_number, [...(map.get(h.page_number) ?? []), h]);
    return map;
  }, [highlights]);

  // Fit-to-width sizing.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setFitWidth(Math.max(240, Math.min(1400, entry.contentRect.width - 48))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Which pages to render is derived from the current page rather than
  // tracked by an observer. When Next.js hides this route and shows it again
  // (Activity), react-pdf reloads the document; a derived window can't go
  // stale across that reload, which previously left every page blank.
  const isNear = (n: number) => n >= current - 2 && n <= current + 3;

  const scrollToPage = useCallback((n: number, smooth = false) => {
    const el = slotRefs.current[n - 1];
    const root = scrollRef.current;
    if (!el || !root) return;
    root.scrollTo({ top: el.offsetTop - 12, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // External jump requests (plan topics, citations, highlights).
  useEffect(() => {
    if (!goTo) return;
    if (numPages) scrollToPage(Math.min(Math.max(1, goTo.page), numPages), true);
    else pendingJump.current = goTo.page;
  }, [goTo, numPages, scrollToPage]);

  // Keep the reading position when zooming.
  const pageRef = useRef(initialPage);
  useLayoutEffect(() => {
    if (numPages) scrollToPage(pageRef.current);
  }, [zoom, numPages, scrollToPage]);

  const onScroll = useCallback(() => {
    setPopover(null);
    const root = scrollRef.current;
    // While the document reloads its pages are unmounted and the scroll resets
    // to the top; don't mistake that for the student scrolling to page 1.
    if (!root || !slotRefs.current[0]?.isConnected) return;
    const line = root.scrollTop + root.clientHeight * 0.35;
    let inView = 1;
    for (let i = 0; i < numPages; i++) {
      const el = slotRefs.current[i];
      if (el && el.offsetTop <= line) inView = i + 1;
      else break;
    }
    setCurrent(inView);
    if (inView !== pageRef.current) {
      pageRef.current = inView;
      setPageInput(String(inView));
      onPageChange(inView);
    }
  }, [numPages, onPageChange]);

  // Text selection → action popover.
  const onMouseUp = useCallback(() => {
    if (regionMode) return;
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const text = sel.toString().replace(/\s+/g, " ").trim();
      if (text.length < 2) return;
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      const startEl = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      const slot = startEl?.closest<HTMLElement>("[data-slot]");
      if (!slot) return;
      const box = slot.getBoundingClientRect();
      const rects = Array.from(range.getClientRects())
        .filter((r) => r.width > 1 && r.height > 1 && r.top >= box.top - 2 && r.bottom <= box.bottom + 2)
        .map((r) => ({
          x: (r.left - box.left) / box.width,
          y: (r.top - box.top) / box.height,
          w: r.width / box.width,
          h: r.height / box.height,
        }));
      const bounds = range.getBoundingClientRect();
      setAskText(null);
      setPopover({
        kind: "text",
        selection: { text: text.slice(0, 8000), page: Number(slot.dataset.slot), rects: mergeRects(rects) },
        x: bounds.left + bounds.width / 2,
        y: bounds.bottom,
        top: bounds.top,
      });
    });
  }, [regionMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPopover(null);
      setDraft(null);
      setRegionMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Region capture ("general highlight") pointer handling.
  const pointFor = (e: React.PointerEvent, slot: HTMLElement) => {
    const box = slot.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  };

  const closePopover = useCallback(() => {
    setPopover(null);
    setDraft(null);
    setAskText(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  function runText(action: TutorAction, message?: string) {
    if (popover?.kind !== "text") return;
    props.onTextAction(action, popover.selection, message);
    closePopover();
  }

  function runRegion(message?: string) {
    if (popover?.kind !== "region") return;
    props.onRegion(popover.capture, message);
    setRegionMode(false);
    closePopover();
  }

  const zoomIndex = ZOOMS.indexOf(zoom);

  return (
    <div className="flex h-full flex-col bg-viewer">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-ink bg-panel px-2 text-sm">
        {toolbarStart}
        <form
          className="flex items-center gap-1 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Math.min(Math.max(1, Number(pageInput) || 1), numPages || 1);
            scrollToPage(n);
          }}
        >
          <input
            aria-label="Page number"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
            className="h-7 w-11 rounded-md border border-ink/30 bg-panel text-center font-mono text-xs outline-none transition focus:border-ink focus:shadow-hard-sm"
          />
          <span className="font-mono text-xs text-muted">/ {numPages || "…"}</span>
        </form>
        <div className="mx-1.5 h-5 w-px bg-ink/20" />
        <ToolButton label="Zoom out" disabled={zoomIndex <= 0} onClick={() => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)])}>
          −
        </ToolButton>
        <button
          type="button"
          onClick={() => setZoom(1)}
          className="h-7 min-w-12 rounded-md px-1.5 font-mono text-xs tabular-nums text-muted transition hover:bg-paper hover:text-ink"
          title="Fit width"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolButton label="Zoom in" disabled={zoomIndex >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)])}>
          +
        </ToolButton>
        <div className="mx-1.5 h-5 w-px bg-ink/20" />
        <button
          type="button"
          onClick={() => {
            setRegionMode((v) => !v);
            closePopover();
          }}
          aria-pressed={regionMode}
          title="Drag over a figure, table or equation to have it read by a vision model (Esc to cancel)"
          className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition duration-200 ease-fluid ${
            regionMode ? "border-ink bg-ink text-white" : "border-ink hover:-translate-y-px hover:shadow-hard-sm"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4" />
            <rect x="8" y="8" width="8" height="8" rx="1" />
          </svg>
          {regionMode ? "Drag to capture…" : "Capture region"}
        </button>
        <div className="flex-1" />
        <span className="hidden truncate px-2 text-xs text-muted lg:inline">Select text to ask about it</span>
        <ToolButton label={focusMode ? "Exit full screen" : "Full screen"} onClick={onToggleFocus}>
          {focusMode ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M8 3v5H3M21 8h-5V3M3 16h5v5M16 21v-5h5" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
            </svg>
          )}
        </ToolButton>
      </div>

      {/* Pages */}
      <div ref={scrollRef} onScroll={onScroll} onMouseUp={onMouseUp} className="relative min-h-0 flex-1 overflow-auto">
        {loadError ? (
          <p className="p-8 text-center text-sm text-danger">{loadError}</p>
        ) : (
          <Document
            file={url}
            suspense={false}
            loading={<p className="p-8 text-center text-sm text-muted">Loading PDF…</p>}
            onLoadError={(e) => setLoadError(`Could not open this PDF: ${e.message}`)}
            onLoadSuccess={async (pdf) => {
              const first = await pdf.getPage(1);
              const vp = first.getViewport({ scale: 1 });
              setBaseAspect(vp.height / vp.width);
              setNumPages(pdf.numPages);
              // First load: open at the saved page. Reload after being hidden:
              // return to where the student was.
              const target = Math.min(Math.max(1, pendingJump.current ?? pageRef.current), pdf.numPages);
              pendingJump.current = null;
              pageRef.current = target;
              setCurrent(target);
              setPageInput(String(target));
              requestAnimationFrame(() => scrollToPage(target));
            }}
            onItemClick={({ pageNumber }) => scrollToPage(pageNumber, true)}
            className="flex flex-col items-center gap-4 px-6 py-6"
          >
            {Array.from({ length: numPages }, (_, i) => {
              const n = i + 1;
              const height = Math.round(pageWidth * (aspects[n] ?? baseAspect));
              const pageHighlights = highlightsByPage.get(n) ?? [];
              const pageDraft = draft?.page === n ? normalise(draft) : null;
              return (
                <div
                  key={n}
                  data-slot={n}
                  ref={(el) => {
                    slotRefs.current[i] = el;
                  }}
                  className={`pdf-page relative shrink-0 border border-ink bg-white shadow-[4px_4px_0_0_rgba(13,13,12,0.12)] ${regionMode ? "region-mode" : ""}`}
                  style={{ width: pageWidth, height }}
                >
                  {isNear(n) && (
                    <Page
                      pageNumber={n}
                      width={pageWidth}
                      devicePixelRatio={dpr}
                      renderAnnotationLayer
                      renderTextLayer
                      loading={null}
                      onLoadSuccess={(p) => {
                        const vp = p.getViewport({ scale: 1 });
                        const a = vp.height / vp.width;
                        setAspects((prev) => (Math.abs((prev[n] ?? 0) - a) < 0.001 ? prev : { ...prev, [n]: a }));
                      }}
                    />
                  )}

                  {/* Saved highlights */}
                  <div className="pointer-events-none absolute inset-0 z-[3]">
                    {pageHighlights.flatMap((h) =>
                      h.rects.map((r, j) => (
                        <div
                          key={`${h.id}-${j}`}
                          className={h.kind === "region" ? "absolute rounded-sm border-[1.5px] border-dashed border-ink/70" : "absolute mix-blend-multiply"}
                          style={{
                            left: `${r.x * 100}%`,
                            top: `${r.y * 100}%`,
                            width: `${r.w * 100}%`,
                            height: `${r.h * 100}%`,
                            background: h.kind === "region" ? "var(--hl-region)" : "var(--hl-yellow)",
                          }}
                        />
                      )),
                    )}
                    {pageDraft && (
                      <div
                        className="absolute border-[1.5px] border-ink bg-ink/5 shadow-[0_0_0_9999px_rgba(13,13,12,0.18)]"
                        style={{
                          left: `${pageDraft.x * 100}%`,
                          top: `${pageDraft.y * 100}%`,
                          width: `${pageDraft.w * 100}%`,
                          height: `${pageDraft.h * 100}%`,
                        }}
                      />
                    )}
                  </div>

                  {/* Region capture surface */}
                  {regionMode && (
                    <div
                      className="absolute inset-0 z-[4] cursor-crosshair touch-none"
                      onPointerDown={(e) => {
                        const slot = e.currentTarget.parentElement!;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        const p = pointFor(e, slot);
                        setPopover(null);
                        setDraft({ page: n, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
                      }}
                      onPointerMove={(e) => {
                        if (!draft || draft.page !== n || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
                        const p = pointFor(e, e.currentTarget.parentElement!);
                        setDraft({ ...draft, x1: p.x, y1: p.y });
                      }}
                      onPointerUp={(e) => {
                        if (!draft || draft.page !== n) return;
                        const slot = e.currentTarget.parentElement!;
                        const rect = normalise(draft);
                        if (rect.w < 0.02 || rect.h < 0.015) return setDraft(null);
                        const image = cropCanvas(slot, rect);
                        if (!image) return setDraft(null);
                        const box = slot.getBoundingClientRect();
                        setPopover({
                          kind: "region",
                          capture: { page: n, rect, image },
                          x: box.left + (rect.x + rect.w / 2) * box.width,
                          y: box.top + (rect.y + rect.h) * box.height,
                          top: box.top + rect.y * box.height,
                        });
                      }}
                    />
                  )}
                </div>
              );
            })}
          </Document>
        )}
      </div>

      {popover && (
        <SelectionPopover popover={popover} onClose={closePopover}>
          {popover.kind === "text" ? (
            askText === null ? (
              <div className="flex flex-wrap items-center gap-0.5">
                <PopButton primary disabled={busy} onClick={() => setAskText("")}>
                  Ask a doubt
                </PopButton>
                <PopButton disabled={busy} onClick={() => runText("summarize")}>
                  Summarize
                </PopButton>
                <PopButton disabled={busy} onClick={() => runText("context")}>
                  Context
                </PopButton>
                <PopButton disabled={busy} onClick={() => runText("simplify")}>
                  Simplify
                </PopButton>
                <span className="mx-0.5 h-4 w-px bg-line" />
                <PopButton
                  onClick={() => {
                    props.onSaveHighlight(popover.selection);
                    closePopover();
                  }}
                >
                  <span className="inline-block size-2.5 rounded-sm bg-yellow-300" /> Highlight
                </PopButton>
              </div>
            ) : (
              <AskInput
                placeholder="What's confusing about this?"
                value={askText}
                onChange={setAskText}
                disabled={busy}
                onSubmit={() => runText("ask", askText)}
              />
            )
          ) : (
            <div className="w-72 space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
              <img src={popover.capture.image} alt="Captured region" className="max-h-28 w-full rounded-md border border-line object-contain" />
              <AskInput
                placeholder="Ask about this region (optional)…"
                value={askText ?? ""}
                onChange={setAskText}
                disabled={busy}
                onSubmit={() => runRegion(askText ?? undefined)}
                submitLabel="Explain"
              />
            </div>
          )}
        </SelectionPopover>
      )}
    </div>
  );
}

function ToolButton({ label, children, ...rest }: { label: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded-md text-base text-ink transition duration-200 hover:bg-paper active:scale-90 disabled:opacity-30"
      {...rest}
    >
      {children}
    </button>
  );
}

function PopButton({ primary, children, ...rest }: { primary?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep the text selection
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
        primary ? "bg-ink text-white hover:opacity-85" : "hover:bg-paper"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

function AskInput(props: {
  value: string;
  placeholder: string;
  disabled?: boolean;
  submitLabel?: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="flex w-72 items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!props.disabled) props.onSubmit();
      }}
    >
      <input
        autoFocus
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="h-8 min-w-0 flex-1 rounded-md border border-ink/30 bg-panel px-2 text-sm outline-none transition focus:border-ink"
      />
      <button
        disabled={props.disabled}
        className="h-8 rounded-md bg-ink px-3 text-xs font-medium text-white transition hover:opacity-85 active:scale-95 disabled:opacity-40"
      >
        {props.submitLabel ?? "Ask"}
      </button>
    </form>
  );
}

// Positioned with `fixed` (not a portal) so it stays visible in full screen,
// where only descendants of the full-screen element are rendered.
function SelectionPopover({ popover, onClose, children }: { popover: Popover; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(margin, popover.x - width / 2), window.innerWidth - width - margin);
    const below = popover.y + margin;
    const top = below + height > window.innerHeight - margin ? Math.max(margin, popover.top - height - margin) : below;
    setPos({ left, top });
  }, [popover]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const id = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      className="animate-pop fixed z-50 rounded-xl border border-ink bg-panel p-1.5 shadow-hard"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {children}
    </div>
  );
}

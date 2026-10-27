"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { COLOR_ORDER, colorOf, HIGHLIGHT_COLORS, type HighlightColor } from "@/lib/highlights";
import { resolveOutline } from "@/lib/pdf/extract";
import { useReadingTime } from "@/lib/reading-time";
import { FocusSound } from "./FocusSound";
import { FocusTimer } from "./FocusTimer";
import { ReadAloudBar, useReadAloud } from "./ReadAloud";
import { ReadingMap } from "./ReadingMap";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";
import type { Highlight, OutlineItem, Rect, TutorAction } from "@/lib/types";

// Must be set in the same module that renders <Document>/<Page>.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

// Opening big PDFs fast. Supabase serves byte ranges, but its CORS doesn't
// expose Accept-Ranges, so pdf.js can't tell and downloads the whole file
// before showing anything (a 40 MB textbook took ~10 s). Here the ranges are
// fetched for it: the start of the file first, then whatever pdf.js asks for,
// in chunks big enough that a slow round trip isn't paid too often. If the
// server doesn't do ranges, the plain URL is used as before.
const FIRST_CHUNK = 512 * 1024;
const PDF_OPTIONS = { rangeChunkSize: 512 * 1024 };
type PdfSource = string | { range: InstanceType<typeof pdfjs.PDFDataRangeTransport> };

async function rangedSource(url: string): Promise<PdfSource> {
  try {
    const head = await fetch(url, { method: "HEAD" });
    const length = Number(head.headers.get("content-length"));
    if (!head.ok || !length) return url;
    const first = await fetch(url, { headers: { Range: `bytes=0-${Math.min(length, FIRST_CHUNK) - 1}` } });
    if (first.status !== 206) return url;
    const transport = new pdfjs.PDFDataRangeTransport(length, new Uint8Array(await first.arrayBuffer()));
    transport.requestDataRange = (begin: number, end: number) => {
      void fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
        .then((r) => r.arrayBuffer())
        .then((buf) => transport.onDataRange(begin, new Uint8Array(buf)))
        .catch(() => {});
    };
    return { range: transport };
  } catch {
    return url;
  }
}

function usePdfSource(url: string): PdfSource | null {
  const [source, setSource] = useState<{ url: string; source: PdfSource } | null>(null);
  useEffect(() => {
    let live = true;
    void rangedSource(url).then((s) => live && setSource({ url, source: s }));
    return () => {
      live = false;
    };
  }, [url]);
  return source?.url === url ? source.source : null;
}

export type TextSelection = { text: string; page: number; rects: Rect[] };
export type RegionCapture = { page: number; rect: Rect; image: string };

type Props = {
  url: string;
  // Lets search use the page text already stored for this PDF (instant, and
  // covers scanned pages read by OCR). Without it, search reads the PDF itself.
  documentId?: string;
  initialPage: number;
  goTo: { page: number; n: number } | null;
  highlights: Highlight[];
  busy: boolean;
  focusMode: boolean;
  toolbarStart?: ReactNode;
  onToggleFocus: () => void;
  onPageChange: (page: number) => void;
  onLoaded?: () => void; // the PDF is open (its first page measured)
  onTextAction: (action: TutorAction, selection: TextSelection, message?: string) => void;
  onSaveHighlight: (selection: TextSelection, color: HighlightColor, note?: string) => void;
  onUpdateHighlight?: (h: Highlight, patch: { color?: HighlightColor; note?: string | null }) => void;
  onDeleteHighlight?: (h: Highlight) => void;
  onRegion: (capture: RegionCapture, message?: string) => void;
};

type Popover =
  | { kind: "text"; selection: TextSelection; x: number; y: number; top: number }
  | { kind: "region"; capture: RegionCapture; x: number; y: number; top: number };

type Draft = { page: number; x0: number; y0: number; x1: number; y1: number };

type PDFDocument = Parameters<typeof resolveOutline>[0];
type ReaderTheme = "light" | "sepia" | "night";
type Hit = { page: number; count: number; before: string; match: string; after: string };
type Search = { q: string; hits: Hit[]; loading: boolean; index: number };

const THEMES: ReaderTheme[] = ["light", "sepia", "night"];
const THEME_KEY = "confu:reader-theme";
const THEME_NAME: Record<ReaderTheme, string> = { light: "Light", sepia: "Sepia", night: "Night" };

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A page's matches: how many, and a snippet around the first one.
function hitIn(page: number, text: string, needle: string): Hit | null {
  const lower = text.toLowerCase();
  const first = lower.indexOf(needle);
  if (first < 0) return null;
  let count = 0;
  for (let j = first; j !== -1; j = lower.indexOf(needle, j + needle.length)) count++;
  const flat = (s: string) => s.replace(/\s+/g, " ");
  return {
    page,
    count,
    before: flat(text.slice(Math.max(0, first - 50), first)).trimStart(),
    match: text.slice(first, first + needle.length),
    after: flat(text.slice(first + needle.length, first + needle.length + 70)).trimEnd(),
  };
}

const MAX_PAGE_WIDTH = 820;
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
  const { url, documentId, initialPage, goTo, highlights, busy, focusMode, toolbarStart, onToggleFocus, onPageChange } = props;
  const source = usePdfSource(url);
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
  const pdfRef = useRef<PDFDocument | null>(null);

  // Reading theme, remembered on this device. (The viewer only renders in the
  // browser, so localStorage is available here.)
  const [theme, setTheme] = useState<ReaderTheme>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === "sepia" || saved === "night" ? saved : "light";
    } catch {
      return "light";
    }
  });
  function cycleTheme() {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    track("reader.theme", { theme: next });
  }

  // Side panels: search (Ctrl/Cmd+F) and the PDF's table of contents.
  const [panel, setPanel] = useState<"search" | "contents" | "map" | null>(null);
  const [noteText, setNoteText] = useState<string | null>(null);
  const [outline, setOutline] = useState<OutlineItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search | null>(null);
  const latestQuery = useRef("");
  const searchInput = useRef<HTMLInputElement>(null);

  const openSearch = useCallback(() => {
    setPanel("search");
    requestAnimationFrame(() => searchInput.current?.select());
  }, []);
  const togglePanel = (p: "search" | "contents" | "map") => {
    if (panel === p) return setPanel(null);
    if (p === "search") openSearch();
    else {
      setPanel(p);
      track(p === "map" ? "reader.reading_map" : "reader.contents");
    }
  };

  const pageWidth = Math.round(fitWidth * zoom);
  const highlightsByPage = useMemo(() => {
    const map = new Map<number, Highlight[]>();
    for (const h of highlights) map.set(h.page_number, [...(map.get(h.page_number) ?? []), h]);
    return map;
  }, [highlights]);

  // 100% is a comfortable reading width (like a printed page on screen), not
  // the full width of the panel, which in full screen made pages huge.
  // While the panel resizes (entering full screen, dragging the divider) the
  // scroll position is meaningless until the pages re-lay out, so page
  // tracking pauses and the reading position is restored afterwards.
  const resizing = useRef(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const next = Math.round(Math.max(240, Math.min(MAX_PAGE_WIDTH, entry.contentRect.width - 48)));
      setFitWidth((prev) => {
        if (prev !== next) resizing.current = true;
        return next;
      });
    });
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

  // Time per page for "Where it got hard".
  useReadingTime(documentId, current);

  // Read aloud: the page's text from the PDF itself.
  const pageText = useCallback(async (n: number) => {
    const pdf = pdfRef.current;
    if (!pdf) return "";
    const content = await (await pdf.getPage(n)).getTextContent();
    return content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? " " : "") : "")).join("");
  }, []);
  const readAloud = useReadAloud({ pageText, numPages, onPage: (n) => scrollToPage(n, true) });

  // Keep the reading position when zooming or resizing.
  const pageRef = useRef(initialPage);
  useLayoutEffect(() => {
    if (numPages) scrollToPage(pageRef.current);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => (resizing.current = false)));
    return () => cancelAnimationFrame(id);
  }, [zoom, fitWidth, numPages, scrollToPage]);

  const onScroll = useCallback(() => {
    setPopover(null);
    const root = scrollRef.current;
    // While the document reloads its pages are unmounted and the scroll resets
    // to the top; don't mistake that for the student scrolling to page 1.
    if (!root || !slotRefs.current[0]?.isConnected || resizing.current) return;
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
      // The browser's find can't see pages that aren't rendered yet, so
      // Ctrl/Cmd+F searches the whole PDF instead.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.key !== "Escape") return;
      setPopover(null);
      setDraft(null);
      setRegionMode(false);
      setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch]);

  // Search: the stored page text when we have it (fast, includes OCR'd
  // pages), otherwise the PDF's own text layer, page by page.
  const findInDocument = useCallback(
    async (q: string): Promise<Hit[]> => {
      const needle = q.toLowerCase();
      if (documentId) {
        const pattern = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
        const { data, error } = await createClient()
          .from("document_pages")
          .select("page_number, content")
          .eq("document_id", documentId)
          .ilike("content", pattern)
          .order("page_number")
          .limit(500);
        if (!error && data) {
          return (data as { page_number: number; content: string }[]).flatMap((r) => {
            const h = hitIn(r.page_number, r.content, needle);
            return h ? [h] : [];
          });
        }
      }
      const pdf = pdfRef.current;
      if (!pdf) return [];
      const hits: Hit[] = [];
      for (let p = 1; p <= pdf.numPages && hits.length < 500; p++) {
        if (latestQuery.current !== q) break; // a newer search started
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const text = content.items.map((it) => ("str" in it ? it.str : "")).join(" ");
        const h = hitIn(p, text, needle);
        if (h) hits.push(h);
      }
      return hits;
    },
    [documentId],
  );

  const searchTimer = useRef<number | null>(null);
  function runSearch(raw: string) {
    setQuery(raw);
    const q = raw.trim();
    latestQuery.current = q;
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (q.length < 2) {
      setSearch(null);
      return;
    }
    setSearch((s) => ({ q, hits: s?.q === q ? s.hits : [], loading: true, index: 0 }));
    searchTimer.current = window.setTimeout(async () => {
      const hits = await findInDocument(q);
      if (latestQuery.current !== q) return;
      // Start from the first match at or after the page being read.
      const from = hits.findIndex((h) => h.page >= pageRef.current);
      const index = from === -1 ? 0 : from;
      setSearch({ q, hits, loading: false, index });
      if (hits.length) scrollToPage(hits[index].page, true);
      track("reader.search", { results: hits.length });
    }, 260);
  }

  function goHit(dir: 1 | -1, to?: number) {
    if (!search?.hits.length) return;
    const index = to ?? (search.index + dir + search.hits.length) % search.hits.length;
    setSearch({ ...search, index });
    scrollToPage(search.hits[index].page, true);
  }

  // Wrap matches in the text layer so they show on the page. Text from the PDF
  // is escaped first: react-pdf inserts this string as HTML.
  const activeQuery = panel === "search" && search?.q ? search.q : "";
  const textRenderer = useMemo(() => {
    if (!activeQuery) return undefined;
    const re = new RegExp(escapeRegExp(activeQuery), "gi");
    return ({ str }: { str: string }) => {
      let out = "";
      let last = 0;
      for (const m of str.matchAll(re)) {
        out += `${escapeHtml(str.slice(last, m.index))}<mark class="pdf-hit">${escapeHtml(m[0])}</mark>`;
        last = (m.index ?? 0) + m[0].length;
      }
      return out + escapeHtml(str.slice(last));
    };
  }, [activeQuery]);
  const currentHitPage = activeQuery && search?.hits.length ? search.hits[search.index]?.page : null;
  const totalMatches = search?.hits.reduce((s, h) => s + h.count, 0) ?? 0;

  // Contents: the section the reader is in is the last one starting at or before this page.
  const currentSection = useMemo(() => {
    if (!outline) return -1;
    let idx = -1;
    outline.forEach((o, i) => {
      if (o.page <= current) idx = i;
    });
    return idx;
  }, [outline, current]);

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
    setNoteText(null);
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
  const zoomOut = () => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)]);
  const zoomIn = () => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)]);

  return (
    <div className="flex h-full flex-col bg-viewer" data-reader={theme}>
      {/* Toolbar (adapts to the panel's own width, not the screen's) */}
      {/* Grouped by job: Navigate · Read · Capture · Focus. Labels show when
          the viewer is wide enough; the rarely used Read tools fold into More
          when it isn't. */}
      <div className="@container flex h-12 shrink-0 items-center gap-1 border-b border-ink bg-panel px-2 text-sm">
        {toolbarStart}
        <div role="group" aria-label="Navigate" className="flex items-center gap-0.5">
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
            <span className="font-mono text-xs whitespace-nowrap text-muted">/ {numPages || "…"}</span>
          </form>
          <ToolButton label="Contents" text="Contents" textAt="@2xl:inline" aria-pressed={panel === "contents"} onClick={() => togglePanel("contents")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
          </ToolButton>
          <ToolButton label="Search this PDF (Ctrl+F)" text="Search" textAt="@2xl:inline" aria-pressed={panel === "search"} onClick={() => togglePanel("search")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </ToolButton>
        </div>
        <div className="mx-1 h-5 w-px shrink-0 bg-ink/20" />
        <div role="group" aria-label="Read" className="flex items-center gap-0.5">
          <span className="hidden items-center gap-0.5 @md:flex">
            <ToolButton label="Zoom out" disabled={zoomIndex <= 0} onClick={zoomOut}>
              −
            </ToolButton>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="h-7 min-w-11 rounded-md px-1 font-mono text-xs tabular-nums text-muted transition hover:bg-paper hover:text-ink"
              title="Fit width"
            >
              {Math.round(zoom * 100)}%
            </button>
            <ToolButton label="Zoom in" disabled={zoomIndex >= ZOOMS.length - 1} onClick={zoomIn}>
              +
            </ToolButton>
          </span>
          <span className="hidden items-center gap-0.5 @4xl:flex">
            <ToolButton label={`Reading theme: ${THEME_NAME[theme]} (click to change)`} text="Theme" textAt="@6xl:inline" onClick={cycleTheme}>
              <ThemeIcon theme={theme} />
            </ToolButton>
            <ToolButton
              label={readAloud.state === "idle" ? "Read aloud from this page" : "Stop reading aloud"}
              text={readAloud.state === "idle" ? "Listen" : "Stop"}
              textAt="@6xl:inline"
              aria-pressed={readAloud.state !== "idle"}
              onClick={() => (readAloud.state === "idle" ? void readAloud.start(current) : readAloud.stop())}
            >
              <ListenIcon />
            </ToolButton>
            <ToolButton label="Where it got hard" text="Hard spots" textAt="@6xl:inline" aria-pressed={panel === "map"} onClick={() => togglePanel("map")}>
              <HardSpotsIcon />
            </ToolButton>
          </span>
          <MoreMenu>
            {(close) => (
              <>
                <span className="mb-1.5 flex items-center gap-1 border-b border-line pb-1.5 @md:hidden">
                  <span className="px-2 text-sm">Zoom</span>
                  <span className="ml-auto flex items-center gap-0.5">
                    <ToolButton label="Zoom out" disabled={zoomIndex <= 0} onClick={zoomOut}>
                      −
                    </ToolButton>
                    <button type="button" onClick={() => setZoom(1)} title="Fit width" className="h-7 min-w-11 rounded-md px-1 font-mono text-xs tabular-nums text-muted hover:bg-paper">
                      {Math.round(zoom * 100)}%
                    </button>
                    <ToolButton label="Zoom in" disabled={zoomIndex >= ZOOMS.length - 1} onClick={zoomIn}>
                      +
                    </ToolButton>
                  </span>
                </span>
                <MoreItem onClick={cycleTheme} hint={THEME_NAME[theme]}>
                  <ThemeIcon theme={theme} />
                  Reading theme
                </MoreItem>
                <MoreItem
                  pressed={readAloud.state !== "idle"}
                  onClick={() => {
                    if (readAloud.state === "idle") void readAloud.start(current);
                    else readAloud.stop();
                    close();
                  }}
                >
                  <ListenIcon />
                  {readAloud.state === "idle" ? "Read aloud from here" : "Stop reading aloud"}
                </MoreItem>
                <MoreItem
                  pressed={panel === "map"}
                  onClick={() => {
                    togglePanel("map");
                    close();
                  }}
                >
                  <HardSpotsIcon />
                  Where it got hard
                </MoreItem>
              </>
            )}
          </MoreMenu>
        </div>
        <div className="mx-1 h-5 w-px shrink-0 bg-ink/20" />
        <div role="group" aria-label="Capture" className="flex items-center">
          <button
            type="button"
            onClick={() => {
              setRegionMode((v) => !v);
              closePopover();
            }}
            aria-pressed={regionMode}
            title="Drag over a figure, table or equation to have it read by a vision model (Esc to cancel)"
            className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition duration-200 ease-fluid ${
              regionMode ? "border-ink bg-ink text-white" : "border-ink hover:-translate-y-px hover:shadow-hard-sm"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4" />
              <rect x="8" y="8" width="8" height="8" rx="1" />
            </svg>
            <span className="hidden @xl:inline">{regionMode ? "Drag to capture…" : "Capture"}</span>
          </button>
        </div>
        <div className="min-w-0 flex-1" />
        <span className="hidden truncate px-2 text-xs text-muted @7xl:inline">Select text to ask about it</span>
        <div className="mx-1 h-5 w-px shrink-0 bg-ink/20" />
        <div role="group" aria-label="Focus" className="flex items-center gap-0.5">
          <FocusSound />
          <FocusTimer />
          <ToolButton
            label={focusMode ? "Exit full screen" : "Full screen"}
            onClick={() => {
              if (!focusMode) track("reader.fullscreen");
              onToggleFocus();
            }}
          >
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
      </div>

      {/* Pages, with the contents drawer and search bar over them */}
      <div className="relative flex min-h-0 flex-1">
        {panel === "map" && (
          <ReadingMap
            documentId={documentId}
            numPages={numPages}
            current={current}
            highlights={highlights}
            onPick={(page) => {
              scrollToPage(page, true);
              if ((scrollRef.current?.clientWidth ?? 0) < 760) setPanel(null);
            }}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "contents" && (
          <ContentsPanel
            outline={outline}
            currentIndex={currentSection}
            onPick={(page) => {
              scrollToPage(page, true);
              if ((scrollRef.current?.clientWidth ?? 0) < 760) setPanel(null);
            }}
            onClose={() => setPanel(null)}
          />
        )}
      <div ref={scrollRef} onScroll={onScroll} onMouseUp={onMouseUp} className="pdf-scroll relative min-h-0 flex-1 overflow-auto">
        {loadError ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center text-sm">
            <p className="text-danger">{loadError}</p>
            {/* Reloading signs a fresh link (they expire after a few hours). */}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-ink bg-panel px-4 py-1.5 font-medium transition hover:-translate-y-px hover:shadow-hard-sm"
            >
              Reload
            </button>
          </div>
        ) : !source ? (
          <p className="p-8 text-center text-sm text-muted">Loading PDF…</p>
        ) : (
          <Document
            file={source}
            options={PDF_OPTIONS}
            suspense={false}
            loading={<p className="p-8 text-center text-sm text-muted">Loading PDF…</p>}
            onLoadError={(e) => {
              console.error("PDF load failed", e);
              setLoadError("Couldn't open this PDF. Check your network or reload.");
            }}
            onLoadSuccess={async (pdf) => {
              pdfRef.current = pdf;
              void pdf
                .getOutline()
                .then((raw) => resolveOutline(pdf, raw))
                .then(setOutline, () => setOutline([]));
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
              props.onLoaded?.();
            }}
            onItemClick={({ pageNumber }) => scrollToPage(pageNumber, true)}
            externalLinkTarget="_blank"
            externalLinkRel="noopener noreferrer"
            className="flex w-max min-w-full flex-col items-center gap-4 px-6 py-6"
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
                  data-hit={currentHitPage === n ? "current" : undefined}
                  ref={(el) => {
                    slotRefs.current[i] = el;
                  }}
                  className={`pdf-page relative shrink-0 border border-ink bg-[#ffffff] shadow-[4px_4px_0_0_rgba(13,13,12,0.12)] ${regionMode ? "region-mode" : ""}`}
                  style={{ width: pageWidth, height }}
                >
                  {isNear(n) && (
                    <Page
                      pageNumber={n}
                      width={pageWidth}
                      devicePixelRatio={dpr}
                      renderAnnotationLayer
                      renderTextLayer
                      customTextRenderer={textRenderer}
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
                            background: h.kind === "region" ? "var(--hl-region)" : HIGHLIGHT_COLORS[colorOf(h.color)].fill,
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

                  {/* Margin notes */}
                  {pageHighlights
                    .filter((h) => h.note)
                    .map((h) => (
                      <NoteMarker key={`note-${h.id}`} h={h} onUpdate={props.onUpdateHighlight} onDelete={props.onDeleteHighlight} />
                    ))}

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
        <ReadAloudBar ctl={readAloud} />
        {panel === "search" && (
          <SearchPanel
            inputRef={searchInput}
            query={query}
            search={search}
            totalMatches={totalMatches}
            onQuery={runSearch}
            onStep={(dir) => goHit(dir)}
            onPick={(i) => goHit(1, i)}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      {popover && (
        <SelectionPopover popover={popover} onClose={closePopover}>
          {popover.kind === "text" ? (
            askText === null && noteText === null ? (
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
                <span className="flex items-center gap-0.5 pl-1" role="group" aria-label="Highlight">
                  {COLOR_ORDER.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        props.onSaveHighlight(popover.selection, c);
                        track("reader.highlight", { color: c });
                        closePopover();
                      }}
                      title={`Highlight: ${HIGHLIGHT_COLORS[c].label}`}
                      aria-label={`Highlight as ${HIGHLIGHT_COLORS[c].label}`}
                      className="flex size-7 items-center justify-center rounded-md transition hover:bg-paper"
                    >
                      <span className="size-3.5 rounded-full border border-ink/20" style={{ background: HIGHLIGHT_COLORS[c].swatch }} />
                    </button>
                  ))}
                </span>
                <PopButton onClick={() => setNoteText("")}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M4 4h16v12H8l-4 4z" />
                  </svg>
                  Note
                </PopButton>
              </div>
            ) : noteText !== null && askText === null ? (
              <AskInput
                placeholder="Your note on this passage…"
                value={noteText}
                onChange={setNoteText}
                submitLabel="Save"
                onSubmit={() => {
                  if (!noteText.trim()) return;
                  props.onSaveHighlight(popover.selection, "yellow", noteText.trim().slice(0, 2000));
                  track("reader.note");
                  closePopover();
                }}
              />
            ) : (
              <AskInput
                placeholder="What's confusing about this?"
                value={askText ?? ""}
                onChange={setAskText}
                disabled={busy}
                onSubmit={() => runText("ask", askText ?? "")}
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

// A note pinned in the page margin, next to its passage.
function NoteMarker({
  h,
  onUpdate,
  onDelete,
}: {
  h: Highlight;
  onUpdate?: (h: Highlight, patch: { note?: string | null }) => void;
  onDelete?: (h: Highlight) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(h.note ?? "");
  const top = Math.max(0, Math.min(0.97, h.rects[0]?.y ?? 0));
  return (
    <div className="pdf-note absolute z-[5]" style={{ top: `${top * 100}%`, right: -30 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Note"
        title={h.note ?? ""}
        className="flex size-6 items-center justify-center rounded-md border border-ink bg-yellow-300 shadow-[2px_2px_0_0_var(--shadow)] transition hover:-translate-y-px"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M4 4h16v12H8l-4 4z" />
        </svg>
      </button>
      {open && (
        <div className="animate-pop absolute top-7 right-0 w-64 rounded-xl border border-ink bg-panel p-3 text-left shadow-hard">
          {editing ? (
            <textarea
              autoFocus
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full resize-y rounded-md border border-ink/30 p-2 text-sm outline-none focus:border-ink"
            />
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{h.note}</p>
          )}
          <div className="mt-2 flex justify-end gap-1.5 text-xs">
            {editing ? (
              <button
                type="button"
                onClick={() => {
                  onUpdate?.(h, { note: text.trim() || null });
                  setEditing(false);
                  setOpen(false);
                }}
                className="rounded-md bg-ink px-2.5 py-1 font-medium text-white"
              >
                Save
              </button>
            ) : (
              <>
                <button type="button" onClick={() => setEditing(true)} className="rounded-md border border-ink/30 px-2.5 py-1 hover:border-ink">
                  Edit
                </button>
                <button type="button" onClick={() => onDelete?.(h)} className="rounded-md px-2.5 py-1 text-muted hover:text-danger">
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Floating search bar over the pages: matches per page with a snippet each,
// Enter / Shift+Enter to step through them.
function SearchPanel({
  inputRef,
  query,
  search,
  totalMatches,
  onQuery,
  onStep,
  onPick,
  onClose,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  search: Search | null;
  totalMatches: number;
  onQuery: (v: string) => void;
  onStep: (dir: 1 | -1) => void;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const hits = search?.hits ?? [];
  const status = !search
    ? query.trim().length === 1
      ? "2+ letters"
      : ""
    : search.loading && !hits.length
      ? "Searching…"
      : hits.length
        ? `${search.index + 1} of ${hits.length}`
        : "No matches";

  return (
    <div className="animate-pop absolute top-3 right-3 z-20 flex max-h-[calc(100%-1.5rem)] w-[min(26rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border border-ink bg-panel shadow-hard">
      <form
        className="flex items-center gap-1 p-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          onStep(1);
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="ml-1.5 shrink-0 text-muted">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.shiftKey) {
              e.preventDefault();
              onStep(-1);
            }
          }}
          placeholder="Search this PDF"
          aria-label="Search this PDF"
          className="h-8 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none"
        />
        <span aria-live="polite" className="shrink-0 px-1 font-mono text-[11px] whitespace-nowrap text-muted tabular-nums">
          {status}
        </span>
        <ToolButton label="Previous page with a match (Shift+Enter)" disabled={hits.length < 2} onClick={() => onStep(-1)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path d="m18 15-6-6-6 6" />
          </svg>
        </ToolButton>
        <ToolButton label="Next page with a match (Enter)" disabled={hits.length < 2} onClick={() => onStep(1)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </ToolButton>
        <ToolButton label="Close search (Esc)" onClick={onClose}>
          <span className="text-sm">✕</span>
        </ToolButton>
      </form>
      {hits.length > 0 && (
        <>
          <p className="border-t border-line px-3 pt-2 pb-1 font-mono text-[10px] tracking-wider text-muted uppercase">
            {totalMatches} {totalMatches === 1 ? "match" : "matches"} on {hits.length} {hits.length === 1 ? "page" : "pages"}
          </p>
          <ul className="min-h-0 overflow-y-auto px-1.5 pb-1.5">
            {hits.map((h, i) => (
              <li key={h.page}>
                <button
                  type="button"
                  ref={i === search!.index ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                  onClick={() => onPick(i)}
                  className={`flex w-full gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition ${i === search!.index ? "bg-paper" : "hover:bg-paper/60"}`}
                >
                  <span className="w-11 shrink-0 font-mono text-[11px] text-muted">p. {h.page}</span>
                  <span className="line-clamp-2 min-w-0 flex-1 leading-snug text-ink/80">
                    {h.before && "…"}
                    {h.before}
                    <mark className="rounded-sm bg-yellow-300 px-0.5 text-ink">{h.match}</mark>
                    {h.after}
                    {h.after && "…"}
                  </span>
                  {h.count > 1 && <span className="shrink-0 font-mono text-[10px] text-muted">×{h.count}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// The PDF's own table of contents, with the section being read marked.
function ContentsPanel({
  outline,
  currentIndex,
  onPick,
  onClose,
}: {
  outline: OutlineItem[] | null;
  currentIndex: number;
  onPick: (page: number) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <aside aria-label="Contents" className="animate-slide-in absolute inset-y-0 left-0 z-20 flex w-72 max-w-[85%] flex-col border-r border-ink bg-panel shadow-[6px_0_0_0_rgba(13,13,12,0.08)]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-1.5 pl-3">
        <p className="font-mono text-[11px] font-medium tracking-[0.12em] text-muted uppercase">Contents</p>
        <ToolButton label="Close contents" onClick={onClose}>
          <span className="text-sm">✕</span>
        </ToolButton>
      </div>
      {outline === null ? (
        <p className="p-4 text-sm text-muted">Reading the table of contents…</p>
      ) : outline.length === 0 ? (
        <p className="p-4 text-sm leading-relaxed text-muted">
          This PDF has no table of contents. Use search (Ctrl+F), or type a page number in the toolbar.
        </p>
      ) : (
        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {outline.map((o, i) => (
            <li key={`${i}-${o.page}`}>
              <button
                type="button"
                aria-current={i === currentIndex ? "true" : undefined}
                onClick={() => onPick(o.page)}
                className={`flex w-full items-baseline gap-2 py-1.5 pr-3 text-left transition hover:bg-paper ${
                  i === currentIndex ? "bg-paper shadow-[inset_3px_0_0_0_#facc15]" : ""
                }`}
                style={{ paddingLeft: 12 + Math.min(o.level, 5) * 14 }}
              >
                <span className={`min-w-0 flex-1 truncate ${o.level === 0 ? "text-sm font-medium" : "text-[13px] text-ink/80"}`} title={o.title}>
                  {o.title}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">{o.page}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

// `text` is a short label shown from the container width in `textAt` up
// (a full class, e.g. "@3xl:inline", so Tailwind sees it).
function ToolButton({
  label,
  text,
  textAt,
  children,
  ...rest
}: { label: string; text?: string; textAt?: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex h-7 min-w-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-1.5 text-base text-ink transition duration-200 hover:bg-paper active:scale-90 disabled:opacity-30 aria-pressed:bg-ink aria-pressed:text-white"
      {...rest}
    >
      {children}
      {text && <span className={`hidden text-xs font-medium ${textAt ?? ""}`}>{text}</span>}
    </button>
  );
}

function ThemeIcon({ theme }: { theme: ReaderTheme }) {
  if (theme === "night")
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    );
  if (theme === "sepia")
    return (
      <span aria-hidden className="flex size-5 items-center justify-center rounded bg-[#efe3c8] font-serif text-[12px] font-semibold text-[#5b4636]">
        Aa
      </span>
    );
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function ListenIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
    </svg>
  );
}

function HardSpotsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

// The Read tools that don't fit inline when the viewer is narrow.
function MoreMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative @4xl:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="More reading tools"
        className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium transition hover:bg-paper aria-expanded:bg-paper"
      >
        More
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="animate-pop absolute top-full left-0 z-30 mt-1.5 w-56 rounded-xl border border-ink bg-panel p-1.5 shadow-hard">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MoreItem({ pressed, hint, onClick, children }: { pressed?: boolean; hint?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition ${pressed ? "bg-ink text-white" : "hover:bg-paper"}`}
    >
      {children}
      {hint && <span className="ml-auto text-[11px] text-muted">{hint}</span>}
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

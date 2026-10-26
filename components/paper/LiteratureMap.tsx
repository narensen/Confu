"use client";

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { eyebrowClass, ghostButtonClass } from "@/components/ui";
import { JSON_HEADERS } from "@/lib/ai-errors";
import type { Graph, GraphNode } from "@/lib/openalex";
import type { PaperMeta } from "@/lib/pdf/add-paper";
import { track } from "@/lib/telemetry";
import type { SessionDoc } from "@/lib/types";

// The literature map: a session's papers (or, on the personal map, every
// session's), the foundations they cite and the newer work that cites them.
// Emphasis encoding: your papers are the one accent (ink); context is gray,
// told apart by shape (hollow ring = foundation, square = newer work), with a
// legend and a table view, so identity never rests on color. Yellow marks
// only hover and selection. On the personal map, picking a session dims the
// rest (no color per session, so any number of sessions works), and a thin
// outer ring marks what two or more sessions share.

const INK = "#0d0d0c";
const CONTEXT = "#8f8c84"; // foundation ring
const NEWER = "#b4b1a8"; // newer-work square
const EDGE = "#dcdad3";
const SURFACE = "#ffffff";
const FOCUS = "#facc15";

type Kind = GraphNode["kind"];
type SimNode = GraphNode & SimulationNodeDatum & { r: number };
type Layout = "web" | "timeline";
const KIND_LABEL: Record<Kind, string> = { session: "Your papers", foundation: "Foundations", frontier: "Newer work" };
// The personal map shows this many papers, newest first (LIBRARY_LIMITS in lib/openalex).
const LIBRARY_PAPERS = 60;
const STEPS = ["Finding your papers in OpenAlex…", "Collecting what they cite…", "Spotting shared foundations…", "Looking for newer work that builds on them…", "Drawing the map…"];

const radius = (n: GraphNode) => Math.max(n.kind === "session" ? 9 : 5, Math.min(17, 4 + 2.6 * Math.log10(n.citations + 1)));
const short = (t: string, n = 34) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const fmt = (n: number) => n.toLocaleString("en-US");

// Connects your sessions (the personal map only; see GraphNode.bridge).
const bridges = (n: GraphNode) => Boolean(n.bridge);

function relation(n: GraphNode) {
  if (n.kind === "session") return (n.sessions?.length ?? 0) > 1 ? `In ${n.sessions!.length} of your sessions` : "In your session";
  if (n.kind === "foundation") return n.citedByYours && n.citedByYours > 1 ? `Cited by ${n.citedByYours} of your papers` : "Cited by one of your papers";
  return n.citesYours && n.citesYours > 1 ? `Cites ${n.citesYours} of your papers` : "Cites one of your papers";
}

function layoutGraph(graph: Graph, mode: Layout, w: number, h: number) {
  // Smaller marks on a narrow screen, so a big map doesn't collapse into a knot.
  const k = Math.max(0.55, Math.min(1, w / 1000));
  const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n, r: Math.max(4, radius(n) * k) }));
  const links = graph.edges.map((e) => ({ source: e.from, target: e.to }));
  const years = nodes.map((n) => n.year).filter((y): y is number => Boolean(y)).sort((a, b) => a - b);
  // One very old classic shouldn't squash everything else: start near the
  // 10th percentile, with older papers at the left edge.
  const y0 = years.length ? Math.max(years[0], years[Math.floor(years.length * 0.1)] - 2) : 2000;
  const y1 = years.length ? years[years.length - 1] : 2025;
  const pad = 70;
  const xOfYear = (y: number | null) => pad + (((Math.max(y ?? y0, y0) - y0) / Math.max(1, y1 - y0)) * (w - pad * 2 - 150));
  const earlier = years.some((y) => y < y0);
  const row: Record<Kind, number> = { foundation: h * 0.26, session: h * 0.5, frontier: h * 0.76 };

  const sim = forceSimulation(nodes)
    .force("link", forceLink<SimNode, { source: string; target: string }>(links).id((d) => d.key).distance(mode === "web" ? 64 : 40).strength(mode === "web" ? 0.35 : 0.04))
    .force("collide", forceCollide<SimNode>((d) => d.r + (d.kind === "session" ? 14 : 7) * k))
    .stop();
  if (mode === "web") {
    sim.force("charge", forceManyBody().strength(-170)).force("x", forceX(w / 2).strength(0.06)).force("y", forceY(h / 2).strength(0.09));
  } else {
    sim.force("x", forceX<SimNode>((d) => xOfYear(d.year)).strength(0.9)).force("y", forceY<SimNode>((d) => row[d.kind]).strength(0.5));
  }
  for (let i = 0; i < 320; i++) sim.tick();

  if (mode === "web") {
    // Fit the web into the frame.
    const xs = nodes.map((n) => n.x!);
    const ys = nodes.map((n) => n.y!);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min((w - 140) / Math.max(1, maxX - minX), (h - 90) / Math.max(1, maxY - minY), 1.6);
    for (const n of nodes) {
      n.x = w / 2 + (n.x! - (minX + maxX) / 2) * s;
      n.y = h / 2 + (n.y! - (minY + maxY) / 2) * s;
    }
  }
  const ticks: { x: number; label: string }[] = [];
  if (mode === "timeline" && years.length) {
    const step = y1 - y0 > 40 ? 10 : y1 - y0 > 15 ? 5 : y1 - y0 > 6 ? 2 : 1;
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) ticks.push({ x: xOfYear(y), label: String(y) });
  }
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const edges = graph.edges.map((e) => ({ a: byKey.get(e.from)!, b: byKey.get(e.to)!, from: e.from, to: e.to })).filter((e) => e.a && e.b);
  return { nodes, edges, ticks, labels: placeLabels(nodes, w, h), earlier: mode === "timeline" && earlier ? `before ${y0}` : null };
}

// Direct labels for your papers only, placed where they don't collide (right,
// left, above, below; shorter if needed). A paper whose label can't fit still
// has its tooltip and the table.
type Box = { x0: number; y0: number; x1: number; y1: number };
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
function placeLabels(nodes: SimNode[], w: number, h: number) {
  const mine = nodes.filter((n) => n.kind === "session").sort((a, b) => b.citations - a.citations);
  const dots: Box[] = mine.map((n) => ({ x0: n.x! - n.r - 2, y0: n.y! - n.r - 2, x1: n.x! + n.r + 2, y1: n.y! + n.r + 2 }));
  const placed: Box[] = [];
  const labels: { key: string; x: number; y: number; anchor: "start" | "end" | "middle"; text: string }[] = [];
  for (const n of mine) {
    for (const max of [30, 18]) {
      const text = short(n.title, max);
      const tw = text.length * 6.1;
      const options = [
        { x: n.x! + n.r + 5, y: n.y! + 4, anchor: "start" as const, box: { x0: n.x! + n.r + 4, y0: n.y! - 8, x1: n.x! + n.r + 6 + tw, y1: n.y! + 6 } },
        { x: n.x! - n.r - 5, y: n.y! + 4, anchor: "end" as const, box: { x0: n.x! - n.r - 6 - tw, y0: n.y! - 8, x1: n.x! - n.r - 4, y1: n.y! + 6 } },
        { x: n.x!, y: n.y! - n.r - 7, anchor: "middle" as const, box: { x0: n.x! - tw / 2, y0: n.y! - n.r - 19, x1: n.x! + tw / 2, y1: n.y! - n.r - 4 } },
        { x: n.x!, y: n.y! + n.r + 15, anchor: "middle" as const, box: { x0: n.x! - tw / 2, y0: n.y! + n.r + 3, x1: n.x! + tw / 2, y1: n.y! + n.r + 18 } },
      ];
      const fit = options.find(
        (o) => o.box.x0 > 4 && o.box.x1 < w - 4 && o.box.y0 > 4 && o.box.y1 < h - 22 && !placed.some((b) => hit(b, o.box)) && !dots.some((d, i) => mine[i] !== n && hit(d, o.box)),
      );
      if (fit) {
        placed.push(fit.box);
        labels.push({ key: n.key, x: fit.x, y: fit.y, anchor: fit.anchor, text });
        break;
      }
    }
  }
  return labels;
}

export type MapSession = { id: string; title: string; kind: string; papers: number };
type Scope = { kind: "session"; sessionId: string; papers: SessionDoc[] } | { kind: "library" };

export function LiteratureMap({
  scope,
  onOpenDoc,
  onAdd,
  onClose,
}: {
  scope: Scope;
  onOpenDoc: (docId: string, sessionId?: string) => void;
  // Library: the session to add it to.
  onAdd: (paper: PaperMeta, sessionId?: string) => Promise<void>;
  onClose?: () => void; // the personal map is a page, not a dialog
}) {
  const library = scope.kind === "library";
  const [sessions, setSessions] = useState<MapSession[]>([]);
  const [total, setTotal] = useState(0);
  const [only, setOnly] = useState<string | null>(null); // library: the session picked
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); // the first build starts on open
  const [step, setStep] = useState(0);
  const [layout, setLayout] = useState<Layout>("web");
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 560 });

  // Fetch the map; state changes only once it answers.
  const fetchGraph = (refresh: boolean) =>
    (scope.kind === "library"
      ? fetch("/api/paper/graph/library", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ refresh }) })
      : fetch("/api/paper/graph", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ sessionId: scope.sessionId, docIds: scope.papers.map((p) => p.id).slice(0, 15), refresh }) })
    )
      .then(async (res) => {
        const j = (await res.json().catch(() => ({}))) as { graph?: Graph | null; error?: string; cached?: boolean; sessions?: MapSession[]; total?: number };
        if (!res.ok || j.graph === undefined) throw new Error(j.error ?? "Couldn't map the literature.");
        setSessions(j.sessions ?? []);
        setTotal(j.total ?? 0);
        setGraph(j.graph ?? { nodes: [], edges: [], built: "", missing: [] });
        setError(null);
        track(library ? "map.library" : "map.open", { nodes: j.graph?.nodes.length ?? 0, cached: Boolean(j.cached) });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't map the literature."))
      .finally(() => setLoading(false));

  function load(refresh = false) {
    setLoading(true);
    setError(null);
    setStep(0);
    void fetchGraph(refresh);
  }

  useEffect(() => {
    void fetchGraph(false);
    // Built once when opened; "Refresh" rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) return;
    const t = window.setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 2200);
    return () => window.clearInterval(t);
  }, [loading]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(320, e.contentRect.width), h: Math.max(320, e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table, graph]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selected) setSelected(null);
      else onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, selected]);

  const drawn = useMemo(() => (graph && graph.nodes.length ? layoutGraph(graph, layout, size.w, size.h) : null), [graph, layout, size.w, size.h]);
  const focusKey = hover?.key ?? selected;
  // What stays bright: a hovered or selected paper and its neighbours, else
  // the picked session's part of the map.
  const neighbours = useMemo(() => {
    if (!drawn) return null;
    if (!focusKey) return only ? new Set(drawn.nodes.filter((n) => n.sessions?.includes(only)).map((n) => n.key)) : null;
    const set = new Set([focusKey]);
    for (const e of drawn.edges) {
      if (e.from === focusKey) set.add(e.to);
      if (e.to === focusKey) set.add(e.from);
    }
    return set;
  }, [drawn, focusKey, only]);
  const sessionName = useMemo(() => new Map(sessions.map((x) => [x.id, x.title])), [sessions]);
  const namesOf = (n: GraphNode) => (n.sessions ?? []).map((id) => sessionName.get(id)).filter((t): t is string => Boolean(t));
  const counts = useMemo(() => {
    const c = { session: 0, foundation: 0, frontier: 0 } as Record<Kind, number>;
    for (const n of graph?.nodes ?? []) c[n.kind]++;
    return c;
  }, [graph]);
  const sel = graph?.nodes.find((n) => n.key === selected) ?? null;
  const hovered = drawn?.nodes.find((n) => n.key === hover?.key) ?? null;

  const box = (
      <div
        role={library ? "region" : "dialog"}
        aria-modal={library ? undefined : true}
        aria-labelledby="map-title"
        className={`flex w-full flex-col overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard ${library ? "h-[calc(100dvh-9rem)] min-h-[34rem]" : "animate-pop h-full max-h-[52rem] max-w-7xl"}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink px-5 py-4">
          <div>
            <p className={eyebrowClass}>{library ? "Your literature" : "Literature map"}</p>
            <h2 id="map-title" className="mt-0.5 font-serif text-2xl">
              {library ? "Everything you've read, connected" : "How your papers connect"}
            </h2>
            {library && total > LIBRARY_PAPERS && <p className="mt-0.5 text-xs text-muted">Your {LIBRARY_PAPERS} newest papers of {total}.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!table && (
              <div className="flex rounded-lg border border-ink p-0.5 text-xs" role="radiogroup" aria-label="Layout">
                {(["web", "timeline"] as const).map((m) => (
                  <button key={m} role="radio" aria-checked={layout === m} type="button" onClick={() => setLayout(m)} className={`rounded-md px-2.5 py-1 font-medium transition ${layout === m ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
                    {m === "web" ? "Web" : "Timeline"}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={() => setTable((v) => !v)} aria-pressed={table} className={`${ghostButtonClass} px-2.5 py-1 text-xs`}>
              {table ? "Show map" : "Table"}
            </button>
            <button type="button" onClick={() => load(true)} disabled={loading} className={`${ghostButtonClass} px-2.5 py-1 text-xs`}>
              Refresh
            </button>
            {onClose && (
              <button type="button" onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-paper">
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Legend: shape and fill carry identity, not only color. */}
        {graph && !loading && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line px-5 py-2.5 text-xs text-muted">
            <Legend kind="session" label={`${KIND_LABEL.session} (${counts.session})`} />
            <Legend kind="foundation" label={`Foundations: what they cite (${counts.foundation})`} />
            <Legend kind="frontier" label={`Newer work citing them (${counts.frontier})`} />
            {library && sessions.length > 1 && <Legend kind="bridge" label="Connects your sessions" />}
            <span className="ml-auto">Bigger = more cited. Lines: citations.</span>
          </div>
        )}
        {library && graph && !loading && sessions.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto border-b border-line px-5 py-2 text-xs" role="radiogroup" aria-label="Session">
            {[{ id: null, title: "All sessions", papers: counts.session + graph.missing.length }, ...sessions].map((x) => (
              <button
                key={x.id ?? "all"}
                type="button"
                role="radio"
                aria-checked={only === x.id}
                onClick={() => setOnly(x.id)}
                className={`shrink-0 rounded-full border px-2.5 py-1 whitespace-nowrap transition ${only === x.id ? "border-ink bg-ink text-white" : "border-ink/25 text-muted hover:border-ink hover:text-ink"}`}
              >
                {short(x.title, 28)} <span className="font-mono opacity-60">{x.papers}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <div ref={frame} className="relative min-w-0 flex-1 bg-paper/40">
            {loading ? (
              <div role="status" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="indeterminate h-[3px] w-24 rounded-full bg-line" />
                <p className="text-sm text-muted">{STEPS[step]}</p>
                <p className="text-xs text-muted">The first map takes 10 to 20 seconds; after that it opens instantly.</p>
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-danger">{error}</p>
                <button type="button" onClick={() => load(true)} className={`${ghostButtonClass} py-1.5 text-xs`}>
                  Try again
                </button>
              </div>
            ) : library && graph && !graph.nodes.length ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="font-serif text-xl">No papers yet</p>
                <p className="max-w-sm text-sm text-muted">
                  Add papers to a Papers session, or read a PDF as a paper in a study session. They all show up here, connected.
                </p>
              </div>
            ) : table || !drawn ? (
              <TableView graph={graph!} added={added} onPick={setSelected} namesOf={library ? namesOf : undefined} />
            ) : (
              <>
                <svg width={size.w} height={size.h} className="block" role="img" aria-label={`Citation map: ${counts.session} of your papers, ${counts.foundation} foundations and ${counts.frontier} newer papers.`}>
                  {drawn.ticks.map((t) => (
                    <g key={t.label}>
                      <line x1={t.x} x2={t.x} y1={28} y2={size.h - 26} stroke="#ebeae5" strokeWidth={1} />
                      <text x={t.x} y={size.h - 10} textAnchor="middle" className="fill-muted font-mono text-[10px]">
                        {t.label}
                      </text>
                    </g>
                  ))}
                  {layout === "timeline" &&
                    (["foundation", "session", "frontier"] as const).map((k) => (
                      <text key={k} x={12} y={(k === "foundation" ? 0.26 : k === "session" ? 0.5 : 0.76) * size.h - 18} className="fill-muted font-mono text-[10px] uppercase">
                        {KIND_LABEL[k]}
                      </text>
                    ))}
                  <g>
                    {drawn.edges.map((e, i) => {
                      const on = focusKey && (e.from === focusKey || e.to === focusKey);
                      // Dimmed: off the hovered paper, or outside the picked session.
                      const faded = focusKey ? !on : Boolean(neighbours && !(neighbours.has(e.from) && neighbours.has(e.to)));
                      return (
                        <line
                          key={i}
                          x1={e.a.x}
                          y1={e.a.y}
                          x2={e.b.x}
                          y2={e.b.y}
                          stroke={on ? INK : EDGE}
                          strokeWidth={on ? 1.5 : 1}
                          opacity={faded ? 0.3 : 1}
                        />
                      );
                    })}
                  </g>
                  <g>
                    {drawn.nodes.map((n) => {
                      const dim = neighbours && !neighbours.has(n.key);
                      const isFocus = n.key === focusKey;
                      return (
                        <g
                          key={n.key}
                          transform={`translate(${n.x},${n.y})`}
                          opacity={dim ? 0.25 : 1}
                          tabIndex={0}
                          role="button"
                          aria-label={`${n.title}, ${n.year ?? "year unknown"}. ${relation(n)}. ${fmt(n.citations)} citations.`}
                          onPointerEnter={(ev) => setHover({ key: n.key, x: ev.nativeEvent.offsetX, y: ev.nativeEvent.offsetY })}
                          onPointerMove={(ev) => setHover({ key: n.key, x: ev.nativeEvent.offsetX, y: ev.nativeEvent.offsetY })}
                          onPointerLeave={() => setHover(null)}
                          onFocus={() => setHover({ key: n.key, x: n.x!, y: n.y! })}
                          onBlur={() => setHover(null)}
                          onClick={() => setSelected(n.key)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              setSelected(n.key);
                            }
                          }}
                          className="cursor-pointer outline-none"
                        >
                          {/* Hit area: bigger than the mark (24px minimum). */}
                          <circle r={Math.max(12, n.r + 6)} fill="transparent" />
                          {isFocus && <circle r={n.r + 6} fill="none" stroke={FOCUS} strokeWidth={3} />}
                          {library && bridges(n) && !isFocus && <circle r={n.r + 3.5} fill="none" stroke={INK} strokeWidth={1} />}
                          {n.kind === "frontier" ? (
                            <rect x={-n.r * 0.9} y={-n.r * 0.9} width={n.r * 1.8} height={n.r * 1.8} rx={2} fill={added.has(n.key) ? INK : NEWER} stroke={SURFACE} strokeWidth={2} />
                          ) : n.kind === "foundation" ? (
                            <circle r={n.r} fill={added.has(n.key) ? INK : SURFACE} stroke={CONTEXT} strokeWidth={2} />
                          ) : (
                            <circle r={n.r} fill={INK} stroke={SURFACE} strokeWidth={2} />
                          )}
                        </g>
                      );
                    })}
                  </g>
                  {/* Labels last, so no mark is painted over them. */}
                  <g aria-hidden>
                    {drawn.labels.map((l) => (
                      <text
                        key={l.key}
                        x={l.x}
                        y={l.y}
                        textAnchor={l.anchor}
                        opacity={neighbours && !neighbours.has(l.key) ? 0.25 : 1}
                        className="pointer-events-none font-sans text-[11px] font-medium"
                        fill={INK}
                        stroke={SURFACE}
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {l.text}
                      </text>
                    ))}
                  </g>
                  {drawn.earlier && (
                    <text x={70} y={size.h - 10} textAnchor="middle" className="fill-muted font-mono text-[10px]">
                      ← {drawn.earlier}
                    </text>
                  )}
                </svg>
                {hovered && hover && (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute z-10 w-72 rounded-lg border border-ink bg-panel px-3 py-2.5 text-xs shadow-hard-sm"
                    style={{ left: Math.min(hover.x + 14, size.w - 300), top: Math.min(hover.y + 14, size.h - 120) }}
                  >
                    <p className="text-sm leading-snug font-medium">{hovered.title}</p>
                    <p className="mt-1 text-muted">
                      {[hovered.authors.slice(0, 2).join(", ") + (hovered.authors.length > 2 ? " et al." : ""), hovered.year].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-1.5">
                      <span className="font-medium">{fmt(hovered.citations)}</span> <span className="text-muted">citations · {relation(hovered)}</span>
                    </p>
                    {library && namesOf(hovered).length > 0 && <p className="mt-1 text-muted">{namesOf(hovered).length > 1 ? "Sessions" : "Session"}: {namesOf(hovered).join(", ")}</p>}
                  </div>
                )}
              </>
            )}
            {graph && graph.missing.length > 0 && !loading && (
              <p className="absolute bottom-2 left-3 max-w-md text-[11px] text-muted">Not found in OpenAlex or Semantic Scholar: {graph.missing.map((t) => short(t, 40)).join("; ")}.</p>
            )}
          </div>

          {sel && (
            <Detail
              key={sel.key}
              node={sel}
              inSession={sel.kind === "session"}
              added={added.has(sel.key)}
              sessions={library ? sessions : undefined}
              onClose={() => setSelected(null)}
              onOpen={(doc, session) => {
                onOpenDoc(doc, session);
                onClose?.();
              }}
              onAdd={async (session) => {
                await onAdd(await paperFor(sel), session);
                setAdded((s) => new Set(s).add(sel.key));
                track("map.add_paper", { kind: sel.kind, library });
              }}
            />
          )}
        </div>
      </div>
  );

  if (library) return box;
  return createPortal(
    <div className="animate-fade fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-2 backdrop-blur-[2px] sm:p-5" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      {box}
    </div>,
    document.body,
  );
}

function Legend({ kind, label }: { kind: Kind | "bridge"; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden>
        {kind === "bridge" ? (
          <>
            <circle r={3.5} fill={SURFACE} stroke={CONTEXT} strokeWidth={1.5} />
            <circle r={6.2} fill="none" stroke={INK} strokeWidth={1} />
          </>
        ) : kind === "frontier" ? (
          <rect x={-5} y={-5} width={10} height={10} rx={1.5} fill={NEWER} />
        ) : kind === "foundation" ? (
          <circle r={5} fill={SURFACE} stroke={CONTEXT} strokeWidth={2} />
        ) : (
          <circle r={5.5} fill={INK} />
        )}
      </svg>
      {label}
    </span>
  );
}

// The same information without the picture: every paper, by group.
function TableView({ graph, added, onPick, namesOf }: { graph: Graph; added: Set<string>; onPick: (key: string) => void; namesOf?: (n: GraphNode) => string[] }) {
  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      {(["session", "foundation", "frontier"] as const).map((k) => {
        const rows = graph.nodes.filter((n) => n.kind === k).sort((a, b) => (b.citedByYours ?? b.citesYours ?? 0) - (a.citedByYours ?? a.citesYours ?? 0) || b.citations - a.citations);
        if (!rows.length) return null;
        return (
          <section key={k} className="mb-6">
            <h3 className="flex items-center gap-2 font-serif text-lg">
              <Legend kind={k} label="" />
              {KIND_LABEL[k]}
            </h3>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10px] tracking-wider text-muted uppercase">
                  <th className="py-1.5 pr-3 font-medium">Title</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Year</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Citations</th>
                  <th className="py-1.5 pr-3 font-medium">Link to yours</th>
                  {namesOf && <th className="py-1.5 font-medium">Sessions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.key} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5 pr-3">
                      <button type="button" onClick={() => onPick(n.key)} className="text-left hover:underline">
                        {n.title}
                      </button>
                      {added.has(n.key) && <span className="ml-2 font-mono text-[10px] text-ok">added</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono text-xs tabular-nums">{n.year ?? "–"}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-xs tabular-nums">{fmt(n.citations)}</td>
                    <td className="py-1.5 pr-3 text-xs text-muted">{relation(n)}</td>
                    {namesOf && <td className="py-1.5 text-xs text-muted">{namesOf(n).join(", ") || "–"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

function Detail({
  node,
  inSession,
  added,
  sessions,
  onClose,
  onOpen,
  onAdd,
}: {
  node: GraphNode;
  inSession: boolean;
  added: boolean;
  sessions?: MapSession[]; // the personal map: where to open or add it
  onClose: () => void;
  onOpen: (docId: string, sessionId?: string) => void;
  onAdd: (sessionId?: string) => Promise<void>;
}) {
  // Keyed by the paper, so this starts fresh for each one.
  const [abstract, setAbstract] = useState<string | null | undefined>(node.oa ? undefined : null);
  // Add it to the session it connects to, unless the student picks another.
  const [target, setTarget] = useState(node.sessions?.[0] ?? sessions?.[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!node.oa) return;
    // OpenAlex allows requests straight from the browser.
    void fetch(`https://api.openalex.org/works/${node.oa}?select=abstract_inverted_index`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { abstract_inverted_index?: Record<string, number[]> | null } | null) => {
        if (!live) return;
        const idx = j?.abstract_inverted_index;
        if (!idx) return setAbstract(null);
        const words: string[] = [];
        for (const [word, pos] of Object.entries(idx)) for (const p of pos) words[p] = word;
        setAbstract(words.join(" ").trim() || null);
      })
      .catch(() => live && setAbstract(null));
    return () => {
      live = false;
    };
  }, [node.oa]);

  return (
    <aside className="animate-slide-in flex w-80 shrink-0 flex-col border-l border-ink bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className={eyebrowClass}>{KIND_LABEL[node.kind]}</span>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded px-1 text-muted hover:text-ink">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <h3 className="font-serif text-xl leading-snug">{node.title}</h3>
        <p className="mt-2 text-xs leading-relaxed text-muted">{[node.authors.join(", "), node.year].filter(Boolean).join(" · ")}</p>
        <p className="mt-3 text-sm">
          <span className="font-medium">{fmt(node.citations)}</span> <span className="text-muted">citations · {relation(node)}</span>
        </p>
        <p className="mt-4 text-sm leading-relaxed">
          {abstract === undefined ? <span className="text-muted">Loading the abstract…</span> : abstract ? `${abstract.slice(0, 1400)}${abstract.length > 1400 ? "…" : ""}` : <span className="text-muted">No abstract available.</span>}
        </p>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
        {inSession ? (
          sessions ? (
            (node.docs ?? []).map((d) => (
              <button key={d.doc} type="button" onClick={() => onOpen(d.doc, d.session)} className="max-w-full truncate rounded-md border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-white">
                Open in {short(sessions.find((x) => x.id === d.session)?.title ?? "its session", 30)}
              </button>
            ))
          ) : (
            node.docId && (
              <button type="button" onClick={() => onOpen(node.docId!)} className="rounded-md border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-white">
                Open in this session
              </button>
            )
          )
        ) : (
          <>
          {sessions && sessions.length > 0 && (
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={pending || added}
              aria-label="Session to add it to"
              className="w-full rounded-md border border-ink/30 bg-panel px-2 py-1.5 text-xs"
            >
              {sessions.map((x) => (
                <option key={x.id} value={x.id}>
                  {short(x.title, 40)}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={pending || added}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await onAdd(sessions ? target : undefined);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Couldn't add it.");
              } finally {
                setPending(false);
              }
            }}
            className="rounded-md border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {added ? "Added ✓" : pending ? "Adding…" : sessions ? "Add to session" : "Add to this session"}
          </button>
          </>
        )}
        {node.url && (
          <a href={node.url} target="_blank" rel="noreferrer" className={`${ghostButtonClass} px-3 py-1 text-xs`}>
            Source ↗
          </a>
        )}
      </div>
    </aside>
  );
}

// Full details (and an open PDF, when there is one) for a paper on the map.
async function paperFor(n: GraphNode): Promise<PaperMeta> {
  const query = n.arxiv ? `arXiv:${n.arxiv}` : n.doi ? n.doi : n.title;
  try {
    const res = await fetch("/api/paper/resolve", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ query }) });
    if (res.ok) {
      const j = (await res.json()) as { results: { paper: PaperMeta | null }[] };
      const p = j.results.map((r) => r.paper).find((x) => x && x.title.toLowerCase().replace(/[^a-z0-9]+/g, "") === n.title.toLowerCase().replace(/[^a-z0-9]+/g, ""));
      if (p) return p;
      if (n.arxiv || n.doi) {
        const first = j.results[0]?.paper;
        if (first) return first;
      }
    }
  } catch {}
  return { title: n.title, authors: n.authors, year: n.year, venue: null, abstract: null, doi: n.doi, arxiv_id: n.arxiv, url: n.url ?? "", pdf_url: n.arxiv ? `https://arxiv.org/pdf/${n.arxiv}` : null };
}

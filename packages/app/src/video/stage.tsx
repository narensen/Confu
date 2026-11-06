"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { compileExpression, samplePlot } from "@confu/core/video/expr";
import type { Line, Scene } from "@confu/core/video/script";
import { beat, type SceneTime } from "@confu/core/video/timing";
import { gsap } from "@confu/ui/motion";
import { sanitizeDrawing } from "./sanitize";

// The video's stage: a fixed 1280×720 frame, drawn in HTML and SVG, so a
// scene looks the same in the player and in the exported file. Every
// template lays out its finished picture; animateScene() builds the paused
// GSAP timeline that brings it in, timed to the narration.

export const W = 1280;
export const H = 720;

const INK = "#0e0e0d";
const PAPER = "#f2eee6";
const MUTED = "#8f897e";
const LINE = "#2a2925";
const AMBER = "#f5a524";

// Scoped to .cv-stage; self-contained, because the export draws the stage
// without the page's stylesheets. Fonts come from --cv-sans/serif/mono.
export const STAGE_CSS = `
.cv-stage{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${INK};color:${PAPER};font-family:var(--cv-sans);font-size:28px;line-height:1.35;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.cv-stage *{box-sizing:border-box}
.cv-scene{position:absolute;inset:0;padding:64px 88px 128px;display:flex;flex-direction:column}
.cv-h{font-family:var(--cv-serif);font-weight:500;font-size:52px;line-height:1.08;letter-spacing:-0.01em;margin:0 0 30px;max-height:120px;overflow:hidden}
.cv-body{position:relative;flex:1;min-height:0}
.cv-fill{position:absolute;inset:0}
.cv-muted{color:${MUTED}}
.cv-amber{color:${AMBER}}
.cv-mono{font-family:var(--cv-mono)}
.cv-serif{font-family:var(--cv-serif)}
.cv-center{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.cv-list{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:0.8em;overflow:hidden;font-size:34px}
.cv-li{display:flex;gap:0.7em;align-items:baseline;line-height:1.25}
.cv-li-n{flex:none;width:1.6em;font-family:var(--cv-mono);font-size:0.6em;color:${AMBER};transform:translateY(-0.15em)}
.cv-card{border:1.5px solid ${LINE};border-radius:14px;background:#151513;padding:22px 24px}
.cv-node{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;text-align:center;border:1.5px solid ${LINE};border-radius:12px;background:#151513;padding:12px 16px;font-size:24px;line-height:1.2;overflow:hidden}
.cv-svg{position:absolute;inset:0;overflow:visible}
.cv-svg text{fill:${MUTED};font-family:var(--cv-mono);font-size:18px}
.cv-stroke{fill:none;stroke:${PAPER};stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.cv-stroke-amber{fill:none;stroke:${AMBER};stroke-width:4;stroke-linecap:round;stroke-linejoin:round}
.cv-grid{stroke:${LINE};stroke-width:1.5}
.cv-axis{stroke:#4a4842;stroke-width:2}
.cv-caption{position:absolute;left:0;right:0;bottom:0;height:104px;display:flex;align-items:center;justify-content:center;gap:16px;padding:0 120px;border-top:1.5px solid ${LINE};background:${INK};font-size:26px;line-height:1.3;text-align:center;overflow:hidden}
.cv-dot{flex:none;width:12px;height:12px;border-radius:50%;background:${AMBER}}
.cv-dot-B{background:${PAPER}}
.cv-progress{position:absolute;left:0;bottom:0;height:4px;background:${AMBER};transform-origin:left center}
.cv-draw svg{width:100%;height:100%}
.cv-draw svg :is(path,circle,ellipse,rect,line,polyline,polygon){fill:none;stroke:${PAPER};stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.cv-draw svg text,.cv-draw svg tspan{fill:${PAPER};stroke:none;font-family:var(--cv-sans);font-size:22px}
.cv-draw .accent,.cv-draw svg .accent{stroke:${AMBER};color:${AMBER}}
.cv-draw svg text.accent{fill:${AMBER}}
.cv-draw .filled{fill:${PAPER}}
.cv-draw .filled.accent{fill:${AMBER}}
`;

/* ------------------------------------------------------------- helpers */

export function fmt(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  return new Intl.NumberFormat("en", { maximumFractionDigits: a < 10 ? 2 : a < 100 ? 1 : 0 }).format(v);
}

function ticks(min: number, max: number, n = 4): number[] {
  const span = max - min || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const e = raw / mag;
  const step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

// Shrinks text marked data-fit until it fits its box (to half its size at
// most). Returns what still overflows, for the test lab.
const overflows = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;

// One element; true if it fits.
export function fitOne(el: HTMLElement): boolean {
  el.style.fontSize = "";
  const base = parseFloat(getComputedStyle(el).fontSize) || 28;
  let size = base;
  while (overflows(el) && size > base * 0.5) {
    size *= 0.92;
    el.style.fontSize = `${size}px`;
  }
  return !overflows(el);
}

export function fitText(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-fit]")].filter((el) => !fitOne(el));
}

const Heading = ({ children }: { children: ReactNode }) => (
  <h2 className="cv-h" data-a="h" data-fit>
    {children}
  </h2>
);

// Positions around an ellipse, starting at the top.
function around(n: number, cx: number, cy: number, rx: number, ry: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => {
    const a = ((-90 + offset + (360 * i) / n) * Math.PI) / 180;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a), a };
  });
}

const Arrow = ({ id }: { id: string }) => (
  <defs>
    <marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,1 L9,5 L0,9" fill="none" stroke={MUTED} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </marker>
  </defs>
);

/* ----------------------------------------------------------- templates */

// The body area's size inside .cv-scene (after the heading).
const BODY_W = W - 88 * 2;
const BODY_H = 448;
const FULL_H = H - 64 - 128;

function Body({ scene }: { scene: Scene }) {
  switch (scene.template) {
    case "title":
      return (
        <div className="cv-fill cv-center" style={{ padding: "0 40px" }}>
          <h1 className="cv-serif" data-a="title" data-fit style={{ fontSize: 84, lineHeight: 1.04, fontWeight: 500, letterSpacing: "-0.015em", margin: 0, maxHeight: 280, overflow: "hidden" }}>
            {scene.title}
          </h1>
          <div data-a="bar" style={{ width: 120, height: 5, background: AMBER, margin: "34px 0 28px", borderRadius: 3 }} />
          {scene.subtitle && (
            <p className="cv-muted" data-a="sub" data-fit style={{ fontSize: 32, margin: 0, maxWidth: 900, maxHeight: 100, overflow: "hidden" }}>
              {scene.subtitle}
            </p>
          )}
        </div>
      );
    case "points":
    case "recap":
      return (
        <>
          <Heading>{scene.title}</Heading>
          <div className="cv-body">
            <ol className="cv-list" data-fit style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {scene.points.map((p, i) => (
                <li key={i} className="cv-li" data-a="item">
                  {scene.template === "recap" ? (
                    <svg width="0.9em" height="0.9em" viewBox="0 0 24 24" style={{ flex: "none", transform: "translateY(0.1em)" }} aria-hidden>
                      <path data-a="check" d="M4 12.5l5 5L20 6.5" className="cv-stroke-amber" />
                    </svg>
                  ) : (
                    <span className="cv-li-n">{String(i + 1).padStart(2, "0")}</span>
                  )}
                  <span>{p}</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      );
    case "definition":
      return (
        <div className="cv-fill" style={{ padding: "64px 88px 128px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 26 }}>
          <p className="cv-muted" data-a="label" style={{ fontSize: 24, margin: 0 }}>
            What it means
          </p>
          <h2 className="cv-serif" data-a="term" data-fit style={{ fontSize: 78, fontWeight: 500, lineHeight: 1.05, margin: 0, maxHeight: 170, overflow: "hidden" }}>
            {scene.term}
          </h2>
          <p data-a="meaning" data-fit style={{ fontSize: 38, lineHeight: 1.3, margin: 0, maxWidth: 1000, maxHeight: 160, overflow: "hidden" }}>
            {scene.meaning}
          </p>
          {scene.example && (
            <div className="cv-card" data-a="example" style={{ maxWidth: 1000, borderLeft: `4px solid ${AMBER}` }}>
              <p className="cv-muted" style={{ fontSize: 20, margin: "0 0 6px" }}>
                For example
              </p>
              <p data-fit style={{ fontSize: 28, margin: 0, maxHeight: 80, overflow: "hidden" }}>
                {scene.example}
              </p>
            </div>
          )}
        </div>
      );
    case "equation":
      return (
        <>
          <Heading>{scene.title}</Heading>
          <div className="cv-body" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 40 }}>
            <div className="cv-card" data-a="formula" style={{ padding: "28px 48px", maxWidth: BODY_W, borderColor: "#3a3832" }}>
              <p className="cv-serif" data-fit style={{ fontSize: 66, fontStyle: "italic", margin: 0, whiteSpace: "nowrap", maxWidth: BODY_W - 100, overflow: "hidden" }}>
                {scene.formula}
              </p>
            </div>
            {scene.parts.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: scene.parts.length > 2 ? "1fr 1fr" : "1fr", gap: "14px 56px", maxWidth: BODY_W }}>
                {scene.parts.map((p, i) => (
                  <div key={i} data-a="part" style={{ display: "flex", gap: 18, alignItems: "baseline", fontSize: 27 }}>
                    <span className="cv-serif cv-amber" style={{ fontStyle: "italic", fontSize: 34, minWidth: 48, textAlign: "right" }}>
                      {p.symbol}
                    </span>
                    <span>{p.meaning}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      );
    case "steps": {
      const n = scene.steps.length;
      if (n <= 4)
        return (
          <>
            <Heading>{scene.title}</Heading>
            <div className="cv-body" style={{ display: "flex", alignItems: "center", gap: 0 }}>
              {scene.steps.map((s, i) => (
                <div key={i} style={{ display: "contents" }}>
                  <div className="cv-card" data-a="item" style={{ flex: 1, height: 230, display: "flex", flexDirection: "column", gap: 14 }}>
                    <span className="cv-mono cv-amber" style={{ fontSize: 20 }}>
                      Step {i + 1}
                    </span>
                    <p data-fit style={{ margin: 0, fontSize: n === 4 ? 27 : 30, lineHeight: 1.25, flex: 1, overflow: "hidden" }}>
                      {s}
                    </p>
                  </div>
                  {i < n - 1 && (
                    <svg data-a="arrow" width="54" height="24" viewBox="0 0 54 24" style={{ flex: "none" }} aria-hidden>
                      <path d="M8 12h34M34 5l8 7-8 7" className="cv-stroke" stroke={MUTED} style={{ stroke: MUTED }} />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          </>
        );
      return (
        <>
          <Heading>{scene.title}</Heading>
          <div className="cv-body">
            <div data-a="rail" style={{ position: "absolute", left: 21, top: 30, bottom: 30, width: 2, background: LINE, transformOrigin: "top" }} />
            <ol data-fit style={{ position: "absolute", inset: 0, margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", justifyContent: "space-around", fontSize: 29, overflow: "hidden" }}>
              {scene.steps.map((s, i) => (
                <li key={i} data-a="item" style={{ display: "flex", alignItems: "center", gap: 24 }}>
                  <span className="cv-mono" style={{ flex: "none", width: 44, height: 44, borderRadius: 22, background: INK, border: `2px solid ${AMBER}`, color: AMBER, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                    {i + 1}
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      );
    }
    case "compare":
      return (
        <>
          <Heading>{scene.title}</Heading>
          <div className="cv-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64 }}>
            <div data-a="divider" style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, background: LINE, transformOrigin: "top" }} />
            {[scene.left, scene.right].map((side, k) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", gap: 18, minHeight: 0 }}>
                <p data-a="label" className="cv-serif" data-fit style={{ margin: 0, fontSize: 40, color: k === 0 ? AMBER : PAPER, maxHeight: 60, overflow: "hidden", whiteSpace: "nowrap" }}>
                  {side.label}
                </p>
                <ul data-fit style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 16, fontSize: 28, flex: 1, overflow: "hidden" }}>
                  {side.points.map((p, i) => (
                    <li key={i} data-a={k === 0 ? "left" : "right"} style={{ display: "flex", gap: 14 }}>
                      <span style={{ flex: "none", width: 8, height: 8, marginTop: "0.55em", borderRadius: 4, background: k === 0 ? AMBER : PAPER }} />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      );
    case "bars": {
      const max = Math.max(...scene.bars.map((b) => Math.abs(b.value)), 1e-9);
      const top = Math.max(...scene.bars.map((b) => b.value));
      const h = Math.min(56, Math.floor((BODY_H - 20) / scene.bars.length) - 16);
      return (
        <>
          <Heading>{scene.title}</Heading>
          <div className="cv-body" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 16 }}>
            {scene.bars.map((b, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 22, height: h }}>
                <span data-fit style={{ width: 280, flex: "none", textAlign: "right", fontSize: Math.min(26, h * 0.62), color: MUTED, maxHeight: h, overflow: "hidden", lineHeight: 1.15 }}>
                  {b.label}
                </span>
                <div style={{ flex: 1, height: h * 0.72, display: "flex", alignItems: "center", gap: 16 }}>
                  <div data-a="bar" style={{ height: "100%", width: `${Math.max(0.6, (Math.abs(b.value) / max) * 82)}%`, background: b.value === top ? AMBER : "#5c5850", borderRadius: 4, transformOrigin: "left center" }} />
                  <span className="cv-mono" data-a="value" data-value={b.value} data-unit={scene.unit} style={{ fontSize: Math.min(26, h * 0.6), whiteSpace: "nowrap" }}>
                    {fmt(b.value)}
                    {scene.unit}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      );
    }
    case "line":
      return (
        <>
          <Heading>{scene.title}</Heading>
          <div className="cv-body">
            <LineChart scene={scene} />
          </div>
        </>
      );
    case "plot":
      return (
        <>
          <Heading>{scene.title}</Heading>
          <div className="cv-body">
            <Plot scene={scene} />
          </div>
        </>
      );
    case "timeline": {
      const n = scene.events.length;
      const pad = 90;
      const xs = scene.events.map((_, i) => (n === 1 ? BODY_W / 2 : pad + (i * (BODY_W - 2 * pad)) / (n - 1)));
      const w = Math.min(250, (BODY_W - 40) / Math.max(1, Math.ceil(n / 2)) - 20);
      const y = BODY_H / 2;
      return (
        <>
          <Heading>{scene.title}</Heading>
          <div className="cv-body">
            <div data-a="axis" style={{ position: "absolute", left: 40, right: 40, top: y - 1, height: 3, background: "#4a4842", transformOrigin: "left center" }} />
            {scene.events.map((e, i) => {
              const up = i % 2 === 0;
              return (
                <div key={i} data-a="item">
                  <div style={{ position: "absolute", left: xs[i] - 9, top: y - 8, width: 18, height: 18, borderRadius: 9, background: AMBER, border: `4px solid ${INK}` }} />
                  <div style={{ position: "absolute", left: xs[i], top: up ? y - 34 : y + 34, transform: `translate(-50%, ${up ? "-100%" : "0"})`, width: w, textAlign: "center", display: "flex", flexDirection: up ? "column" : "column", gap: 6 }}>
                    <span className="cv-mono cv-amber" style={{ fontSize: 22 }}>
                      {e.when}
                    </span>
                    <span data-fit style={{ fontSize: 23, lineHeight: 1.22, maxHeight: 150, overflow: "hidden" }}>
                      {e.what}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      );
    }
    case "cycle": {
      const n = scene.stages.length;
      const cx = BODY_W / 2;
      const cy = BODY_H / 2;
      const rx = n <= 3 ? 300 : 380;
      const ry = 165;
      const pts = around(n, cx, cy, rx, ry);
      const gap = n <= 4 ? 0.42 : 0.32; // radians kept clear around each box
      const arc = (i: number) => {
        const a0 = pts[i].a + gap;
        const a1 = pts[(i + 1) % n].a - gap + (i === n - 1 ? Math.PI * 2 : 0);
        const p0 = { x: cx + rx * Math.cos(a0), y: cy + ry * Math.sin(a0) };
        const p1 = { x: cx + rx * Math.cos(a1), y: cy + ry * Math.sin(a1) };
        return `M${p0.x.toFixed(1)},${p0.y.toFixed(1)} A${rx},${ry} 0 0 1 ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
      };
      const bw = n <= 4 ? 250 : 210;
      return (
        <>
          <Heading>{scene.title}</Heading>
          <div className="cv-body">
            <svg className="cv-svg" width={BODY_W} height={BODY_H} viewBox={`0 0 ${BODY_W} ${BODY_H}`} aria-hidden>
              <Arrow id="cv-cycle-arrow" />
              {pts.map((_, i) => (
                <path key={i} data-a="arc" d={arc(i)} fill="none" stroke={MUTED} strokeWidth="2.2" strokeLinecap="round" markerEnd="url(#cv-cycle-arrow)" />
              ))}
            </svg>
            {scene.stages.map((s, i) => (
              <div key={i} className="cv-node" data-a="item" data-fit style={{ left: pts[i].x, top: pts[i].y, width: bw, maxHeight: 110, borderColor: i === 0 ? AMBER : LINE }}>
                {s}
              </div>
            ))}
          </div>
        </>
      );
    }
    case "map": {
      const n = scene.branches.length;
      const cx = BODY_W / 2;
      const cy = FULL_H / 2;
      const pts = around(n, cx, cy, 400, 190, n % 2 === 0 ? 180 / n : 0);
      return (
        <div className="cv-fill" style={{ padding: "64px 88px 128px" }}>
          <div style={{ position: "relative", width: BODY_W, height: FULL_H }}>
            <svg className="cv-svg" width={BODY_W} height={FULL_H} viewBox={`0 0 ${BODY_W} ${FULL_H}`} aria-hidden>
              {pts.map((p, i) => (
                <line key={i} data-a="spoke" x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#4a4842" strokeWidth="2.2" strokeLinecap="round" />
              ))}
            </svg>
            <div className="cv-node cv-serif" data-a="center" data-fit style={{ left: cx, top: cy, width: 300, maxHeight: 120, fontSize: 34, borderColor: AMBER, borderWidth: 2.5, background: INK }}>
              {scene.center}
            </div>
            {scene.branches.map((b, i) => (
              <div key={i} className="cv-node" data-a="item" data-fit style={{ left: pts[i].x, top: pts[i].y, width: 230, maxHeight: 100 }}>
                {b}
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "number":
      return (
        <div className="cv-fill cv-center" style={{ padding: "64px 120px 128px", gap: 18 }}>
          <p className="cv-serif cv-amber" style={{ fontSize: 168, lineHeight: 1, margin: 0, fontWeight: 500, letterSpacing: "-0.03em", whiteSpace: "nowrap" }}>
            <span data-a="count" data-value={scene.value}>
              {fmt(scene.value)}
            </span>
            <span style={{ fontSize: "0.45em", marginLeft: "0.08em" }}>{scene.unit}</span>
          </p>
          <p data-a="label" data-fit style={{ fontSize: 36, margin: 0, maxWidth: 960, maxHeight: 150, overflow: "hidden" }}>
            {scene.label}
          </p>
        </div>
      );
    case "quote":
      return (
        <div className="cv-fill" style={{ padding: "64px 140px 128px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <span className="cv-serif cv-amber" data-a="mark" style={{ fontSize: 150, lineHeight: 0.6, height: 70 }}>
            “
          </span>
          <p className="cv-serif" data-a="text" data-fit style={{ fontSize: 54, lineHeight: 1.2, margin: 0, maxHeight: 340, overflow: "hidden" }}>
            {scene.text}
          </p>
          {scene.by && (
            <p className="cv-muted" data-a="by" style={{ fontSize: 26, margin: "26px 0 0" }}>
              — {scene.by}
            </p>
          )}
        </div>
      );
    case "code": {
      const lines = scene.code.split("\n");
      const longest = Math.max(...lines.map((l) => l.length), 20);
      // 18px is the smallest the frame stays readable at. Longer code is clipped before it gets here.
      const size = Math.max(18, Math.min(25, Math.floor(980 / (longest * 0.62)), Math.floor(400 / (lines.length * 1.5))));
      return (
        <>
          <Heading>{scene.title}</Heading>
          <div className="cv-body" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div className="cv-card cv-mono" style={{ position: "relative", padding: "22px 28px", fontSize: size, lineHeight: 1.5, maxWidth: BODY_W, overflow: "hidden" }}>
              <span className="cv-muted" style={{ position: "absolute", top: 10, right: 16, fontSize: 18 }}>
                {scene.language}
              </span>
              {lines.map((l, i) => (
                <div key={i} data-a="code" data-line={i + 1} style={{ position: "relative", whiteSpace: "pre", display: "flex", gap: 22 }}>
                  {scene.focus.includes(i + 1) && <span data-a="focus" style={{ position: "absolute", left: -12, right: -12, top: 0, bottom: 0, background: "rgba(245,165,36,0.16)", borderLeft: `3px solid ${AMBER}`, transformOrigin: "left center" }} />}
                  <span className="cv-muted" style={{ position: "relative", width: "2ch", textAlign: "right", flex: "none" }}>
                    {i + 1}
                  </span>
                  <span style={{ position: "relative" }}>{l || " "}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      );
    }
    case "html": {
      const clean = sanitizeDrawing(scene.html);
      return (
        <>
          {scene.title && <Heading>{scene.title}</Heading>}
          <div className="cv-body cv-draw" data-a="draw" data-visible={clean.visible ? "1" : "0"} style={{ display: "flex", alignItems: "center", justifyContent: "center" }} dangerouslySetInnerHTML={{ __html: clean.html }} />
        </>
      );
    }
  }
}

function chartFrame(xMin: number, xMax: number, yMin: number, yMax: number) {
  const m = { l: 92, r: 30, t: 14, b: 56 };
  const w = BODY_W - m.l - m.r;
  const h = BODY_H - m.t - m.b;
  const X = (x: number) => m.l + ((x - xMin) / (xMax - xMin || 1)) * w;
  const Y = (y: number) => m.t + h - ((y - yMin) / (yMax - yMin || 1)) * h;
  return { m, w, h, X, Y };
}

function Axes({ f, xs, ys, xLabel, yLabel }: { f: ReturnType<typeof chartFrame>; xs: number[]; ys: number[]; xLabel?: string; yLabel?: string }) {
  return (
    <g data-a="axes">
      {ys.map((y) => (
        <g key={`y${y}`}>
          <line className="cv-grid" x1={f.m.l} x2={f.m.l + f.w} y1={f.Y(y)} y2={f.Y(y)} />
          <text x={f.m.l - 14} y={f.Y(y) + 6} textAnchor="end">
            {fmt(y)}
          </text>
        </g>
      ))}
      {xs.map((x) => (
        <text key={`x${x}`} x={f.X(x)} y={f.m.t + f.h + 30} textAnchor="middle">
          {fmt(x)}
        </text>
      ))}
      <line className="cv-axis" x1={f.m.l} x2={f.m.l + f.w} y1={f.m.t + f.h} y2={f.m.t + f.h} />
      {xLabel && (
        <text x={f.m.l + f.w} y={f.m.t + f.h + 52} textAnchor="end" style={{ fill: PAPER, fontSize: 20 }}>
          {xLabel}
        </text>
      )}
      {yLabel && (
        <text x={f.m.l + 8} y={f.m.t + 4} style={{ fill: PAPER, fontSize: 20 }}>
          {yLabel}
        </text>
      )}
    </g>
  );
}

function LineChart({ scene }: { scene: Extract<Scene, { template: "line" }> }) {
  const xs = scene.points.map((p) => p.x);
  const ys = scene.points.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const yMin = lo >= 0 && lo < (hi - lo) * 0.6 ? 0 : lo - (hi - lo) * 0.1;
  const yMax = hi + (hi - lo || Math.abs(hi) || 1) * 0.1;
  const yt = ticks(yMin, yMax, 4).filter((v) => v >= yMin && v <= yMax);
  const f = chartFrame(Math.min(...xs), Math.max(...xs), yt[0] ?? yMin, Math.max(yMax, yt[yt.length - 1] ?? yMax));
  const xt = scene.points.length <= 8 ? xs : ticks(Math.min(...xs), Math.max(...xs), 6);
  const d = scene.points.map((p, i) => `${i ? "L" : "M"}${f.X(p.x).toFixed(1)},${f.Y(p.y).toFixed(1)}`).join(" ");
  return (
    <svg className="cv-svg" width={BODY_W} height={BODY_H} viewBox={`0 0 ${BODY_W} ${BODY_H}`} aria-hidden>
      <Axes f={f} xs={xt} ys={yt} xLabel={scene.x_label} yLabel={scene.y_label} />
      <path data-a="curve" d={d} className="cv-stroke-amber" />
      {scene.points.length <= 16 &&
        scene.points.map((p, i) => <circle key={i} data-a="dot" cx={f.X(p.x)} cy={f.Y(p.y)} r="7" fill={AMBER} stroke={INK} strokeWidth="3" />)}
    </svg>
  );
}

function Plot({ scene }: { scene: Extract<Scene, { template: "plot" }> }) {
  const c = compileExpression(scene.expression);
  if (!c.ok) return null;
  const { segments, yMin, yMax } = samplePlot(c.f, scene.x_min, scene.x_max);
  const f = chartFrame(scene.x_min, scene.x_max, yMin, yMax);
  const yt = ticks(yMin, yMax, 4).filter((v) => v >= yMin && v <= yMax);
  const xt = ticks(scene.x_min, scene.x_max, 6);
  return (
    <>
      <svg className="cv-svg" width={BODY_W} height={BODY_H} viewBox={`0 0 ${BODY_W} ${BODY_H}`} aria-hidden>
        <Axes f={f} xs={xt} ys={yt} />
        {yMin < 0 && yMax > 0 && <line className="cv-axis" x1={f.m.l} x2={f.m.l + f.w} y1={f.Y(0)} y2={f.Y(0)} />}
        {scene.x_min < 0 && scene.x_max > 0 && <line className="cv-axis" x1={f.X(0)} x2={f.X(0)} y1={f.m.t} y2={f.m.t + f.h} />}
        {segments.map((s, i) => (
          <path key={i} data-a="curve" d={s.map(([x, y], k) => `${k ? "L" : "M"}${f.X(x).toFixed(1)},${f.Y(Math.max(yMin, Math.min(yMax, y))).toFixed(1)}`).join(" ")} className="cv-stroke-amber" />
        ))}
        <text x={f.m.l + 12} y={f.m.t + 26} className="cv-serif" style={{ fill: PAPER, fontSize: 26, fontStyle: "italic", fontFamily: "var(--cv-serif)" }}>
          y = {c.text}
        </text>
      </svg>
      {scene.note && (
        <p data-a="note" className="cv-muted" style={{ position: "absolute", right: 30, top: 8, margin: 0, fontSize: 22, maxWidth: 520, textAlign: "right" }}>
          {scene.note}
        </p>
      )}
    </>
  );
}

/* ----------------------------------------------------------- the frame */

export function SceneView({ scene }: { scene: Scene }) {
  return (
    <div className={`cv-scene cv-t-${scene.template}`} data-scene>
      <Body scene={scene} />
    </div>
  );
}

export function Caption({ line }: { line: Line | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) fitOne(ref.current);
  }, [line?.text]);
  return (
    <div ref={ref} className="cv-caption" data-caption data-fit>
      {line && <span className={`cv-dot cv-dot-${line.speaker}`} aria-hidden />}
      <span>{line?.text ?? ""}</span>
    </div>
  );
}

// The 1280×720 stage, scaled to its container's width.
export function Stage({ scale, children, fonts }: { scale: number; children?: ReactNode; fonts?: React.CSSProperties }) {
  return (
    <div style={{ width: W * scale, height: H * scale, position: "relative", overflow: "hidden" }}>
      <style>{STAGE_CSS}</style>
      <div className="cv-stage" style={{ transform: `scale(${scale})`, transformOrigin: "0 0", ...STAGE_FONTS, ...fonts }}>
        {children}
      </div>
    </div>
  );
}

// The app's own fonts: Next's variables on the web, Fontsource on the desktop.
export const STAGE_FONTS = {
  "--cv-sans": 'var(--font-geist-sans, "Geist Variable"), "Geist", system-ui, sans-serif',
  "--cv-serif": 'var(--font-newsreader, "Newsreader Variable"), "Newsreader", Georgia, serif',
  "--cv-mono": 'var(--font-geist-mono, "Geist Mono Variable"), "Geist Mono", ui-monospace, monospace',
} as React.CSSProperties;

// A scene placed on the stage: fitted, then given its timeline.
export function SceneHost({ scene, time, exit = false, onTimeline }: { scene: Scene; time: SceneTime; exit?: boolean; onTimeline: (tl: gsap.core.Timeline, root: HTMLElement) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current!.firstElementChild as HTMLElement;
    fitText(root);
    const tl = animateScene(root, scene, time, { exit });
    onTimeline(tl, root);
    return () => {
      tl.kill();
    };
    // A scene is built once; the parent keys it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} style={{ display: "contents" }}>
      <SceneView scene={scene} />
    </div>
  );
}

/* ------------------------------------------------------------- motion */

const length = (el: Element) => {
  try {
    return (el as SVGGeometryElement).getTotalLength();
  } catch {
    return 1000;
  }
};

// The scene's timeline: paused, exactly time.duration long, safe to seek.
export function animateScene(root: HTMLElement, scene: Scene, time: SceneTime, opts: { exit?: boolean } = {}): gsap.core.Timeline {
  const q = (sel: string) => [...root.querySelectorAll<HTMLElement>(`[data-a="${sel}"]`)];
  const tl = gsap.timeline({ paused: true, defaults: { ease: "expo.out", duration: 0.8 } });
  const at = (k: number, n: number) => beat(k, n, time);
  const rise = (els: Element[], t: number, y = 22) => els.length && tl.fromTo(els, { y, autoAlpha: 0 }, { y: 0, autoAlpha: 1 }, t);
  const draw = (els: Element[], t: number, duration = 0.9) =>
    els.forEach((el, i) => {
      const len = length(el);
      tl.fromTo(el, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration, ease: "power2.inOut" }, t + i * 0.001);
    });
  const grow = (els: Element[], t: number, axis: "x" | "y" = "x", duration = 0.9) =>
    els.length && tl.fromTo(els, axis === "x" ? { scaleX: 0 } : { scaleY: 0 }, { ...(axis === "x" ? { scaleX: 1 } : { scaleY: 1 }), duration, ease: "power3.out" }, t);
  const count = (el: HTMLElement, value: number, unit: string, t: number, duration = 1.4) => {
    const o = { v: 0 };
    tl.fromTo(o, { v: 0 }, { v: value, duration, ease: "power2.out", onUpdate: () => void (el.textContent = fmt(o.v) + unit) }, t);
  };

  tl.fromTo(root, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, ease: "none" }, 0);
  rise(q("h"), 0.08, 16);

  switch (scene.template) {
    case "title":
      rise(q("title"), 0.1, 30);
      grow(q("bar"), 0.55);
      rise(q("sub"), 0.85, 14);
      break;
    case "points":
    case "recap": {
      const items = q("item");
      items.forEach((el, i) => rise([el], at(i, items.length)));
      q("check").forEach((el, i) => draw([el], at(i, items.length) + 0.15, 0.5));
      break;
    }
    case "definition":
      rise(q("label"), 0.1, 10);
      rise(q("term"), 0.2, 26);
      rise(q("meaning"), at(1, 3));
      rise(q("example"), at(2, 3));
      break;
    case "equation": {
      tl.fromTo(q("formula"), { clipPath: "inset(0 100% 0 0)", autoAlpha: 1 }, { clipPath: "inset(0 0% 0 0)", duration: 1.3, ease: "power2.inOut" }, 0.3);
      const parts = q("part");
      parts.forEach((el, i) => rise([el], at(i + 1, parts.length + 1), 14));
      break;
    }
    case "steps": {
      const items = q("item");
      items.forEach((el, i) => rise([el], at(i, items.length)));
      q("arrow").forEach((el, i) => tl.fromTo(el, { autoAlpha: 0, x: -10 }, { autoAlpha: 1, x: 0, duration: 0.5 }, at(i, items.length) + 0.35));
      grow(q("rail"), 0.2, "y", Math.max(1, time.duration * 0.6));
      break;
    }
    case "compare": {
      grow(q("divider"), 0.15, "y", 0.8);
      rise(q("label"), 0.25, 12);
      const l = q("left");
      const r = q("right");
      const order: Element[] = [];
      for (let i = 0; i < Math.max(l.length, r.length); i++) {
        if (l[i]) order.push(l[i]);
        if (r[i]) order.push(r[i]);
      }
      order.forEach((el, i) => rise([el], at(i + 1, order.length + 1), 14));
      break;
    }
    case "bars": {
      const bars = q("bar");
      const values = q("value");
      bars.forEach((el, i) => {
        grow([el], at(i, bars.length), "x", 1);
        const v = values[i];
        if (v) {
          tl.fromTo(v, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, at(i, bars.length));
          count(v, Number(v.dataset.value), v.dataset.unit ?? "", at(i, bars.length), 1);
        }
      });
      break;
    }
    case "line":
    case "plot": {
      tl.fromTo(q("axes"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 0.15);
      const curves = q("curve");
      const span = Math.max(1.4, Math.min(4, time.duration * 0.45));
      curves.forEach((el, i) => draw([el], 0.5 + (i * span) / curves.length, span / curves.length));
      const dots = q("dot");
      dots.forEach((el, i) => tl.fromTo(el, { scale: 0, transformOrigin: "center", transformBox: "fill-box" }, { scale: 1, duration: 0.4, ease: "back.out(2)" }, 0.5 + (span * i) / Math.max(1, dots.length - 1)));
      rise(q("note"), 0.6 + span, 10);
      break;
    }
    case "timeline": {
      grow(q("axis"), 0.15, "x", 1.2);
      const items = q("item");
      items.forEach((el, i) => rise([el], at(i, items.length), 14));
      break;
    }
    case "cycle": {
      const items = q("item");
      const arcs = q("arc");
      items.forEach((el, i) => {
        tl.fromTo(el, { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 0.6 }, at(i, items.length));
        if (arcs[i]) draw([arcs[i]], at(i, items.length) + 0.3, 0.7);
      });
      break;
    }
    case "map": {
      tl.fromTo(q("center"), { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 0.7 }, 0.15);
      const spokes = q("spoke");
      const items = q("item");
      items.forEach((el, i) => {
        if (spokes[i]) draw([spokes[i]], at(i, items.length), 0.6);
        tl.fromTo(el, { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 0.6 }, at(i, items.length) + 0.3);
      });
      break;
    }
    case "number": {
      const el = q("count")[0];
      if (el) count(el, Number(el.dataset.value), "", 0.3, 1.8);
      rise(q("label"), 1.1, 14);
      break;
    }
    case "quote":
      tl.fromTo(q("mark"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 0.1);
      rise(q("text"), 0.3, 20);
      rise(q("by"), 1.2, 10);
      break;
    case "code": {
      const lines = q("code");
      tl.fromTo(lines, { autoAlpha: 0, x: -8 }, { autoAlpha: 1, x: 0, duration: 0.4, stagger: Math.min(0.12, 1.4 / lines.length) }, 0.3);
      const focus = q("focus");
      focus.forEach((el, i) => grow([el], at(i + 1, focus.length + 1), "x", 0.6));
      break;
    }
    case "html": {
      const steps = [...root.querySelectorAll<HTMLElement>("[data-step]")];
      const order = [...new Set(steps.map((e) => Number(e.getAttribute("data-step")) || 0))].sort((a, b) => a - b);
      order.forEach((s, i) => {
        const els = steps.filter((e) => (Number(e.getAttribute("data-step")) || 0) === s);
        tl.fromTo(els, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ease: "power2.out" }, at(i, order.length));
      });
      break;
    }
  }

  if (opts.exit) tl.to(root, { autoAlpha: 0, duration: 0.3, ease: "power1.in" }, Math.max(0.5, time.duration - 0.3));
  tl.set({}, {}, time.duration);
  return tl;
}

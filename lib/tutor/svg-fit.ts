// The tutor draws a picture by hand (```svg) when position is the point, and
// it guesses sizes it can't see: labels run past their boxes, sit on top of
// each other, or leave the canvas. Before the drawing is shown, the browser
// lays it out once, out of sight, and tidies it:
// - a label inside a box shrinks (not below 10px) or wraps onto two lines
//   until it fits, and only if neither works does the box grow around it;
// - a label on its own (on an arrow, beside a box) moves to the nearest spot
//   clear of boxes and other labels, and gets a halo in the background's
//   colour so a line running under it doesn't strike through the words;
// - the canvas grows to hold everything.
// Browser only (it measures real text); elsewhere the drawing is unchanged.

type Box = { x: number; y: number; w: number; h: number };

const MIN_FONT = 10;
const SHAPES = "rect, circle, ellipse, polygon";
const HIDDEN = "defs, marker, symbol, pattern, clipPath, mask, linearGradient, radialGradient";
const CARD = "#f7f6f2"; // the diagram card behind a drawing with no background of its own

const cache = new Map<string, string>();

/** The drawing, tidied (cached per drawing). Unchanged outside a browser or on any error. */
export function fitSvg(svg: string): string {
  const hit = cache.get(svg);
  if (hit !== undefined) return hit;
  let out = svg;
  if (typeof document !== "undefined" && typeof DOMParser !== "undefined") {
    try {
      out = tidy(svg) ?? svg;
    } catch {
      out = svg;
    }
  }
  if (cache.size > 80) cache.delete(cache.keys().next().value!);
  cache.set(svg, out);
  return out;
}

const area = (b: Box) => b.w * b.h;
const overlaps = (a: Box, b: Box, gap = 1) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const contains = (b: Box, x: number, y: number) => x >= b.x - 1 && x <= b.x + b.w + 1 && y >= b.y - 1 && y <= b.y + b.h + 1;
const num = (v: string | null) => (v !== null && /^\s*-?[\d.]+(?:px)?\s*$/.test(v) ? parseFloat(v) : null);

function tidy(source: string): string | null {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = parsed.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg" || parsed.querySelector("parsererror")) return null;
  const vb = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) return null;
  const view: Box = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };

  // Laid out at one pixel per unit, inside a shadow root so the drawing's own
  // <style> can't reach the page. The sanitizer already removed scripts and
  // handlers; nothing here is shown or kept.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });
  const live = document.importNode(svg, true) as unknown as SVGSVGElement;
  live.querySelectorAll("script").forEach((s) => s.remove());
  live.setAttribute("width", String(view.w));
  live.setAttribute("height", String(view.h));
  live.style.display = "block";
  root.appendChild(live);
  document.body.appendChild(host);
  try {
    const changed = arrange(live, view);
    if (!changed) return null;
    const original = svg;
    // Keep the drawing's own width and height attributes (or their absence).
    for (const name of ["width", "height"]) {
      const v = original.getAttribute(name);
      if (v === null) live.removeAttribute(name);
      else live.setAttribute(name, v);
    }
    live.style.removeProperty("display");
    if (!live.getAttribute("style")) live.removeAttribute("style");
    return new XMLSerializer().serializeToString(live);
  } finally {
    host.remove();
  }
}

function arrange(svg: SVGSVGElement, view: Box): boolean {
  const origin = svg.getBoundingClientRect();
  const boxOf = (el: Element): Box => {
    const r = el.getBoundingClientRect();
    return { x: r.left - origin.left + view.x, y: r.top - origin.top + view.y, w: r.width, h: r.height };
  };
  const visible = (el: Element) => !el.closest(HIDDEN);
  let changed = false;

  // Boxes: shapes with some size. One covering most of the canvas is the
  // background, not a box; its fill is the halo colour.
  let halo = CARD;
  const shapes: { el: SVGGraphicsElement; box: Box }[] = [];
  for (const el of Array.from(svg.querySelectorAll<SVGGraphicsElement>(SHAPES))) {
    if (!visible(el)) continue;
    const box = boxOf(el);
    if (box.w < 4 || box.h < 4) continue;
    if (area(box) >= area(view) * 0.5) {
      const fill = getComputedStyle(el).fill;
      if (area(box) >= area(view) * 0.9 && fill && fill !== "none" && !fill.startsWith("url")) halo = fill;
      continue;
    }
    shapes.push({ el, box });
  }

  const texts = Array.from(svg.querySelectorAll<SVGTextElement>("text")).filter((t) => visible(t) && (t.textContent ?? "").trim());
  const anchorOf = (t: SVGTextElement, b: Box) => {
    const a = getComputedStyle(t).textAnchor;
    return { x: a === "middle" ? b.x + b.w / 2 : a === "end" ? b.x + b.w : b.x, y: b.y + b.h / 2, kind: a };
  };
  // The smallest box the label's anchor sits in.
  const containerOf = (t: SVGTextElement) => {
    const b = boxOf(t);
    const p = anchorOf(t, b);
    let best: { el: SVGGraphicsElement; box: Box } | null = null;
    for (const s of shapes) if (contains(s.box, p.x, p.y) && (!best || area(s.box) < area(best.box))) best = s;
    return best;
  };

  /* ---- labels inside boxes: fit them ---- */
  const inside = new Map<SVGTextElement, { el: SVGGraphicsElement; box: Box }>();
  for (const t of texts) {
    const c = containerOf(t);
    if (c) inside.set(t, c);
  }
  for (const [t, c] of inside) {
    const room = () => {
      const b = boxOf(t);
      const p = anchorOf(t, b);
      const pad = Math.min(8, c.box.w * 0.08);
      const left = p.x - c.box.x - pad;
      const right = c.box.x + c.box.w - pad - p.x;
      const space = p.kind === "middle" ? 2 * Math.min(left, right) : p.kind === "end" ? left : right;
      return { width: b.w, space: Math.max(1, space) };
    };
    let { width, space } = room();
    if (width <= space + 0.5) continue;
    changed = true;
    const size = parseFloat(getComputedStyle(t).fontSize) || 14;
    const shrunk = Math.floor(((size * space) / width) * 10) / 10;
    if (shrunk >= MIN_FONT) {
      setFontSize(t, shrunk, size);
      continue;
    }
    // Two lines, if it has words to split and the box is tall enough for them
    // (alone in it: other labels in the same box need their own rows).
    const alone = Array.from(inside).filter(([, other]) => other === c).length === 1;
    if (alone && wrap(t, c.box, boxOf, size)) {
      ({ width, space } = room());
      if (width <= space + 0.5) continue;
    }
    setFontSize(t, MIN_FONT, size);
    ({ width, space } = room());
    if (width > space + 0.5) grow(c, width - space + 2, boxOf);
  }

  /* ---- labels on their own: move them clear ---- */
  const free = texts.filter((t) => !inside.has(t));
  for (const t of free) {
    const b = boxOf(t);
    const obstacles = [...shapes.map((s) => s.box), ...texts.filter((o) => o !== t).map(boxOf)];
    const hits = (x: Box) => obstacles.filter((o) => overlaps(x, o)).length;
    if (!t.getAttribute("stroke") && !t.style.stroke) {
      t.setAttribute("paint-order", "stroke");
      t.setAttribute("stroke", halo);
      t.setAttribute("stroke-width", "3");
      t.setAttribute("stroke-linejoin", "round");
      changed = true;
    }
    if (!hits(b)) continue;
    const step = b.h + 2;
    const tries: [number, number][] = [];
    for (const d of [1, 2, 3]) tries.push([0, -d * step], [0, d * step]);
    for (const o of obstacles.filter((o) => overlaps(b, o))) {
      tries.push([0, o.y - 2 - (b.y + b.h)], [0, o.y + o.h + 2 - b.y], [o.x - 2 - (b.x + b.w), 0], [o.x + o.w + 2 - b.x, 0]);
    }
    let best: { dx: number; dy: number; score: number } | null = null;
    for (const [dx, dy] of tries) {
      const moved = { ...b, x: b.x + dx, y: b.y + dy };
      const out = moved.x < view.x || moved.y < view.y || moved.x + moved.w > view.x + view.w || moved.y + moved.h > view.y + view.h;
      const score = hits(moved) * 10_000 + (out ? 500 : 0) + Math.abs(dx) + Math.abs(dy) * 1.2;
      if (!best || score < best.score) best = { dx, dy, score };
    }
    if (best && best.score < hits(b) * 10_000) {
      const prior = t.getAttribute("transform");
      t.setAttribute("transform", `translate(${round(best.dx)} ${round(best.dy)})${prior ? ` ${prior}` : ""}`);
      changed = true;
    }
  }

  /* ---- the canvas holds everything ---- */
  let x0 = view.x;
  let y0 = view.y;
  let x1 = view.x + view.w;
  let y1 = view.y + view.h;
  for (const el of [...texts, ...shapes.map((s) => s.el)]) {
    const b = boxOf(el);
    if (!b.w || !b.h) continue;
    x0 = Math.min(x0, b.x - 6);
    y0 = Math.min(y0, b.y - 6);
    x1 = Math.max(x1, b.x + b.w + 6);
    y1 = Math.max(y1, b.y + b.h + 6);
  }
  if (x0 < view.x - 0.5 || y0 < view.y - 0.5 || x1 > view.x + view.w + 0.5 || y1 > view.y + view.h + 0.5) {
    svg.setAttribute("viewBox", [x0, y0, x1 - x0, y1 - y0].map((n) => round(n)).join(" "));
    changed = true;
  }
  return changed;
}

const round = (n: number) => Math.round(n * 10) / 10;

// A smaller font for the label, and for its own parts that set a size.
function setFontSize(t: SVGTextElement, size: number, from: number) {
  t.setAttribute("font-size", String(size));
  t.style.removeProperty("font-size");
  for (const part of Array.from(t.querySelectorAll<SVGElement>("tspan[font-size], tspan[style*='font-size']"))) {
    const own = parseFloat(getComputedStyle(part).fontSize) || from;
    part.setAttribute("font-size", String(round((own * size) / from)));
    part.style.removeProperty("font-size");
  }
}

// One plain label onto two lines, split at the space nearest its middle, at
// the largest size (up to its own) where both lines fit the box. Undone when
// the lines don't fit the box's height.
function wrap(t: SVGTextElement, box: Box, boxOf: (el: Element) => Box, size: number): boolean {
  const text = (t.textContent ?? "").trim();
  if (t.children.length || !/\s/.test(text)) return false;
  const x = t.getAttribute("x") ?? "0";
  const y = num(t.getAttribute("y"));
  if (/[\s,]/.test(x.trim()) || y === null) return false;
  const spaces = [...text.matchAll(/\s+/g)].map((m) => m.index);
  const cut = spaces.reduce((a, b) => (Math.abs(b - text.length / 2) < Math.abs(a - text.length / 2) ? b : a));
  const lines = [text.slice(0, cut).trim(), text.slice(cut).trim()];
  const before = { content: t.textContent, size: t.getAttribute("font-size"), style: t.getAttribute("style") };
  t.textContent = "";
  lines.forEach((line, i) => {
    const span = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    span.setAttribute("x", x);
    span.setAttribute("dy", i === 0 ? "-0.55em" : "1.15em");
    span.textContent = line;
    t.appendChild(span);
  });
  const pad = Math.min(8, box.w * 0.08);
  const width = boxOf(t).w;
  const fits = Math.max(MIN_FONT, Math.min(size, Math.floor(((size * (box.w - 2 * pad)) / width) * 10) / 10));
  t.setAttribute("font-size", String(fits));
  t.style.removeProperty("font-size");
  const b = boxOf(t);
  if (b.h <= box.h - 4 && b.y >= box.y && b.y + b.h <= box.y + box.h) return true;
  t.textContent = before.content;
  if (before.size === null) t.removeAttribute("font-size");
  else t.setAttribute("font-size", before.size);
  if (before.style === null) t.removeAttribute("style");
  else t.setAttribute("style", before.style);
  return false;
}

// Widen a box around its label: a rect on both sides, a circle or ellipse
// outward. In the shape's own units (it may sit in a scaled group).
function grow(c: { el: SVGGraphicsElement; box: Box }, by: number, boxOf: (el: Element) => Box) {
  const el = c.el;
  const tag = el.tagName.toLowerCase();
  const before = boxOf(el);
  if (tag === "rect") {
    const w = num(el.getAttribute("width"));
    const x = num(el.getAttribute("x")) ?? 0;
    if (w === null || w <= 0) return;
    const scale = before.w / w || 1;
    const more = by / scale;
    el.setAttribute("x", String(round(x - more / 2)));
    el.setAttribute("width", String(round(w + more)));
  } else if (tag === "ellipse" || tag === "circle") {
    const attr = tag === "circle" ? "r" : "rx";
    const r = num(el.getAttribute(attr));
    if (r === null || r <= 0) return;
    const scale = before.w / (2 * r) || 1;
    el.setAttribute(attr, String(round(r + by / scale / 2)));
  } else return;
  c.box = boxOf(el);
}

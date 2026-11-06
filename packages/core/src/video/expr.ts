// A function of x, as a model writes it ("x^2 - 2x + 1", "y = sin(2x)",
// "e^(-x²)"), turned into something that can be plotted. Parsed into a tree
// and evaluated by hand: model text is never run as code.

type Node = { k: "num"; v: number } | { k: "x" } | { k: "neg"; a: Node } | { k: "bin"; op: string; a: Node; b: Node } | { k: "fn"; f: (n: number) => number; a: Node };

const FUNCS: Record<string, (n: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
  sigmoid: (n) => 1 / (1 + Math.exp(-n)),
  relu: (n) => Math.max(0, n),
};
const CONSTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E, tau: Math.PI * 2 };
// Own names only: "constructor" and friends are not functions of x.
const isFn = (k: string) => Object.hasOwn(FUNCS, k);
const isConst = (k: string) => Object.hasOwn(CONSTS, k);

const SUPERSCRIPT: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-" };

// The usual ways a model writes the same thing, made one way.
export function tidyExpression(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^\$+|\$+$/g, "");
  s = s.replace(/^\s*(?:y|f\s*\(\s*x\s*\)|g\s*\(\s*x\s*\))\s*=\s*/i, "");
  s = s.replace(/\\left|\\right|\\,|\\!|\\;/g, "");
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "(($1)/($2))");
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)");
  s = s.replace(/\\(sin|cos|tan|ln|log|exp|pi|cdot|times)/g, (_, w: string) => (w === "cdot" || w === "times" ? "*" : w));
  s = s.replace(/[{}]/g, (c) => (c === "{" ? "(" : ")"));
  s = s.replace(/\*\*/g, "^").replace(/[·×]/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => `^(${[...m].map((c) => SUPERSCRIPT[c]).join("")})`);
  s = s.replace(/√\s*\(/g, "sqrt(").replace(/√\s*([\w.]+)/g, "sqrt($1)");
  s = s.replace(/\|([^|]+)\|/g, "abs($1)");
  return s.replace(/\s+/g, " ").trim();
}

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") {
      i++;
    } else if (/[\d.]/.test(c)) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\.?/i.exec(s.slice(i))!;
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-zπ]/i.test(c)) {
      const m = /^[a-zπ][a-z0-9]*/i.exec(s.slice(i))!;
      out.push({ t: "id", v: m[0].toLowerCase() });
      i += m[0].length;
    } else if ("+-*/^()".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      throw new Error(`Unexpected "${c}"`);
    }
  }
  return out;
}

// Implicit multiplication: 2x, 3(x+1), (x+1)(x-1), x sin(x), 2pi.
function implicit(toks: Tok[]): Tok[] {
  const res: Tok[] = [];
  for (const tok of toks) {
    const prev = res[res.length - 1];
    const endsValue = prev && (prev.t === "num" || (prev.t === "id" && !isFn(prev.v)) || (prev.t === "op" && prev.v === ")"));
    const startsValue = tok.t === "num" || tok.t === "id" || (tok.t === "op" && tok.v === "(");
    if (endsValue && startsValue) res.push({ t: "op", v: "*" });
    res.push(tok);
  }
  return res;
}

// Splits identifiers a model glued together ("xsin", "2pix") into known names.
function splitIds(toks: Tok[]): Tok[] {
  const known = [...Object.keys(FUNCS), ...Object.keys(CONSTS), "x"].sort((a, b) => b.length - a.length);
  const out: Tok[] = [];
  for (const tok of toks) {
    if (tok.t !== "id" || isFn(tok.v) || isConst(tok.v) || tok.v === "x") {
      out.push(tok);
      continue;
    }
    let rest = tok.v;
    const parts: string[] = [];
    while (rest) {
      const hit = known.find((k) => rest.startsWith(k));
      if (!hit) throw new Error(`Unknown name "${tok.v}"`);
      parts.push(hit);
      rest = rest.slice(hit.length);
    }
    parts.forEach((p, i) => {
      if (i) out.push({ t: "op", v: "*" });
      out.push({ t: "id", v: p });
    });
  }
  return out;
}

function parse(toks: Tok[]): Node {
  let i = 0;
  const peek = () => toks[i];
  const eat = (v: string) => {
    const t = toks[i];
    if (t?.t === "op" && t.v === v) {
      i++;
      return true;
    }
    return false;
  };
  const expr = (): Node => {
    let a = term();
    for (;;) {
      if (eat("+")) a = { k: "bin", op: "+", a, b: term() };
      else if (eat("-")) a = { k: "bin", op: "-", a, b: term() };
      else return a;
    }
  };
  const term = (): Node => {
    let a = unary();
    for (;;) {
      if (eat("*")) a = { k: "bin", op: "*", a, b: unary() };
      else if (eat("/")) a = { k: "bin", op: "/", a, b: unary() };
      else return a;
    }
  };
  const unary = (): Node => {
    if (eat("-")) return { k: "neg", a: unary() };
    if (eat("+")) return unary();
    return power();
  };
  const power = (): Node => {
    const base = atom();
    // Right-associative, and -x^2 means -(x^2).
    if (eat("^")) return { k: "bin", op: "^", a: base, b: unary() };
    return base;
  };
  const atom = (): Node => {
    const t = peek();
    if (!t) throw new Error("The expression ends too soon");
    if (t.t === "num") {
      i++;
      return { k: "num", v: t.v };
    }
    if (t.t === "id") {
      i++;
      if (t.v === "x") return { k: "x" };
      if (isConst(t.v)) return { k: "num", v: CONSTS[t.v] };
      if (isFn(t.v)) {
        // sin x, sin(x), sin^2(x)
        if (eat("^")) {
          const p = atom();
          eat("*"); // "sin^2(x)" picked up an implicit multiplication
          const arg = atom();
          return { k: "bin", op: "^", a: { k: "fn", f: FUNCS[t.v], a: arg }, b: p };
        }
        return { k: "fn", f: FUNCS[t.v], a: power() };
      }
      throw new Error(`Unknown name "${t.v}"`);
    }
    if (eat("(")) {
      const inner = expr();
      if (!eat(")")) throw new Error("A bracket isn't closed");
      return inner;
    }
    throw new Error(`Unexpected "${t.v}"`);
  };
  const tree = expr();
  if (i < toks.length) throw new Error(`Unexpected "${(toks[i] as { v: string | number }).v}"`);
  return tree;
}

function run(n: Node, x: number): number {
  switch (n.k) {
    case "num":
      return n.v;
    case "x":
      return x;
    case "neg":
      return -run(n.a, x);
    case "fn":
      return n.f(run(n.a, x));
    case "bin": {
      const a = run(n.a, x);
      const b = run(n.b, x);
      return n.op === "+" ? a + b : n.op === "-" ? a - b : n.op === "*" ? a * b : n.op === "/" ? a / b : a ** b;
    }
  }
}

export type Compiled = { ok: true; f: (x: number) => number; text: string } | { ok: false; error: string };

export function compileExpression(raw: string): Compiled {
  const text = tidyExpression(raw);
  if (!text || text.length > 200) return { ok: false, error: "empty or too long" };
  try {
    const tree = parse(implicit(splitIds(tokenize(text))));
    return { ok: true, f: (x) => run(tree, x), text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Points to draw, with the y range cropped so an asymptote (1/x, tan x)
// doesn't flatten the rest of the curve. Breaks the line where it jumps.
export function samplePlot(f: (x: number) => number, xMin: number, xMax: number, n = 240): { segments: XYs[]; yMin: number; yMax: number; finite: number } {
  const xs = Array.from({ length: n + 1 }, (_, i) => xMin + ((xMax - xMin) * i) / n);
  const ys = xs.map((x) => {
    const y = f(x);
    return Number.isFinite(y) ? y : NaN;
  });
  const good = ys.filter((y) => !Number.isNaN(y)).sort((a, b) => a - b);
  if (!good.length) return { segments: [], yMin: -1, yMax: 1, finite: 0 };
  const q = (p: number) => good[Math.min(good.length - 1, Math.max(0, Math.round(p * (good.length - 1))))];
  let yMin = q(0.03);
  let yMax = q(0.97);
  if (good[0] >= q(0.03) - Math.abs(q(0.03)) * 0.25) yMin = good[0];
  if (good[good.length - 1] <= q(0.97) + Math.abs(q(0.97)) * 0.25) yMax = good[good.length - 1];
  if (yMax - yMin < 1e-9) {
    yMin -= 1;
    yMax += 1;
  }
  const pad = (yMax - yMin) * 0.08;
  yMin -= pad;
  yMax += pad;
  const segments: XYs[] = [];
  let cur: XYs = [];
  const span = yMax - yMin;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    const prev = cur[cur.length - 1];
    if (Number.isNaN(y) || y < yMin - span || y > yMax + span || (prev && Math.abs(y - prev[1]) > span * 0.9)) {
      if (cur.length > 1) segments.push(cur);
      cur = Number.isNaN(y) || y < yMin - span || y > yMax + span ? [] : [[xs[i], y]];
      continue;
    }
    cur.push([xs[i], y]);
  }
  if (cur.length > 1) segments.push(cur);
  return { segments, yMin, yMax, finite: good.length };
}

type XYs = [number, number][];

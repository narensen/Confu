import { compileExpression, samplePlot, tidyExpression } from "./expr";
import { LIMITS, type Line, type Scene, type SceneBody, type Speaker, type TemplateId, type VideoScript } from "./script";

// What a model wrote, turned into a storyboard that renders. Small models
// get the JSON slightly wrong, name fields their own way, write numbers as
// "45%", slip into LaTeX, invent statistics, or stop mid-reply. Each fix is
// noted in `issues` (the test runs count them to improve the guide), and a
// scene that can't be saved becomes a plain list of its key points rather
// than a broken picture.

export type Repaired = { script: VideoScript | null; issues: string[] };
type Obj = Record<string, unknown>;

/* ------------------------------------------------------------------ JSON */

export function extractJson(raw: string, issues: string[]): unknown {
  let s = raw;
  if (/<think>[\s\S]*?<\/think>/i.test(s)) {
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
    issues.push("json:think-block");
  }
  const fence = /```(?:json|javascript|js)?\s*([\s\S]*?)```/i.exec(s);
  if (fence && fence[1].includes("{")) {
    s = fence[1];
    issues.push("json:code-fence");
  }
  const start = s.search(/[[{]/);
  if (start < 0) {
    issues.push("json:none");
    return null;
  }
  if (start > 0 && s.slice(0, start).trim()) issues.push("json:text-before");
  s = s.slice(start);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  const strict = end > 0 ? s.slice(0, end + 1) : s;
  try {
    return JSON.parse(strict);
  } catch {}
  const fixed = lenient(s, issues);
  try {
    return JSON.parse(fixed);
  } catch {}
  try {
    const many = JSON.parse(`[${fixed}]`);
    issues.push("json:several-objects");
    return many;
  } catch {}
  issues.push("json:unparseable");
  return null;
}

// A forgiving pass over almost-JSON: comments, trailing or missing commas,
// single or curly quotes, unquoted keys and words, raw newlines and stray
// quotes inside strings, Python literals, and a reply cut off midway.
export function lenient(src: string, issues: string[] = []): string {
  const note = (what: string) => issues.includes(`json:${what}`) || issues.push(`json:${what}`);
  let out = "";
  const stack: ("{" | "[")[] = [];
  let afterValue = false;
  let i = 0;
  const nextSignificant = (from: number) => {
    let j = from;
    while (j < src.length && /\s/.test(src[j])) j++;
    return src[j] ?? "";
  };
  const comma = () => {
    if (afterValue) {
      out += ",";
      note("missing-comma");
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      note("comment");
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      i = close < 0 ? src.length : close + 2;
      note("comment");
      continue;
    }
    if (c === '"' || c === "'" || c === "“" || c === "‘") {
      if (c !== '"') note("odd-quotes");
      comma();
      const closers = c === '"' ? ['"'] : c === "'" ? ["'"] : c === "“" ? ["”", '"'] : ["’", "'"];
      let j = i + 1;
      let str = "";
      let closed = false;
      while (j < src.length) {
        const d = src[j];
        if (d === "\\") {
          str += d + (src[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (closers.includes(d)) {
          // A real end is followed by , : } ] or the end; otherwise it's a quote inside the text.
          const after = nextSignificant(j + 1);
          if (!after || ',:}]"{['.includes(after)) {
            closed = true;
            break;
          }
          str += d === '"' ? '\\"' : d;
          note("inner-quote");
          j++;
          continue;
        }
        if (d === "\n") str += "\\n";
        else if (d === "\r") str += "";
        else if (d === "\t") str += "\\t";
        else if (d === '"') str += '\\"';
        else str += d;
        j++;
      }
      if (!closed) note("truncated");
      out += `"${str}"`;
      afterValue = true;
      i = closed ? j + 1 : src.length;
      continue;
    }
    if (c === "{" || c === "[") {
      comma();
      stack.push(c);
      out += c;
      afterValue = false;
      i++;
      continue;
    }
    if (c === "}" || c === "]") {
      if (/,\s*$/.test(out)) {
        out = out.replace(/,\s*$/, "");
        note("trailing-comma");
      }
      const top = stack.pop();
      if (!top) {
        i++;
        continue;
      }
      out += top === "{" ? "}" : "]";
      if ((top === "{") !== (c === "}")) note("mismatched-bracket");
      afterValue = true;
      i++;
      continue;
    }
    if (c === ",") {
      if (afterValue) out += ",";
      afterValue = false;
      i++;
      continue;
    }
    if (c === ":") {
      out += ":";
      afterValue = false;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      out += c;
      i++;
      continue;
    }
    // A bare number, literal, key or word.
    const num = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      comma();
      const rest = src.slice(i + num[0].length);
      const unit = /^\s*(%|[a-zA-Z]+\b)/.exec(rest);
      if (unit && !",}]".includes(nextSignificant(i + num[0].length))) {
        out += JSON.stringify(num[0] + unit[0]);
        i += num[0].length + unit[0].length;
        note("number-with-unit");
      } else {
        out += num[0];
        i += num[0].length;
      }
      afterValue = true;
      continue;
    }
    const word = /^[^\s,:{}[\]"]+/.exec(src.slice(i));
    if (!word) {
      i++;
      continue;
    }
    const w = word[0];
    const lower = w.toLowerCase();
    const isKey = nextSignificant(i + w.length) === ":" && stack[stack.length - 1] === "{";
    comma();
    if (isKey) {
      out += JSON.stringify(w.replace(/^['"]|['"]$/g, ""));
      note("unquoted-key");
      i += w.length;
    } else if (["true", "false", "null"].includes(lower)) {
      out += lower;
      if (w !== lower) note("python-literal");
      i += w.length;
    } else if (lower === "none" || lower === "undefined" || lower === "nan") {
      out += "null";
      note("python-literal");
      i += w.length;
    } else {
      // An unquoted string value: up to the next , } ] or line end.
      const text = /^[^,}\]\n]+/.exec(src.slice(i))![0];
      out += JSON.stringify(text.trim());
      note("unquoted-text");
      i += text.length;
    }
    afterValue = true;
  }
  if (stack.length) {
    note("truncated");
    // Drop a dangling key or comma before closing what's open.
    out = out.replace(/,?\s*"[^"]*"\s*:\s*$/, "").replace(/,\s*$/, "");
    while (stack.length) out += stack.pop() === "{" ? "}" : "]";
  }
  return out;
}

/* ------------------------------------------------------------------ text */

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", theta: "θ", lambda: "λ", mu: "μ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", omega: "ω", eta: "η", kappa: "κ", nu: "ν", xi: "ξ", chi: "χ", psi: "ψ", zeta: "ζ",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Sigma: "Σ", Pi: "Π", Phi: "Φ", Omega: "Ω", Psi: "Ψ",
};
const SYMBOLS: Record<string, string> = {
  cdot: "·", times: "×", div: "÷", pm: "±", le: "≤", leq: "≤", ge: "≥", geq: "≥", neq: "≠", ne: "≠", approx: "≈", sim: "~", infty: "∞", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", iff: "⇔", in: "∈", notin: "∉", sum: "Σ", prod: "Π", int: "∫", partial: "∂", nabla: "∇", forall: "∀", exists: "∃", cup: "∪", cap: "∩", subset: "⊂", emptyset: "∅", propto: "∝", ldots: "…", cdots: "⋯", dots: "…", degree: "°", circ: "°", top: "ᵀ", mid: "|", quad: " ", qquad: " ",
};
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", T: "ᵀ", x: "ˣ", k: "ᵏ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", i: "ᵢ", j: "ⱼ", k: "ₖ", n: "ₙ", m: "ₘ", t: "ₜ", x: "ₓ", o: "ₒ", r: "ᵣ", s: "ₛ", p: "ₚ" };
const script = (s: string, map: Record<string, string>, mark: string) => ([...s].every((c) => map[c]) ? [...s].map((c) => map[c]).join("") : `${mark}${s.length > 1 ? `(${s})` : s}`);

// LaTeX a model slipped in, as plain text a viewer can read.
export function latexToText(s: string): string {
  if (!/[\\$^_]/.test(s)) return s;
  let t = s.replace(/\$\$?/g, "");
  for (let k = 0; k < 3; k++) {
    t = t.replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
    t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");
    t = t.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|boldsymbol|mathcal|hat|bar|vec|tilde)\s*\{([^{}]*)\}/g, "$1");
  }
  t = t.replace(/\^\{([^{}]*)\}/g, (_, x: string) => script(x, SUP, "^")).replace(/\^([0-9a-zA-Z+-])/g, (_, x: string) => script(x, SUP, "^"));
  t = t.replace(/_\{([^{}]*)\}/g, (_, x: string) => script(x, SUB, "_")).replace(/_([0-9a-z])/g, (_, x: string) => script(x, SUB, "_"));
  t = t.replace(/\\([A-Za-z]+)/g, (m, w: string) => GREEK[w] ?? SYMBOLS[w] ?? w);
  t = t.replace(/\\[,;!: ]/g, " ").replace(/[{}]/g, "");
  return t;
}

// One line of on-screen text: no Markdown, no LaTeX, one line, not too long.
export function cleanText(v: unknown, max: number, issues?: string[]): string {
  if (v == null) return "";
  let s = typeof v === "string" ? v : typeof v === "number" ? String(v) : typeof v === "object" ? firstText(v as Obj) : String(v);
  if (/\*\*|__|`|^#+\s/m.test(s)) issues?.push("text:markdown");
  s = s.replace(/\*\*|__|`/g, "").replace(/^#+\s*/gm, "").replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
  if (/[\\$]/.test(s)) issues?.push("text:latex");
  s = latexToText(s);
  s = s.replace(/\s+/g, " ").trim().replace(/^["'“]+|["'”]+$/g, "").trim();
  if (s.length > max) {
    issues?.push("text:too-long");
    const cut = s.slice(0, max - 1);
    s = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).replace(/[\s,;:–—-]+$/, "")}…`;
  }
  return s;
}

const TEXT_KEYS = ["text", "label", "name", "title", "point", "step", "stage", "content", "description", "value", "item", "idea", "event"];
function firstText(o: Obj): string {
  for (const k of TEXT_KEYS) if (typeof o[k] === "string" || typeof o[k] === "number") return String(o[k]);
  const s = Object.values(o).find((x) => typeof x === "string");
  return typeof s === "string" ? s : "";
}

// "45%", "1,200", "$3.5 billion", "~12" → a number.
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = /(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)\s*(k|thousand|m|million|mn|b|bn|billion|trillion)?\b/i.exec(v.replace(/[−–]/g, "-"));
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  const mult: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, mn: 1e6, b: 1e9, bn: 1e9, billion: 1e9, trillion: 1e12 };
  if (m[2]) n *= mult[m[2].toLowerCase()] ?? 1;
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------------------------------------------- fields */

const keyOf = (k: string) => k.trim().toLowerCase().replace(/[\s-]+/g, "_");
function normKeys(o: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) out[keyOf(k)] = v;
  return out;
}
const pick = (o: Obj, ...keys: string[]) => {
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
  return undefined;
};
const asObj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? normKeys(v as Obj) : null);

// A list of short texts, however it was written.
function textList(v: unknown, max: number, issues: string[]): string[] {
  let arr: unknown[] = [];
  if (Array.isArray(v)) arr = v;
  else if (typeof v === "string") {
    arr = v.split(/\n|;|\s•\s|(?:^|\s)\d+[.)]\s/).filter((x) => x.trim());
    if (arr.length > 1) issues.push("list:as-string");
  } else if (v && typeof v === "object") {
    arr = Object.entries(v as Obj).map(([k, x]) => (typeof x === "string" && x.length > k.length ? `${k}: ${x}` : k));
    issues.push("list:as-object");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const t = cleanText(x, LIMITS.item, issues);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  if (out.length > max) issues.push("list:too-many");
  return out.slice(0, max);
}

/* ------------------------------------------------------------- templates */

const TEMPLATE_ALIASES: Record<string, TemplateId> = {
  title: "title", intro: "title", title_card: "title", opening: "title", cover: "title", hook: "title", introduction: "title",
  points: "points", bullets: "points", bullet: "points", bullet_points: "points", list: "points", key_points: "points", keypoints: "points", text: "points", ideas: "points", facts: "points", explanation: "points",
  definition: "definition", define: "definition", term: "definition", concept: "definition", glossary: "definition",
  equation: "equation", formula: "equation", math: "equation", maths: "equation",
  steps: "steps", process: "steps", flow: "steps", flowchart: "steps", procedure: "steps", algorithm: "steps", how_to: "steps", pipeline: "steps",
  compare: "compare", comparison: "compare", versus: "compare", vs: "compare", contrast: "compare", pros_cons: "compare", table: "compare", two_columns: "compare",
  bars: "bars", bar: "bars", bar_chart: "bars", barchart: "bars", chart: "bars", histogram: "bars", column_chart: "bars",
  line: "line", line_chart: "line", linechart: "line", trend: "line", graph: "line", line_graph: "line", time_series: "line",
  plot: "plot", function: "plot", function_plot: "plot", curve: "plot", function_graph: "plot",
  timeline: "timeline", history: "timeline", chronology: "timeline", events: "timeline",
  cycle: "cycle", loop: "cycle", circular: "cycle", life_cycle: "cycle", feedback_loop: "cycle",
  map: "map", concept_map: "map", mind_map: "map", mindmap: "map", hub: "map", tree: "map", diagram: "map", network: "map", web: "map",
  number: "number", stat: "number", statistic: "number", big_number: "number", metric: "number", fact: "number",
  quote: "quote", quotation: "quote", takeaway: "quote", key_sentence: "quote", highlight: "quote",
  code: "code", snippet: "code", code_block: "code", program: "code",
  recap: "recap", summary: "recap", conclusion: "recap", takeaways: "recap", outro: "recap", review: "recap", remember: "recap",
  html: "html", svg: "html", custom: "html", drawing: "html", illustration: "html",
};

// Two parallel number lists (years + growth) are a line chart.
function numericSeries(o: Obj): { x: number; y: number }[] | null {
  const arrays = Object.entries(o).flatMap(([k, v]) => {
    if (!Array.isArray(v) || v.length < LIMITS.line.min) return [];
    const nums = v.map(toNumber);
    if (nums.some((n) => n == null)) return [];
    return [[k, nums as number[]] as const];
  });
  if (arrays.length < 2) return null;
  const x = arrays.find(([k]) => /year|time|^x$|step|^t$|period|when/.test(k)) ?? arrays[0];
  const y = arrays.find(([k]) => k !== x[0] && /growth|value|^y$|amount|result|total|number/.test(k)) ?? arrays.find(([k]) => k !== x[0]);
  if (!y) return null;
  const n = Math.min(x[1].length, y[1].length, LIMITS.line.max);
  if (n < LIMITS.line.min) return null;
  o.points = Array.from({ length: n }, (_, i) => ({ x: x[1][i], y: y[1][i] }));
  if (o.x_label == null) o.x_label = x[0];
  if (o.y_label == null) o.y_label = y[0];
  return o.points as { x: number; y: number }[];
}

// A table of rows ({ price, demand, supply }) is a line of the first two numeric columns.
function rowsToLine(o: Obj): boolean {
  const rows = pick(o, "data", "rows", "table", "values");
  if (!Array.isArray(rows) || rows.length < LIMITS.line.min) return false;
  const objs = rows.map(asObj).filter((x): x is Obj => x != null);
  if (objs.length < LIMITS.line.min) return false;
  const numericKeys = Object.keys(objs[0]).filter((k) => objs.every((row) => toNumber(row[k]) != null));
  if (numericKeys.length < 2) return false;
  const xKey = numericKeys.find((k) => /price|year|time|^x$|^t$/.test(k)) ?? numericKeys[0];
  const yKey = numericKeys.find((k) => k !== xKey && /demand|growth|value|^y$|amount|supply/.test(k)) ?? numericKeys.find((k) => k !== xKey);
  if (!yKey) return false;
  o.points = objs.slice(0, LIMITS.line.max).map((row) => ({ x: toNumber(row[xKey])!, y: toNumber(row[yKey])! }));
  if (o.x_label == null) o.x_label = xKey;
  if (o.y_label == null) o.y_label = yKey;
  return true;
}

// A name the model invented ("example", "rule", "equilibrium"): turn the
// fields it did send into a template that exists.
function coerceNamed(k: string, o: Obj, issues: string[]): TemplateId | null {
  const textOf = (...keys: string[]) => {
    const v = pick(o, ...keys);
    return typeof v === "string" && v.trim() ? v : null;
  };
  const use = (t: TemplateId) => {
    issues.push(`template:alias:${k}`);
    return t;
  };
  if (["rule", "rules", "principle", "law", "takeaway"].includes(k)) {
    const text = textOf("rule", "rules", "principle", "law", "text", "statement", "content");
    if (text) {
      o.text = text;
      return use("quote");
    }
  }
  if (["example", "worked_example", "scenario", "case"].includes(k)) {
    if (numericSeries(o)) return use("line");
    const amount = pick(o, "amount", "result", "answer", "total", "value");
    if (!Array.isArray(amount) && toNumber(amount) != null) {
      o.value = amount;
      if (o.label == null) o.label = pick(o, "title", "heading", "caption");
      return use("number");
    }
    const text = textOf("example", "text", "description", "result");
    if (text) {
      o.text = text;
      return use("quote");
    }
  }
  return null;
}

// "D(p) = 1000 - 20p" is a function of p. Rewrite the variable as x when that
// compiles; otherwise it is not a plot.
function asFunctionOfX(line: string): { expr: string; renamed: boolean } | null {
  let expr = line.trim();
  let renamed = false;
  const named = /^[A-Za-z]\w*\(\s*([a-z])\s*\)\s*=\s*(.+)$/i.exec(expr);
  if (named) {
    expr = named[2];
    const v = named[1].toLowerCase();
    if (v !== "x" && v !== "e") {
      expr = expr.replace(new RegExp(`(?<![A-Za-z])${v}(?![A-Za-z])`, "gi"), "x");
      renamed = true;
    }
  }
  return compileExpression(expr).ok ? { expr, renamed } : null;
}

// A sentence is not a formula. A year range in a sentence is not one either.
function looksLikeFormula(s: string): boolean {
  if (/[=^*/√]|\\frac|\\sqrt/.test(s)) return true;
  if (/\b(?:sin|cos|tan|exp|ln|log|sqrt)\s*\(/i.test(s)) return true;
  if (/\d[a-z]|[a-z]\d/i.test(s)) return true;
  return /\d\s*[+-]\s*\d/.test(s) && s.split(/\s+/).length < 8;
}

function templateOf(o: Obj, issues: string[]): TemplateId | null {
  const raw = pick(o, "template", "type", "kind", "layout", "scene_type", "visual", "template_id", "style", "visual_type");
  if (typeof raw === "string") {
    const k = keyOf(raw).replace(/_?(scene|template|slide)$/, "");
    if (TEMPLATE_ALIASES[k]) {
      if (TEMPLATE_ALIASES[k] !== k) issues.push(`template:alias:${k}`);
      return TEMPLATE_ALIASES[k];
    }
    const coerced = coerceNamed(k, o, issues);
    if (coerced) return coerced;
    issues.push(`template:unknown:${k.slice(0, 24)}`);
  } else issues.push("template:missing");
  // No usable name: guess from the fields it has.
  if (rowsToLine(o)) return "line";
  const demand = toNumber(o.demand);
  const supply = toNumber(o.supply);
  if (demand != null && supply != null) {
    o.bars = [
      { label: "Demand", value: demand },
      { label: "Supply", value: supply },
    ];
    return "bars";
  }
  const has = (...k: string[]) => k.some((x) => o[x] != null);
  if (has("bars")) return "bars";
  if (has("expression", "function")) return "plot";
  if (has("events")) return "timeline";
  if (has("stages")) return "cycle";
  if (has("branches")) return "map";
  if (has("formula", "equation")) return "equation";
  if (has("term")) return "definition";
  if (has("left", "right")) return "compare";
  if (has("code")) return "code";
  if (has("steps")) return "steps";
  if (has("html", "svg")) return "html";
  if (has("points", "bullets", "items")) return "points";
  if (has("subtitle")) return "title";
  if (typeof o.value === "number") return "number";
  return null;
}

type Ctx = { issues: string[]; videoTitle: string; material: string | null };

function body(t: TemplateId, o: Obj, ctx: Ctx): SceneBody | null {
  const { issues } = ctx;
  const title = (fallback: string) => cleanText(pick(o, "title", "heading", "header", "name", "topic", "caption"), LIMITS.title, issues) || fallback;
  switch (t) {
    case "title": {
      const heading = title(ctx.videoTitle);
      return heading ? { template: t, title: heading, subtitle: cleanText(pick(o, "subtitle", "tagline", "subheading", "description", "text", "hook"), LIMITS.item, issues) } : null;
    }
    case "points":
    case "recap": {
      const points = textList(pick(o, "points", "bullets", "items", "list", "key_points", "takeaways", "ideas", "content", "text", "facts", "lines"), LIMITS.points.max, issues);
      if (points.length < LIMITS.points.min) {
        issues.push(`${t}:too-few`);
        return points.length === 1 ? { template: "quote", text: points[0], by: "" } : null;
      }
      return { template: t, title: title(t === "recap" ? "Remember" : "Key ideas"), points };
    }
    case "definition": {
      const term = cleanText(pick(o, "term", "word", "concept", "title", "name", "heading"), LIMITS.title, issues);
      const meaning = cleanText(pick(o, "meaning", "definition", "description", "explanation", "text", "content"), 160, issues);
      if (!term || !meaning) return null;
      const ex = pick(o, "example", "examples", "for_example", "e_g", "analogy");
      return { template: t, term, meaning, example: cleanText(Array.isArray(ex) ? ex[0] : ex, 140, issues) };
    }
    case "equation": {
      const raw = pick(o, "formula", "equation", "expression", "latex", "math");
      const formula = cleanText(raw, 80, issues);
      if (!formula) return null;
      const partsRaw = pick(o, "parts", "terms", "variables", "symbols", "legend", "where", "explanation");
      const parts: { symbol: string; meaning: string }[] = [];
      const add = (sym: unknown, mean: unknown) => {
        const symbol = cleanText(sym, 16, issues);
        const meaning = cleanText(mean, 70, issues);
        if (symbol && meaning) parts.push({ symbol, meaning });
      };
      if (Array.isArray(partsRaw)) {
        for (const p of partsRaw) {
          if (typeof p === "string") {
            const m = /^\s*([^:=–-]{1,16}?)\s*(?::|=|–|-|is|means)\s*(.+)$/.exec(p);
            if (m) add(m[1], m[2]);
          } else {
            const po = asObj(p);
            if (po) add(pick(po, "symbol", "var", "variable", "term", "name", "sym"), pick(po, "meaning", "description", "definition", "explanation", "means", "value"));
          }
        }
      } else if (asObj(partsRaw)) for (const [k, v] of Object.entries(partsRaw as Obj)) add(k, v);
      if (parts.length > LIMITS.parts.max) issues.push("equation:too-many-parts");
      return { template: t, title: title("The formula"), formula, parts: parts.slice(0, LIMITS.parts.max) };
    }
    case "steps":
    case "cycle": {
      const max = t === "steps" ? LIMITS.steps.max : LIMITS.stages.max;
      const items = textList(pick(o, t === "steps" ? "steps" : "stages", "steps", "stages", "phases", "items", "points", "process", "sequence"), max, issues);
      const min = t === "steps" ? LIMITS.steps.min : LIMITS.stages.min;
      if (items.length < min) {
        issues.push(`${t}:too-few`);
        if (t === "cycle" && items.length >= 2) return { template: "steps", title: title("How it works"), steps: items };
        return null;
      }
      return t === "steps" ? { template: t, title: title("How it works"), steps: items } : { template: t, title: title("The cycle"), stages: items };
    }
    case "compare": {
      const side = (v: unknown, fallbackLabel: string) => {
        if (typeof v === "string") return { label: cleanText(v, 30, issues), points: [] as string[] };
        if (Array.isArray(v)) return { label: fallbackLabel, points: textList(v, LIMITS.side.max, issues) };
        const so = asObj(v);
        if (!so) return null;
        const points = textList(pick(so, "points", "items", "bullets", "features", "pros", "list", "facts", "description"), LIMITS.side.max, issues);
        if (!points.length) {
          const formula = cleanText(pick(so, "formula", "equation", "expression"), LIMITS.item, issues);
          if (formula) points.push(formula);
        }
        return { label: cleanText(pick(so, "label", "name", "title", "heading", "header", "side"), 30, issues) || fallbackLabel, points };
      };
      let l: ReturnType<typeof side> = null;
      let r: ReturnType<typeof side> = null;
      const cols = pick(o, "columns", "sides", "items", "options", "things");
      if (Array.isArray(cols) && cols.length >= 2) {
        l = side(cols[0], "A");
        r = side(cols[1], "B");
      } else {
        l = side(pick(o, "left", "a", "first", "option_a", "side_a", "before"), "A");
        r = side(pick(o, "right", "b", "second", "option_b", "side_b", "after"), "B");
        // "left": "PCA", "left_points": [...]
        if (l && !l.points.length) l.points = textList(pick(o, "left_points", "a_points", "left_items"), LIMITS.side.max, issues);
        if (r && !r.points.length) r.points = textList(pick(o, "right_points", "b_points", "right_items"), LIMITS.side.max, issues);
      }
      if (!l || !r || (!l.points.length && !r.points.length)) return null;
      return { template: t, title: title(`${l.label} vs ${r.label}`), left: l, right: r };
    }
    case "bars": {
      const raw = pick(o, "bars", "data", "values", "items", "chart", "series", "points");
      let unit = cleanText(pick(o, "unit", "units", "suffix", "y_unit"), 12, issues);
      const pairs: { label: string; value: number }[] = [];
      let percent = false;
      const add = (label: unknown, value: unknown) => {
        if (typeof value === "string" && /%/.test(value)) percent = true;
        if (typeof value === "string") issues.push("bars:number-as-text");
        const v = toNumber(value);
        const l = cleanText(label, 28, issues);
        if (l && v != null) pairs.push({ label: l, value: v });
      };
      if (Array.isArray(raw)) {
        for (const b of raw) {
          if (Array.isArray(b)) add(b[0], b[1]);
          else {
            const bo = asObj(b);
            if (bo) add(pick(bo, "label", "name", "category", "x", "key", "item", "group"), pick(bo, "value", "y", "amount", "count", "percent", "percentage", "score", "size", "number"));
          }
        }
      } else if (asObj(raw)) for (const [k, v] of Object.entries(raw as Obj)) add(k, v);
      else {
        const labels = pick(o, "labels", "categories");
        const values = pick(o, "values", "numbers");
        if (Array.isArray(labels) && Array.isArray(values)) labels.forEach((lab, k) => add(lab, values[k]));
      }
      if (percent && !unit) unit = "%";
      if (pairs.length < LIMITS.bars.min) {
        issues.push("bars:not-enough-numbers");
        return null;
      }
      if (pairs.length > LIMITS.bars.max) issues.push("bars:too-many");
      if (pairs.every((p) => p.value === 0)) return null;
      if (ctx.material && !pairs.some((p) => inMaterial(p.value, ctx.material!))) {
        issues.push("bars:invented-numbers");
        return null;
      }
      return { template: t, title: title("By the numbers"), unit, bars: pairs.slice(0, LIMITS.bars.max) };
    }
    case "line": {
      const raw = pick(o, "points", "data", "values", "series", "line");
      const pts: { x: number | null; y: number | null; label: string }[] = [];
      if (Array.isArray(raw)) {
        for (const p of raw) {
          if (Array.isArray(p)) pts.push({ x: toNumber(p[0]), y: toNumber(p[1]), label: String(p[0]) });
          else {
            const po = asObj(p);
            if (po) {
              const xr = pick(po, "x", "label", "time", "year", "t", "step", "date");
              pts.push({ x: toNumber(xr), y: toNumber(pick(po, "y", "value", "amount", "count")), label: cleanText(xr, 20) });
            }
          }
        }
      }
      const good = pts.filter((p) => p.y != null);
      // Categories along x: that's a bar chart.
      if (good.length >= LIMITS.bars.min && good.some((p) => p.x == null)) {
        issues.push("line:categorical-x");
        return { template: "bars", title: title("By the numbers"), unit: "", bars: good.slice(0, LIMITS.bars.max).map((p) => ({ label: p.label || "?", value: p.y! })) };
      }
      const xy = good.filter((p) => p.x != null).map((p) => ({ x: p.x!, y: p.y! })).sort((a, b) => a.x - b.x);
      if (xy.length < LIMITS.line.min) {
        issues.push("line:too-few-points");
        if (xy.length === 2) return { template: "bars", title: title("By the numbers"), unit: "", bars: xy.map((p) => ({ label: String(p.x), value: p.y })) };
        return null;
      }
      if (ctx.material && !xy.some((p) => inMaterial(p.y, ctx.material!))) {
        issues.push("line:invented-numbers");
        return null;
      }
      return { template: t, title: title("How it changes"), x_label: cleanText(pick(o, "x_label", "xlabel", "x_axis", "x"), 24, issues), y_label: cleanText(pick(o, "y_label", "ylabel", "y_axis", "y"), 24, issues), points: xy.slice(0, LIMITS.line.max) };
    }
    case "plot": {
      const raw = pick(o, "expression", "function", "formula", "equation", "f", "y", "expr", "fx", "f_x");
      if (typeof raw !== "string") return null;
      const lines = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      const fns = lines.map(asFunctionOfX).filter((s): s is { expr: string; renamed: boolean } => s != null);
      if (fns.length > 1) {
        issues.push("plot:several-equations");
        return { template: "equation", title: title("The function"), formula: cleanText(lines.join(" ; "), 80, issues), parts: [] };
      }
      if (fns.length === 1 && lines.length > 1) issues.push("plot:extra-line");
      const candidate = fns[0]?.expr ?? raw;
      const compiled = compileExpression(candidate);
      if (!compiled.ok) {
        if (!looksLikeFormula(raw)) {
          issues.push("plot:not-a-function");
          const text = cleanText(lines[0] ?? raw, 160, issues);
          return text ? { template: "quote", text, by: "" } : null;
        }
        issues.push("plot:bad-expression");
        return { template: "equation", title: title("The function"), formula: cleanText(raw, 80, issues), parts: [] };
      }
      if (fns[0]?.renamed) issues.push("plot:renamed-variable");
      let lo = toNumber(pick(o, "x_min", "xmin", "from", "start", "min", "x_from"));
      let hi = toNumber(pick(o, "x_max", "xmax", "to", "end", "max", "x_to"));
      const dom = pick(o, "domain", "range", "x_range", "x_domain", "interval");
      if ((lo == null || hi == null) && Array.isArray(dom) && dom.length >= 2) {
        lo = toNumber(dom[0]);
        hi = toNumber(dom[1]);
      } else if ((lo == null || hi == null) && typeof dom === "string") {
        const nums = dom.match(/-?\d+(?:\.\d+)?/g);
        if (nums && nums.length >= 2) [lo, hi] = [Number(nums[0]), Number(nums[1])];
      }
      if (lo == null || hi == null) {
        issues.push("plot:no-domain");
        lo = -5;
        hi = 5;
      }
      if (lo > hi) [lo, hi] = [hi, lo];
      if (hi - lo < 1e-6) hi = lo + 10;
      const { finite } = samplePlot(compiled.f, lo, hi, 120);
      if (finite < 30) {
        issues.push("plot:mostly-undefined");
        return { template: "equation", title: title("The function"), formula: cleanText(raw, 80, issues), parts: [] };
      }
      return { template: t, title: title("The graph"), expression: tidyExpression(fns[0]?.renamed ? candidate : raw), x_min: lo, x_max: hi, note: cleanText(pick(o, "note", "caption", "description", "label", "insight"), LIMITS.item, issues) };
    }
    case "timeline": {
      const raw = pick(o, "events", "items", "dates", "milestones", "timeline", "points", "steps");
      const events: { when: string; what: string }[] = [];
      if (Array.isArray(raw)) {
        for (const e of raw) {
          if (typeof e === "string") {
            const m = /^\s*([^:–—-]{1,24}?)\s*[:–—-]\s*(.+)$/.exec(e);
            if (m) events.push({ when: cleanText(m[1], 20, issues), what: cleanText(m[2], LIMITS.item, issues) });
          } else {
            const eo = asObj(e);
            if (eo) {
              const when = cleanText(pick(eo, "when", "date", "year", "time", "period", "age", "era"), 20, issues);
              const what = cleanText(pick(eo, "what", "event", "description", "label", "text", "title", "name"), LIMITS.item, issues);
              if (when && what) events.push({ when, what });
            }
          }
        }
      }
      if (events.length < LIMITS.events.min) {
        issues.push("timeline:too-few");
        return null;
      }
      return { template: t, title: title("Over time"), events: events.slice(0, LIMITS.events.max) };
    }
    case "map": {
      const center = cleanText(pick(o, "center", "centre", "topic", "title", "main", "root", "central", "hub", "core"), 40, issues);
      const branches = textList(pick(o, "branches", "children", "nodes", "items", "related", "subtopics", "points", "spokes", "ideas"), LIMITS.branches.max, issues);
      if (!center || branches.length < LIMITS.branches.min) {
        issues.push("map:too-few");
        return null;
      }
      return { template: t, center, branches };
    }
    case "number": {
      const raw = pick(o, "value", "number", "stat", "figure", "amount", "statistic");
      const value = toNumber(raw);
      const label = cleanText(pick(o, "label", "description", "text", "caption", "title", "meaning", "context"), LIMITS.item, issues);
      if (value == null) {
        issues.push("number:not-a-number");
        return label ? { template: "quote", text: label, by: "" } : null;
      }
      if (ctx.material && !inMaterial(value, ctx.material)) {
        issues.push("number:invented");
        return label ? { template: "quote", text: label, by: "" } : null;
      }
      let unit = cleanText(pick(o, "unit", "units", "suffix"), 12, issues);
      if (!unit && typeof raw === "string" && /%/.test(raw)) unit = "%";
      return { template: t, value, unit, label };
    }
    case "quote": {
      const text = cleanText(pick(o, "text", "quote", "content", "statement", "line", "sentence", "title"), 160, issues);
      return text ? { template: t, text, by: cleanText(pick(o, "by", "author", "source", "who", "attribution"), 40, issues) } : null;
    }
    case "code": {
      let code = pick(o, "code", "snippet", "source", "program", "content");
      if (Array.isArray(code)) code = code.join("\n");
      if (typeof code !== "string" || !code.trim()) return null;
      let c = code.replace(/^```\w*\n?|```$/g, "").replace(/\t/g, "  ").replace(/\s+$/g, "");
      let rows = c.split("\n");
      if (rows.length > LIMITS.code.lines) {
        issues.push("code:too-long");
        rows = rows.slice(0, LIMITS.code.lines);
      }
      if (rows.some((l) => l.length > LIMITS.code.width)) {
        issues.push("code:line-too-long");
        rows = rows.map((l) => (l.length > LIMITS.code.width ? `${l.slice(0, LIMITS.code.width - 1)}…` : l));
      }
      c = rows.join("\n");
      const f = pick(o, "focus", "highlight", "highlights", "lines", "highlight_lines", "focus_lines");
      const focus: number[] = [];
      for (const x of Array.isArray(f) ? f : typeof f === "string" ? f.split(/[,\s]+/) : typeof f === "number" ? [f] : []) {
        const r = /^(\d+)\s*-\s*(\d+)$/.exec(String(x));
        if (r) for (let n = Number(r[1]); n <= Number(r[2]); n++) focus.push(n);
        else if (toNumber(x) != null) focus.push(Math.round(toNumber(x)!));
      }
      const n = c.split("\n").length;
      return { template: t, title: title("In code"), language: cleanText(pick(o, "language", "lang"), 16) || "code", code: c, focus: [...new Set(focus)].filter((k) => k >= 1 && k <= n).slice(0, 6) };
    }
    case "html": {
      const html = pick(o, "html", "svg", "markup", "content");
      if (typeof html !== "string" || !/<[a-z]/i.test(html)) return null;
      if (html.length > LIMITS.html) {
        issues.push("html:too-long");
        return null;
      }
      if (/<script|on\w+\s*=|javascript:/i.test(html)) issues.push("html:scripts");
      return { template: t, title: title(""), html };
    }
  }
}

// Whether a number appears in the material (as written, or as a percentage of it).
export function inMaterial(v: number, material: string): boolean {
  const nums = materialNumbers(material);
  return nums.some((n) => near(n, v) || near(n * 100, v) || near(n / 100, v));
}
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 0.005);
const numCache = new Map<string, number[]>();
function materialNumbers(material: string): number[] {
  let n = numCache.get(material);
  if (!n) {
    n = (material.replace(/(\d),(\d{3})/g, "$1$2").match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (numCache.size > 20) numCache.clear();
    numCache.set(material, n);
  }
  return n;
}

/* ------------------------------------------------------------- narration */

const NARRATION_KEYS = ["narration", "lines", "dialogue", "dialog", "script", "voiceover", "voice_over", "speech", "audio", "say", "spoken", "conversation", "transcript", "talk", "hosts"];

export function narrationOf(o: Obj, issues: string[]): Line[] {
  const raw = pick(o, ...NARRATION_KEYS);
  const names: string[] = [];
  const speakerOf = (who: unknown): Speaker => {
    const w = String(who ?? "").trim().toLowerCase();
    if (/^(?:host\s*|speaker\s*|voice\s*)?(a|1)$/.test(w)) return "A";
    if (/^(?:host\s*|speaker\s*|voice\s*)?(b|2)$/.test(w)) return "B";
    if (!w) return "A";
    if (!names.includes(w)) names.push(w);
    return names.indexOf(w) % 2 === 0 ? "A" : "B";
  };
  const out: Line[] = [];
  const push = (speaker: Speaker, text: unknown) => {
    let t = String(text ?? "").replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2");
    // Stage directions: [Music], *laughs*, (pauses). Other asterisks and brackets keep their words.
    const before = t;
    t = t.replace(/\[[^\]]{0,40}\]/g, " ").replace(/[*(]\s*(?:laugh|chuckl|paus|sigh|smil|music|sound|applause|beat|gasp|nod|grin|excit|think|intro|outro|clears)[^*)]{0,30}[*)]/gi, " ");
    if (t !== before) issues.push("narration:stage-directions");
    t = t.replace(/\*([^*]+)\*/g, "$1");
    if (/[\\$]/.test(t)) issues.push("narration:latex");
    t = latexToText(t).replace(/\*\*|__|`|#/g, "").replace(/\s+/g, " ").trim();
    if (!t) return;
    // Long lines split at sentence ends.
    while (t.length > LIMITS.narration.chars) {
      issues.push("narration:long-line");
      const head = t.slice(0, LIMITS.narration.chars);
      const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
      const at = cut > 60 ? cut + 1 : Math.max(head.lastIndexOf(" "), 60);
      out.push({ speaker, text: t.slice(0, at).trim() });
      t = t.slice(at).trim();
    }
    out.push({ speaker, text: t });
  };
  const fromString = (s: string) => {
    const parts = s.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    for (const p of parts) {
      const m = /^\s*\**([A-Za-z][\w .]{0,20}?)\**\s*:\s*(.+)$/.exec(p);
      if (m && m[1].split(" ").length <= 3) push(speakerOf(m[1]), m[2]);
      else push(out.length ? out[out.length - 1].speaker : "A", p);
    }
  };
  if (typeof raw === "string") fromString(raw);
  else if (Array.isArray(raw)) {
    for (const l of raw) {
      if (typeof l === "string") fromString(l);
      else {
        const lo = asObj(l);
        if (!lo) continue;
        const text = pick(lo, "text", "line", "content", "says", "speech", "dialogue", "message", "words", "narration");
        const who = pick(lo, "speaker", "host", "role", "who", "name", "voice", "character");
        if (text != null) push(speakerOf(who), text);
        else {
          // {"A": "…"} or {"Alex": "…"}
          const entries = Object.entries(lo).filter(([, v]) => typeof v === "string");
          if (entries.length === 1) push(speakerOf(entries[0][0]), entries[0][1]);
        }
      }
    }
  } else if (asObj(raw)) {
    for (const [who, text] of Object.entries(raw as Obj)) if (typeof text === "string") push(speakerOf(who), text);
    issues.push("narration:as-object");
  }
  if (out.length > LIMITS.narration.max) issues.push("narration:too-many-lines");
  return out.slice(0, LIMITS.narration.max + 2);
}

// A scene that can't be drawn as asked: its key sentences as points.
function fallbackScene(o: Obj, narration: Line[], ctx: Ctx): Scene | null {
  const sentences = narration
    .flatMap((l) => l.text.split(/(?<=[.!?])\s+/))
    .map((s) => s.replace(/^(so|and|but|well|okay|right|now|yes|exactly)[, ]+/i, "").trim())
    .filter((s) => s.length > 12 && !s.endsWith("?"));
  const points = sentences.slice(0, 3).map((s) => cleanText(s, LIMITS.item));
  if (points.length >= 2) return { template: "points", title: cleanText(pick(o, "title", "heading", "name"), LIMITS.title) || "Key ideas", points, narration };
  if (points.length === 1) return { template: "quote", text: points[0], by: "", narration };
  const heading = cleanText(pick(o, "title", "heading", "name"), LIMITS.title);
  if (heading && narration.length) return { template: "title", title: heading, subtitle: "", narration };
  if (narration.length) return { template: "quote", text: cleanText(narration[0].text, 160), by: "", narration };
  return null;
}

/* ----------------------------------------------------------------- whole */

export function repairVideo(raw: string, opts: { title?: string; material?: string | null } = {}): Repaired {
  const issues: string[] = [];
  let data = extractJson(raw, issues);
  if (data == null) return { script: null, issues };
  if (Array.isArray(data)) {
    data = { scenes: data };
    issues.push("shape:bare-array");
  }
  let top = asObj(data) ?? {};
  for (const wrap of ["video", "storyboard", "script", "output", "result", "response"]) {
    const inner = asObj(top[wrap]);
    if (inner && !Array.isArray(top.scenes)) {
      top = { ...top, ...inner };
      issues.push("shape:wrapped");
    }
  }
  let scenesRaw = pick(top, "scenes", "slides", "frames", "storyboard", "parts", "sections", "shots", "segments");
  if (!Array.isArray(scenesRaw)) {
    // One scene on its own.
    if (templateOf({ ...top }, []) && pick(top, ...NARRATION_KEYS)) {
      scenesRaw = [top];
      issues.push("shape:single-scene");
    } else {
      issues.push("shape:no-scenes");
      return { script: null, issues };
    }
  }
  const videoTitle = cleanText(pick(top, "title", "name", "topic", "video_title"), LIMITS.title, issues) || opts.title || "Explainer";
  const ctx: Ctx = { issues, videoTitle, material: opts.material ?? null };
  const scenes: Scene[] = [];
  const said = new Set<string>();
  for (const s of scenesRaw as unknown[]) {
    const o0 = asObj(s);
    if (!o0) {
      issues.push("scene:not-object");
      continue;
    }
    // Fields may sit in a nested object ("data", "content", "props").
    let o = o0;
    for (const nest of ["data", "content", "props", "fields", "params", "visual_data", "elements"]) {
      const inner = asObj(o0[nest]);
      if (inner) {
        o = { ...o, ...inner };
        if (nest !== "data") issues.push(`scene:nested-${nest}`);
      }
    }
    const narration = narrationOf(o, issues);
    if (!narration.length) issues.push("scene:no-narration");
    const key = narration.map((l) => l.text).join(" ").toLowerCase();
    if (key && said.has(key)) {
      issues.push("scene:repeated");
      continue;
    }
    if (key) said.add(key);
    const t = templateOf(o, issues);
    const b = t ? body(t, o, ctx) : null;
    if (b && narration.length) {
      scenes.push({ ...b, narration: narration.slice(0, LIMITS.narration.max) } as Scene);
      continue;
    }
    if (b && !narration.length) {
      issues.push("scene:dropped-silent");
      continue;
    }
    if (t) issues.push(`scene:fallback:${t}`);
    const fb = fallbackScene(o, narration.slice(0, LIMITS.narration.max), ctx);
    if (fb) scenes.push(fb);
  }
  if (!scenes.length) {
    issues.push("shape:no-usable-scenes");
    return { script: null, issues };
  }
  // A real storyboard that forgot its opening or its ending still gets one.
  // One-scene repairs are left alone so a single fix can be checked on its own.
  if (scenes.length >= LIMITS.scenes.min && scenes[0].template !== "title") {
    issues.push("shape:no-opening");
    scenes.unshift({
      template: "title",
      title: videoTitle,
      subtitle: "",
      narration: [
        { speaker: "A", text: `Today we're looking at ${videoTitle}.` },
        { speaker: "B", text: "What's the main idea?" },
      ],
    });
  }
  if (scenes.length >= LIMITS.scenes.min && scenes[scenes.length - 1].template !== "recap") {
    issues.push("shape:no-recap");
    const remembered: string[] = [];
    for (const s of scenes) {
      const list = s.template === "points" || s.template === "recap" ? s.points : s.template === "steps" ? s.steps : [];
      for (const p of list) if (remembered.length < 3 && !remembered.includes(p)) remembered.push(p);
    }
    if (remembered.length >= 2) {
      scenes.push({
        template: "recap",
        title: "Remember",
        points: remembered.slice(0, 3),
        narration: [
          { speaker: "A", text: `Remember these things about ${videoTitle}.` },
          { speaker: "B", text: remembered[0] },
        ],
      });
    }
  }
  if (scenes.length > LIMITS.scenes.max) issues.push("shape:too-many-scenes");
  if (scenes.length < LIMITS.scenes.min) issues.push("shape:too-few-scenes");
  if (scenes[0].template !== "title" && !issues.includes("shape:no-opening")) issues.push("shape:no-opening");
  if (scenes[scenes.length - 1].template !== "recap" && !issues.includes("shape:no-recap")) issues.push("shape:no-recap");
  const speakers = new Set(scenes.flatMap((s) => s.narration.map((l) => l.speaker)));
  if (speakers.size < 2) issues.push("narration:one-voice");
  return { script: { title: videoTitle, scenes: scenes.slice(0, LIMITS.scenes.max) }, issues };
}

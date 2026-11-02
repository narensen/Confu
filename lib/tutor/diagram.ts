// How the tutor draws, and how what it draws is made safe and readable.
//
// Boxes and arrows (a pipeline, a process, a cycle, a hierarchy, a network
// block) come as a ```mermaid block: the tutor says what is connected to what,
// and the layout is computed here, so boxes fit their labels and nothing
// overlaps. A model guessing pixel coordinates could not see what it was
// drawing. Only a picture where position is the point (geometry, forces, a
// circuit, a curve) is still drawn by hand, as a ```svg block.
//
// Both are shown with an <img>, which does not run scripts. The SVG is still
// stripped of anything that could fire if the markup were ever inlined.

export const DIAGRAM_RULE = `When a picture teaches faster than a paragraph, add ONE diagram after a short explanation. Skip it when words are enough.
- Boxes and arrows (a pipeline, process, architecture or network block, cycle, hierarchy, cause and effect, a sequence of steps or messages, states): a fenced \`\`\`mermaid block. Write what connects to what; the layout is done for you. Use flowchart TD (top to bottom) unless it is 4 steps or fewer in a row, then flowchart LR. Every node is id["Label"]: a short id (a, b, c1) and the label in double quotes, at most 5 words. Circle: id(("+")). Decision: id{"Question?"}. Label an arrow with -->|"label"|. A skip or feedback arrow is just another edge (x --> add). Group with subgraph g1["Name"] … end. Also fine: sequenceDiagram, stateDiagram-v2, timeline, mindmap. No styling, classDef, colours, %%{init}%% or click lines, and no $ math inside it: write x², √n, Σ, ×, → as plain characters. At most 14 nodes.
- Only when position is the point (geometry, vectors and forces, a circuit, a graph of a function, a physical setup): a fenced \`\`\`svg block, one complete <svg viewBox="0 0 W H"> with W at most 640. Give every shape fill and stroke attributes (fill="#ffffff" or "none", stroke="#1a1a1a"); text gets font-size="14" fill="#1a1a1a" and sits inside the viewBox with 16px to spare. No <style>, classes, scripts, foreignObject, images or animation. Under 40 lines.
Math in the words around the diagram stays in $…$ and $$…$$.`;

/* --------------------------------------------------------------- mermaid */

// A fenced diagram of either kind, so other passes can leave it whole.
export const DIAGRAM_FENCE = /```(?:svg|mermaid)\b[\s\S]*?```/gi;

// Lines that restyle or wire up the diagram. The look is Confu's, and a
// diagram in an answer has nothing to click.
const DROP_LINE = /^\s*(?:(?:classDef|style|linkStyle|click|callback)\b|class\s+[\w-]+(?:\s*,\s*[\w-]+)*\s+[\w-]+\s*;?\s*$)/i;

/** The diagram as written, minus directives and styling. */
export function tidyMermaid(code: string): string {
  return code
    .replace(/%%\{[\s\S]*?\}%%/g, "")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .split("\n")
    .filter((line) => !DROP_LINE.test(line))
    .map((line) => line.replace(/:::[\w-]+/g, "").replace(/\$/g, ""))
    .join("\n")
    .trim();
}

// Unquoted labels with brackets, colons or symbols in them are the usual
// syntax error. Quote them (flowcharts only), the way the prompt asks.
const quote = (label: string) => `"${label.trim().replace(/"/g, "'")}"`;

/** A second try at a flowchart that did not parse: every label quoted. */
export function quoteMermaidLabels(code: string): string {
  if (!/^\s*(?:flowchart|graph)\b/i.test(code)) return code;
  return code
    .split("\n")
    .map((line) =>
      line
        .replace(/(\b[A-Za-z_][\w-]*)\[(?!["[(/\\])([^\]\n"]+)\]/g, (_, id: string, label: string) => `${id}[${quote(label)}]`)
        .replace(/(\b[A-Za-z_][\w-]*)\((?!["([])([^)\n"]+)\)/g, (_, id: string, label: string) => `${id}(${quote(label)})`)
        .replace(/(\b[A-Za-z_][\w-]*)\{(?!["{])([^}\n"]+)\}/g, (_, id: string, label: string) => `${id}{${quote(label)}}`)
        .replace(/\|(?!")([^|\n"]+)\|/g, (_, label: string) => `|${quote(label)}|`),
    )
    .join("\n");
}

/* ------------------------------------------------------------------- svg */

const BANNED = "script|foreignObject|iframe|object|embed|link|meta|image|use|set|animate|animateTransform|animateMotion|handler|mpath|feImage";

// A stylesheet inside the drawing is how most models colour their boxes.
// Dropping it left every box black and every label in the browser's default
// serif. It stays, minus anything that could load or run something.
function safeStyle(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/expression\s*\(/gi, "(")
    .replace(/javascript:/gi, "")
    .replace(/-moz-binding[^;]*;?/gi, "")
    .replace(/<\/?[a-z][^>]*>/gi, "");
}

const SHAPES = new Set(["rect", "circle", "ellipse", "polygon"]);
const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// What SVG does with a shape that says nothing: a black fill, no outline, and
// labels in the default serif at 16px. Give those the tutor's look instead:
// white boxes with an ink outline, unfilled lines, sans-serif text. A shape
// that sets its own colour (or inherits one from its group, or has a class
// the drawing's stylesheet can reach) keeps it.
function fillDefaults(svg: string): string {
  // Per open element: whether it (or a group above it) sets a fill or a
  // stroke, and whether it is inside an arrowhead marker.
  const stack: { fill: boolean; stroke: boolean; marker: boolean }[] = [];
  const has = (attrs: string, name: "fill" | "stroke") => new RegExp(`(?:^|\\s)${name}\\s*=|style\\s*=\\s*["'][^"']*\\b${name}\\s*:`, "i").test(attrs);
  const styled = /<style\b/i.test(svg);
  return svg.replace(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g, (tag, close: string, name: string, attrs: string, self: string) => {
    const parent = stack[stack.length - 1] ?? { fill: false, stroke: false, marker: false };
    if (close) {
      stack.pop();
      return tag;
    }
    const lower = name.toLowerCase();
    const classed = styled && /\sclass\s*=/.test(attrs);
    const fill = parent.fill || has(attrs, "fill") || classed;
    const stroke = parent.stroke || has(attrs, "stroke") || classed;
    let extra = "";
    if (lower === "svg") {
      if (!/\sfont-family\s*=/.test(attrs)) extra += ` font-family="${FONT}"`;
      if (!/\sfont-size\s*=/.test(attrs)) extra += ` font-size="14"`;
    } else if (SHAPES.has(lower) && parent.marker) {
      if (!fill) extra += ' fill="#1a1a1a"';
    } else if (SHAPES.has(lower)) {
      if (!fill) extra += ' fill="#ffffff"';
      if (!stroke) extra += ' stroke="#1a1a1a" stroke-width="1.5"';
    } else if ((lower === "polyline" || lower === "line") && !fill) {
      extra += ' fill="none"';
      if (!stroke) extra += ' stroke="#1a1a1a" stroke-width="1.5"';
    }
    // svg is the root, not a group: its own fill would colour every label.
    const group = lower === "g" || lower === "marker";
    if (!self)
      stack.push(
        lower === "svg"
          ? { fill: false, stroke: false, marker: false }
          : { fill: group ? fill : parent.fill, stroke: group ? stroke : parent.stroke, marker: parent.marker || lower === "marker" },
      );
    return extra ? `<${name}${attrs}${extra}${self}>` : tag;
  });
}

/** A single safe <svg>…</svg>, or null when the fence is incomplete or empty. */
export function sanitizeSvg(raw: string): string | null {
  let svg = raw.trim().replace(/^```(?:svg|xml|html)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = svg.search(/<svg\b/i);
  const end = svg.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < start) return null;
  svg = svg.slice(start, end + "</svg>".length);
  svg = svg.replace(/<!DOCTYPE[\s\S]*?>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!\[CDATA\[|\]\]>/g, "");
  const styles: string[] = [];
  svg = svg.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_, css: string) => {
    styles.push(safeStyle(css));
    return `\u0000S${styles.length - 1}\u0000`;
  });
  svg = svg.replace(/<\/?style\b[^>]*>/gi, "");
  const paired = new RegExp(`<\\s*(${BANNED})\\b[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`, "gi");
  const open = new RegExp(`<\\s*(${BANNED})\\b[^>]*\\/?>`, "gi");
  for (let i = 0; i < 6; i++) svg = svg.replace(paired, "");
  svg = svg.replace(open, "");
  svg = svg.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  svg = svg.replace(/\s(?:href|xlink:href|src)\s*=\s*(["'])\s*(?:javascript|data|vbscript|https?|\/\/)[^"']*\1/gi, "");
  svg = svg.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, (m) => (/url\s*\(|expression\s*\(|javascript:|-moz-binding/i.test(m) ? "" : m));
  svg = svg.replace(/\u0000S(\d+)\u0000/g, (_, i) => `<style>${styles[Number(i)] ?? ""}</style>`);
  if (!/^<svg\b/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return null;
  if (new RegExp(`<\\s*(${BANNED})\\b`, "i").test(svg)) return null;
  if (!/\bxmlns\s*=/.test(svg)) svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/\bviewBox\s*=/.test(svg)) {
    const opening = svg.match(/^<svg\b[^>]*>/i)?.[0] ?? "";
    const w = Number(opening.match(/\bwidth\s*=\s*["']?([\d.]+)/i)?.[1]) || 640;
    const h = Number(opening.match(/\bheight\s*=\s*["']?([\d.]+)/i)?.[1]) || 360;
    svg = svg.replace(/<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`);
  }
  return fillDefaults(svg);
}

/** The drawing's own size, from its viewBox: shown at that size, never stretched. */
export function svgSize(svg: string): { width: number; height: number } {
  const box = svg.match(/\bviewBox\s*=\s*["']\s*[\d.+-]+[\s,]+[\d.+-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  const width = Math.max(1, Number(box?.[1]) || 640);
  const height = Math.max(1, Number(box?.[2]) || 360);
  return { width, height };
}

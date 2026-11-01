// How the tutor draws, and how a reply's SVG is made safe to show as an image.
// The fence is rendered with an <img>, which does not run scripts. This still
// strips anything that could fire if the markup were ever inlined instead.

export const DIAGRAM_RULE =
  'When a picture teaches faster than a paragraph (a process, a relationship, a comparison, a shape), add ONE fenced ```svg block after a short explanation. The block is a single complete <svg viewBox="0 0 … …"> with dark ink (#1a1a1a) on a light fill (#f7f6f2), short readable labels, no scripts, no foreignObject, no external images, no animation, and under 30 lines. Skip it when words are enough. Math stays in $…$ and $$…$$, never inside the SVG.';

const BANNED = "script|foreignObject|iframe|object|embed|link|meta|image|use|set|animate|animateTransform|animateMotion|handler|mpath|feImage|style";

/** A single safe <svg>…</svg>, or null when the fence is incomplete or empty. */
export function sanitizeSvg(raw: string): string | null {
  let svg = raw.trim().replace(/^```(?:svg|xml|html)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = svg.search(/<svg\b/i);
  const end = svg.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < start) return null;
  svg = svg.slice(start, end + "</svg>".length);
  svg = svg.replace(/<!DOCTYPE[\s\S]*?>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "");
  const paired = new RegExp(`<\\s*(${BANNED})\\b[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`, "gi");
  const open = new RegExp(`<\\s*(${BANNED})\\b[^>]*\\/?>`, "gi");
  for (let i = 0; i < 6; i++) svg = svg.replace(paired, "");
  svg = svg.replace(open, "");
  svg = svg.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  svg = svg.replace(/\s(?:href|xlink:href|src)\s*=\s*(["'])\s*(?:javascript|data|vbscript|https?|\/\/)[^"']*\1/gi, "");
  svg = svg.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, (m) => (/url\s*\(|expression\s*\(|javascript:|-moz-binding/i.test(m) ? "" : m));
  if (!/^<svg\b/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return null;
  if (new RegExp(`<\\s*(${BANNED})\\b`, "i").test(svg)) return null;
  if (!/\bxmlns\s*=/.test(svg)) svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/\bviewBox\s*=/.test(svg)) svg = svg.replace(/<svg\b/i, '<svg viewBox="0 0 640 360"');
  const box = svg.match(/\bviewBox\s*=\s*["']\s*[\d.+-]+\s+[\d.+-]+\s+([\d.]+)\s+([\d.]+)/i);
  const opening = svg.match(/^<svg\b[^>]*>/i)?.[0] ?? "";
  if (box && !/\bwidth\s*=/.test(opening)) svg = svg.replace(/^<svg\b/i, `<svg width="${box[1]}" height="${box[2]}"`);
  return svg;
}

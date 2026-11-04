import "server-only";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { cleanText, type Block } from "./blocks";

// Web pages -> readable blocks (like a browser's Reader View), keeping
// headings, paragraphs, lists, code, quotes and tables, with maths kept as
// TeX. Images become a short note with their caption.

type El = { tagName: string; textContent: string | null; appendChild?(n: unknown): void; childNodes: ArrayLike<Node>; getAttribute(n: string): string | null; querySelector(s: string): El | null; querySelectorAll(s: string): ArrayLike<El>; replaceWith(n: unknown): void; remove(): void; closest?(s: string): El | null; href?: string };
type Doc = { title: string; createTextNode(t: string): unknown; querySelector(s: string): El | null; querySelectorAll(s: string): ArrayLike<El>; head: El; createElement(t: string): El & { setAttribute(n: string, v: string): void } };

const MAX_BLOCKS = 4000;
const MAX_CHARS = 600_000;

function documentFor(html: string, url: string): Doc {
  const { document } = parseHTML(html) as unknown as { document: Doc };
  // Readability resolves relative links against the base URL.
  if (!document.querySelector("base")) {
    const base = document.createElement("base");
    base.setAttribute("href", url);
    document.head?.appendChild?.(base as never);
  }
  return document;
}

// Rendered maths becomes TeX text so it survives extraction.
function keepMaths(doc: Doc) {
  for (const k of Array.from(doc.querySelectorAll(".katex"))) {
    const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (tex) k.replaceWith(doc.createTextNode(` $${tex.trim()}$ `));
  }
  for (const s of Array.from(doc.querySelectorAll('script[type^="math/tex"]'))) {
    const display = (s.getAttribute("type") ?? "").includes("mode=display");
    const tex = (s.textContent ?? "").trim();
    s.replaceWith(doc.createTextNode(display ? ` $$${tex}$$ ` : ` $${tex}$ `));
  }
  for (const m of Array.from(doc.querySelectorAll("math"))) {
    const alt = m.getAttribute("alttext");
    if (alt) m.replaceWith(doc.createTextNode(` $${alt}$ `));
  }
  // Maths drawn as images (Sphinx imgmath, many wikis): the TeX is in the alt text.
  for (const img of Array.from(doc.querySelectorAll('img.math, img[class*="math"], img[class*="latex"], img[class*="tex"]'))) {
    const tex = cleanText(img.getAttribute("alt") ?? "");
    if (!tex) continue;
    const display = Boolean(img.closest?.("div.math, .displaymath, .math-display"));
    img.replaceWith(doc.createTextNode(display ? ` $$${tex}$$ ` : ` $${tex}$ `));
  }
  for (const p of Array.from(doc.querySelectorAll(".MathJax_Preview, .MathJax, mjx-assistive-mml"))) p.remove();
}

// Page furniture that isn't content: heading permalinks and in-page tables of contents.
function dropFurniture(doc: Doc) {
  for (const el of Array.from(doc.querySelectorAll('.headerlink, a.anchor, .anchorjs-link, .contents.topic, div.contents.local, #table-of-contents, .table-of-contents, .toc, #toc, [role="navigation"]'))) el.remove();
}

const text = (el: { textContent: string | null }) => cleanText((el.textContent ?? "").replace(/\s+/g, " "));

function toBlocks(root: El): Block[] {
  const out: Block[] = [];
  let chars = 0;
  const push = (b: Block) => {
    if (out.length >= MAX_BLOCKS || chars > MAX_CHARS || !b.text) return;
    chars += b.text.length;
    out.push(b);
  };
  const walk = (node: El) => {
    for (const child of Array.from(node.childNodes) as unknown as El[]) {
      const tag = child.tagName?.toLowerCase();
      if (!tag) {
        // Bare text between blocks.
        const t = text(child);
        if (t.length > 1) push({ t: "p", text: t });
        continue;
      }
      if (/^h[1-6]$/.test(tag)) push({ t: "h", level: tag === "h1" || tag === "h2" ? 2 : 3, text: text(child).replace(/\s*[¶#§]\s*$/, "") });
      else if (tag === "p") push({ t: "p", text: text(child) });
      else if (tag === "pre") push({ t: "code", text: (child.textContent ?? "").replace(/\n+$/, "") });
      else if (tag === "blockquote") push({ t: "quote", text: text(child) });
      else if (tag === "ul" || tag === "ol") {
        let n = Number(child.getAttribute("start") ?? 1) || 1;
        for (const li of Array.from(child.childNodes) as unknown as El[]) {
          if (li.tagName?.toLowerCase() !== "li") continue;
          push({ t: "li", text: text(li), ...(tag === "ol" ? { n: n++ } : {}) });
        }
      } else if (tag === "table") {
        const rows = Array.from(child.querySelectorAll("tr")).map((tr) =>
          Array.from(tr.querySelectorAll("th, td"))
            .map((c) => text(c))
            .join("  |  "),
        );
        if (rows.length) push({ t: "code", text: rows.join("\n") });
      } else if (tag === "img") {
        const alt = cleanText(child.getAttribute("alt") ?? "");
        if (alt) push({ t: "note", text: `[Figure: ${alt}]` });
      } else if (tag === "figure") {
        const cap = child.querySelector("figcaption");
        const pre = child.querySelector("pre");
        if (pre) push({ t: "code", text: (pre.textContent ?? "").replace(/\n+$/, "") });
        const alt = cap ? text(cap) : cleanText(child.querySelector("img")?.getAttribute("alt") ?? "");
        if (alt) push({ t: "note", text: `[Figure: ${alt}]` });
      } else if (tag === "dl") {
        for (const d of Array.from(child.childNodes) as unknown as El[]) {
          const dt = d.tagName?.toLowerCase();
          if (dt === "dt") push({ t: "h", level: 3, text: text(d) });
          else if (dt === "dd") push({ t: "p", text: text(d) });
        }
      } else if (["script", "style", "noscript", "svg", "button", "form", "nav", "iframe"].includes(tag)) continue;
      else walk(child);
    }
  };
  walk(root);
  // Merge runs of tiny paragraphs (stray inline text) into their neighbours.
  return out.filter((b, i) => !(b.t === "p" && b.text.length < 3 && out[i + 1]?.t === "p"));
}

export function extractArticle(html: string, url: string) {
  const doc = documentFor(html, url);
  keepMaths(doc);
  dropFurniture(doc);
  const host = new URL(url).hostname.replace(/^www\./, "");
  const parsed = new Readability(doc as never, { charThreshold: 300, keepClasses: false }).parse();
  let blocks: Block[] = [];
  if (parsed?.content) {
    const { document: inner } = parseHTML(`<!doctype html><html><body><div id="root">${parsed.content}</div></body></html>`) as unknown as { document: Doc };
    const root = inner.querySelector("#root");
    if (root) blocks = toBlocks(root);
  }
  // "Key Concepts in RL — Spinning Up documentation" -> "Key Concepts in RL"
  const stem = host.split(".").slice(-2, -1)[0] ?? "";
  const title = cleanText(parsed?.title || doc.title || host)
    .split(/\s+[|—–-]\s+/)
    .filter((part, i, all) => i === 0 || !(all.length > 1 && i === all.length - 1 && (/documentation|docs|blog|wiki/i.test(part) || (stem && part.toLowerCase().replace(/\s/g, "").includes(stem)))))
    .join(" — ");
  // Readability often repeats the title as the first heading.
  if (blocks[0]?.t === "h" && blocks[0].text.toLowerCase() === title.toLowerCase()) blocks.shift();
  return {
    title,
    byline: cleanText([parsed?.byline, parsed?.siteName || host].filter(Boolean).join(" · ")),
    blocks,
    words: blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0),
  };
}

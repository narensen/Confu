"use client";

import { Children, cloneElement, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { sanitizeSvg } from "@confu/core/tutor/diagram";
import { repairMath } from "@confu/core/tutor/math-repair";
import { MermaidDiagram, SvgDiagram } from "./Diagram";

// Models emit typographic characters KaTeX has no glyphs for (e.g. the
// non-breaking hyphen in "positive‑definite"). They look identical as ASCII.
const TYPOGRAPHY: [RegExp, string][] = [
  [/[\u2010\u2011\u2012\u2043]/g, "-"], // hyphens
  [/[\u00a0\u2007\u202f\u2009\u200a\u205f]/g, " "], // no-break and thin spaces
  [/[\u200b\u2060\ufeff]/g, ""], // zero-width characters
];

// A fenced block with no language that is really an answer, not a program.
// Those were showing up as a code box, markup and all.
function looksLikeProse(text: string): boolean {
  const sample = text.trim();
  if (sample.length < 40 || /^\s*<svg\b/i.test(sample)) return false;
  const longWords = sample.split(/\s+/).filter((w) => /[A-Za-z]{4,}/.test(w)).length;
  return longWords >= 8;
}

// Models write <br> and wrap whole answers in a fence. Markdown leaves the
// tags on screen and draws the fence as code. Turn that into plain Markdown
// before it is rendered. Real code fences, and svg diagrams, are left alone.
const PROSE_LANG = /^(text|markdown|md|plaintext|plain|txt)$/i;

// A newline inside a Markdown table cell ends the table, so the later rows
// show up as raw pipes. This stands in for a line break and stays on the row.
const CELL_BREAK = "\uE000";

function isSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.trim());
}

function columns(line: string): number {
  const parts = line.split(/(?<!\\)\|/);
  if (line.trim().startsWith("|")) parts.shift();
  if (line.trim().endsWith("|")) parts.pop();
  return parts.length;
}

// |x| inside a cell is an absolute value, not a new column. Escape it so the
// row keeps the columns the header declared.
function escapeAbs(line: string): string {
  return line.replace(/(?<!\\)\|(?=\S)([^|\n]*?)(?<=\S)\|/g, (_, inner: string) => `\\|${inner}\\|`);
}

// Pull a cell's wrapped lines back onto its row. A line is part of the cell
// when the row is still short a column. A finished row, or a long paragraph
// after the table, is left alone.
function stitchTables(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].includes("|") || !isSeparator(lines[i + 1] ?? "")) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const cols = columns(lines[i + 1]);
    out.push(escapeAbs(lines[i]), lines[i + 1]);
    i += 2;
    while (i < lines.length && lines[i].trim()) {
      if (!/^\s*\|/.test(lines[i])) break;
      let row = escapeAbs(lines[i]);
      let extra = 0;
      i++;
      while (i < lines.length && lines[i].trim() && columns(row) < cols && extra < 24) {
        const next = escapeAbs(lines[i]);
        if (/^\s*\|/.test(next) && columns(next) >= cols) break;
        if (!next.includes("|") && next.trim().length > 180) break;
        row += CELL_BREAK + next.trim();
        extra++;
        i++;
      }
      out.push(row);
    }
  }
  return out.join("\n");
}

function flattenMath(src: string): string {
  const oneLine = (m: string) => m.replace(/[ \t]*[\n\uE000][ \t]*/g, " ").trim();
  return src
    .replace(/\$\$([\s\S]+?)\$\$/g, (full, m: string) => (m.includes("\u0000") ? full : `$$${oneLine(m)}$$`))
    .replace(/(^|[\s([{])\$(?!\$)([^$\n\uE000]*(?:[\n\uE000]+[^$\n\uE000]*)+)\$(?!\$)/g, (full, pre: string, m: string) =>
      /\n\s*\n/.test(m) || m.includes("\u0000") ? full : `${pre}$${oneLine(m)}$`,
    );
}

function tidyMarkup(md: string): string {
  const unfenced = md.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (full, lang: string, body: string) => {
    const name = lang.trim();
    if ((name && !PROSE_LANG.test(name)) || !looksLikeProse(body) || /^\s*<svg\b/i.test(body)) return full;
    return body.trim();
  });
  const fences: string[] = [];
  const stashed = unfenced.replace(/```[\s\S]*?```/g, (block) => {
    fences.push(block);
    return `\u0000F${fences.length - 1}\u0000`;
  });
  const tidied = stashed
    .replace(/&lt;\s*br\s*\/?\s*&gt;/gi, "\n")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n\n")
    .replace(/<\s*p\b[^>]*>/gi, "")
    .replace(/<\/?\s*(strong|b)\s*>/gi, "**")
    .replace(/<\/?\s*(em|i)\s*>/gi, "*")
    .replace(/<\/?\s*(u|span|div|font)\b[^>]*>/gi, "");
  return flattenMath(stitchTables(tidied)).replace(/\u0000F(\d+)\u0000/g, (_, i) => fences[Number(i)] ?? "");
}

function withBreaks(nodes: ReactNode): ReactNode {
  return Children.map(nodes, (child, index) => {
    if (typeof child === "string") {
      if (!child.includes(CELL_BREAK)) return child;
      const parts = child.split(CELL_BREAK);
      return (
        <span key={index}>
          {parts.map((part, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {part}
            </span>
          ))}
        </span>
      );
    }
    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children != null) {
      return cloneElement(child, { key: child.key ?? index }, withBreaks(child.props.children));
    }
    return child;
  });
}

// Models often emit \( \) and \[ \] math delimiters; remark-math only knows $ and $$.
// Then the characters KaTeX reserves (\text{#filters}, 95%) are escaped.
function normaliseMath(md: string): string {
  let text = tidyMarkup(md);
  for (const [pattern, replacement] of TYPOGRAPHY) text = text.replace(pattern, replacement);
  return repairMath(
    text
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `$$${m.replace(/[ \t]*\n[ \t]*/g, " ").trim()}$$`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$${m.replace(/[ \t]*\n[ \t]*/g, " ").trim()}$`),
  );
}

// Turn page citations like "(p. 12)", "pp. 4–6" or "D2 p. 12" into links that
// jump the viewer (switching PDFs when a label is given). Not inside a fence:
// a diagram that labels a box "p. 3" would stop parsing.
function linkPages(md: string): string {
  return md
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(
            /\b(?:(D\d{1,2})[,\s·]*)?(pp?\.)\s?(\d{1,4})(\s?[–-]\s?\d{1,4})?/g,
            (match, label: string | undefined, _p, start) => `[${match}](#cite-${label ?? ""}-${start})`,
          ),
    )
    .join("");
}

export const Markdown = memo(function Markdown({
  content,
  onPage,
  className = "prose-tutor",
  live = false,
}: {
  content: string;
  onPage?: (page: number, docLabel?: string) => void;
  className?: string;
  live?: boolean; // still being written: a diagram waits until it's whole
}) {
  return (
    <div className={`${className} min-w-0 max-w-full`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: "ignore", throwOnError: false }]]}
        components={{
          table({ children }) {
            return (
              <div className="tutor-table-scroll">
                <table>{children}</table>
              </div>
            );
          },
          // The cell's words sit in a box with a width cap, so a long cell
          // wraps instead of stretching the whole table.
          td({ children }) {
            return (
              <td>
                <div className="tutor-cell">{withBreaks(children)}</div>
              </td>
            );
          },
          th({ children }) {
            return (
              <th>
                <div className="tutor-cell">{withBreaks(children)}</div>
              </th>
            );
          },
          code({ className: codeClass, children }) {
            const text = String(children).replace(/\n$/, "");
            const lang = /language-([\w-]+)/.exec(codeClass || "")?.[1];
            const block = Boolean(codeClass) || text.includes("\n");
            if (block && lang === "mermaid") return <MermaidDiagram code={text} live={live} />;
            const drawing = lang === "svg" || ((lang === "xml" || lang === "html" || !lang) && /^\s*<svg\b/i.test(text));
            if (block && drawing) {
              const svg = sanitizeSvg(text);
              if (svg) return <SvgDiagram svg={svg} />;
            }
            // An indented answer, or a fence with no language, is not a program.
            if (block && (!lang || PROSE_LANG.test(lang)) && looksLikeProse(text)) return <code data-prose="">{text}</code>;
            if (!block && (!lang || PROSE_LANG.test(lang)) && looksLikeProse(text)) return <>{text}</>;
            return <code className={codeClass}>{children}</code>;
          },
          a({ href, children }) {
            const cite = href?.match(/^#cite-(D\d+)?-(\d+)$/);
            if (cite && onPage) {
              const page = Number(cite[2]);
              return (
                <button type="button" onClick={() => onPage(page, cite[1] || undefined)} className="rounded bg-paper px-1 font-mono text-[0.85em] font-medium underline decoration-ink/30 underline-offset-2 transition hover:bg-ink hover:text-white">
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {onPage ? linkPages(normaliseMath(content)) : normaliseMath(content)}
      </ReactMarkdown>
    </div>
  );
});

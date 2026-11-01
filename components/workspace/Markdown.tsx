"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { sanitizeSvg } from "@/lib/tutor/diagram";

// Models emit typographic characters KaTeX has no glyphs for (e.g. the
// non-breaking hyphen in "positive‑definite"). They look identical as ASCII.
const TYPOGRAPHY: [RegExp, string][] = [
  [/[\u2010\u2011\u2012\u2043]/g, "-"], // hyphens
  [/[\u00a0\u2007\u202f\u2009\u200a\u205f]/g, " "], // no-break and thin spaces
  [/[\u200b\u2060\ufeff]/g, ""], // zero-width characters
];

// Models often emit \( \) and \[ \] math delimiters; remark-math only knows $ and $$.
function normaliseMath(md: string): string {
  for (const [pattern, replacement] of TYPOGRAPHY) md = md.replace(pattern, replacement);
  return md
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`);
}

// Turn page citations like "(p. 12)", "pp. 4–6" or "D2 p. 12" into links that
// jump the viewer (switching PDFs when a label is given).
function linkPages(md: string): string {
  return md.replace(
    /\b(?:(D\d{1,2})[,\s·]*)?(pp?\.)\s?(\d{1,4})(\s?[–-]\s?\d{1,4})?/g,
    (match, label: string | undefined, _p, start) => `[${match}](#cite-${label ?? ""}-${start})`,
  );
}

export const Markdown = memo(function Markdown({
  content,
  onPage,
  className = "prose-tutor",
}: {
  content: string;
  onPage?: (page: number, docLabel?: string) => void;
  className?: string;
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
          code({ className: codeClass, children }) {
            const text = String(children).replace(/\n$/, "");
            const lang = /language-([\w-]+)/.exec(codeClass || "")?.[1];
            const block = Boolean(codeClass) || text.includes("\n");
            const drawing = lang === "svg" || ((lang === "xml" || lang === "html" || !lang) && /^\s*<svg\b/i.test(text));
            if (block && drawing) {
              const svg = sanitizeSvg(text);
              if (svg) return <SvgDiagram svg={svg} />;
            }
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

// Shown as an image, so a diagram cannot run script even if the sanitiser misses one.
function SvgDiagram({ svg }: { svg: string }) {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    <figure className="tutor-diagram">
      {/* eslint-disable-next-line @next/next/no-img-element -- data-URL SVG; an img will not run a script */}
      <img src={src} alt="Diagram" draggable={false} />
    </figure>
  );
}

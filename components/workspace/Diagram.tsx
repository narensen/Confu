"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Mermaid } from "mermaid";
import { quoteMermaidLabels, svgSize, tidyMermaid } from "@/lib/tutor/diagram";

// The tutor's diagrams. A ```mermaid block is laid out here (the boxes fit
// their labels, arrows route around them); a ```svg block is the tutor's own
// drawing, already made safe. Both are shown as an image at their own size,
// on a light card in either theme. Click one to see it larger.

type Picture = { src: string; width: number; height: number };

const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const INK = "#1a1a1a";

function toPicture(svg: string): Picture {
  const { width, height } = svgSize(svg);
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, width, height };
}

/* ------------------------------------------------------------- mermaid */

let loading: Promise<Mermaid> | null = null;

// Loaded the first time an answer has a diagram, not with the page.
function loadMermaid(): Promise<Mermaid> {
  loading ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      look: "classic",
      htmlLabels: false,
      fontFamily: FONT,
      themeVariables: {
        fontFamily: FONT,
        fontSize: "14px",
        background: "#f7f6f2",
        mainBkg: "#ffffff",
        primaryColor: "#ffffff",
        primaryBorderColor: INK,
        primaryTextColor: INK,
        secondaryColor: "#fdf3c4",
        secondaryBorderColor: INK,
        secondaryTextColor: INK,
        tertiaryColor: "#efede6",
        tertiaryBorderColor: "#b9b6ab",
        tertiaryTextColor: INK,
        nodeBorder: INK,
        lineColor: "#45443f",
        textColor: INK,
        titleColor: INK,
        clusterBkg: "#efede6",
        clusterBorder: "#c9c6bb",
        edgeLabelBackground: "#f7f6f2",
        noteBkgColor: "#fef3c7",
        noteBorderColor: "#c99a0e",
        noteTextColor: INK,
        actorBkg: "#ffffff",
        actorBorder: INK,
        actorTextColor: INK,
        signalColor: INK,
        signalTextColor: INK,
        labelBoxBkgColor: "#ffffff",
        labelBoxBorderColor: INK,
      },
      // An arrow's label sits on a solid patch of the card, so its line doesn't run through the words.
      themeCSS:
        ".node rect, .node circle, .node polygon, .node path { stroke-width: 1.5px; } .flowchart-link { stroke-width: 1.5px; } .edgeLabel rect, .edgeLabel .background { opacity: 1 !important; fill: #f7f6f2 !important; }",
      flowchart: { curve: "basis", nodeSpacing: 36, rankSpacing: 44, padding: 14, diagramPadding: 12, useMaxWidth: false },
      sequence: { useMaxWidth: false, width: 120, actorMargin: 32, boxMargin: 8, messageMargin: 30, mirrorActors: false, wrap: true },
      state: { useMaxWidth: false },
      class: { useMaxWidth: false },
      mindmap: { useMaxWidth: false },
      timeline: { useMaxWidth: false },
    });
    return mermaid;
  });
  return loading;
}

// The drawing at the size it was laid out at, not stretched to the column.
function atOwnSize(svg: string): string {
  const { width, height } = svgSize(svg);
  return svg.replace(/^<svg\b[^>]*>/i, (open) =>
    open
      .replace(/\s(?:width|height)="[^"]*"/g, "")
      .replace(/\sstyle="[^"]*"/, "")
      .replace(/^<svg\b/i, `<svg width="${width}" height="${height}"`),
  );
}

let serial = 0;
const drawn = new Map<string, Picture | "failed">();

// A long chain drawn left to right is too wide for the tutor's column. Past
// this width it is drawn top to bottom instead, if that is narrower.
const TOO_WIDE = 720;
const ACROSS = /^(\s*(?:flowchart|graph))\s+(?:LR|RL)\b/im;

async function draw(code: string): Promise<Picture | "failed"> {
  const mermaid = await loadMermaid();
  const tidy = tidyMermaid(code);
  // As written, then with every label quoted (the usual syntax slip).
  for (const attempt of new Set([tidy, quoteMermaidLabels(tidy)])) {
    try {
      if (!(await mermaid.parse(attempt, { suppressErrors: true }))) continue;
      const { svg } = await mermaid.render(`confu-diagram-${++serial}`, attempt);
      const picture = toPicture(atOwnSize(svg));
      if (picture.width <= TOO_WIDE || !ACROSS.test(attempt)) return picture;
      try {
        const { svg: down } = await mermaid.render(`confu-diagram-${++serial}`, attempt.replace(ACROSS, "$1 TD"));
        const tall = toPicture(atOwnSize(down));
        return tall.width < picture.width ? tall : picture;
      } catch {
        return picture;
      }
    } catch {
      // Try the next one.
    }
  }
  return "failed";
}

function remember(code: string, picture: Picture | "failed") {
  if (drawn.size > 80) drawn.delete(drawn.keys().next().value!);
  drawn.set(code, picture);
}

export function MermaidDiagram({ code, live = false }: { code: string; live?: boolean }) {
  const [result, setResult] = useState<{ code: string; picture: Picture | "failed" } | null>(null);
  const picture = drawn.get(code) ?? (result?.code === code ? result.picture : undefined);

  // Drawn once the answer has finished: half a diagram doesn't parse.
  useEffect(() => {
    if (live || drawn.has(code)) return;
    let gone = false;
    void draw(code).then((p) => {
      remember(code, p);
      if (!gone) setResult({ code, picture: p });
    });
    return () => {
      gone = true;
    };
  }, [code, live]);

  if (!picture) {
    return (
      <figure className="tutor-diagram tutor-diagram-pending" aria-busy="true">
        <span>Drawing the diagram…</span>
      </figure>
    );
  }
  if (picture === "failed") return <DiagramFailed code={code} />;
  return <DiagramFigure picture={picture} />;
}

function DiagramFailed({ code }: { code: string }) {
  return (
    <figure className="tutor-diagram tutor-diagram-failed">
      <p>This diagram couldn&apos;t be drawn. Ask the tutor to draw it again.</p>
      <details>
        <summary>What the tutor wrote</summary>
        <pre>{code}</pre>
      </details>
    </figure>
  );
}

/* ----------------------------------------------------------------- svg */

export function SvgDiagram({ svg }: { svg: string }) {
  return <DiagramFigure picture={toPicture(svg)} />;
}

/* -------------------------------------------------------------- figure */

function DiagramFigure({ picture }: { picture: Picture }) {
  const [open, setOpen] = useState(false);
  // Its own size. Narrower only to fit the column, down to three quarters,
  // then the card scrolls sideways instead of shrinking the labels further.
  const style = { width: picture.width, maxWidth: `max(100%, ${Math.round(picture.width * 0.75)}px)` };
  return (
    <>
      <figure className="tutor-diagram">
        <button type="button" onClick={() => setOpen(true)} title="See it larger" className="tutor-diagram-open">
          {/* eslint-disable-next-line @next/next/no-img-element -- data-URL SVG; an img will not run a script */}
          <img src={picture.src} alt="Diagram" width={picture.width} height={picture.height} style={style} draggable={false} />
        </button>
      </figure>
      {open && <DiagramViewer picture={picture} onClose={() => setOpen(false)} />}
    </>
  );
}

// Larger, over everything: as big as the screen allows, up to twice its size.
function DiagramViewer({ picture, onClose }: { picture: Picture; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const ratio = picture.width / picture.height;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Diagram"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      className="animate-fade fixed inset-0 z-[75] flex items-center justify-center bg-scrim p-4 backdrop-blur-[2px] sm:p-8"
    >
      <div className="animate-pop relative max-h-full max-w-full overflow-auto rounded-2xl border border-ink bg-[#f7f6f2] p-5 shadow-hard sm:p-7">
        {/* eslint-disable-next-line @next/next/no-img-element -- data-URL SVG; an img will not run a script */}
        <img
          src={picture.src}
          alt="Diagram"
          draggable={false}
          className="block h-auto"
          style={{ width: `min(${Math.round(picture.width * 2)}px, calc(100vw - 7rem), calc((100vh - 7rem) * ${ratio.toFixed(4)}))` }}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          autoFocus
          className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-md text-[#5c5b55] transition hover:bg-black/5 hover:text-[#1a1a1a]"
        >
          ✕
        </button>
      </div>
    </div>,
    document.body,
  );
}

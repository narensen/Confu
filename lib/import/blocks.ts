// Imported material (lecture transcripts, the sample) is
// described as blocks, then typeset into a PDF in the browser (build-pdf.ts)
// so it flows through the same pipeline as an uploaded PDF: text extraction,
// search, highlights, contents, plans, the tutor and spaced review.

export type Block =
  | { t: "h"; level: 1 | 2 | 3; text: string; link?: string } // link: e.g. the video at this timestamp
  | { t: "p"; text: string }
  | { t: "li"; text: string; n?: number } // n: number for an ordered list item
  | { t: "code"; text: string }
  | { t: "quote"; text: string }
  | { t: "note"; text: string }; // small print, e.g. "[Figure: …]"

export type Chapter = { title: string; url?: string; byline?: string; blocks: Block[] };

export type DocumentSpec = {
  kind: string; // eyebrow on the first page, e.g. "YouTube lecture"
  title: string;
  byline?: string;
  sourceUrl?: string;
  chapters: Chapter[];
};

// "754" -> "12:34", "3725" -> "1:02:05"
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// Text safe to typeset: no control characters, collapsed spaces.
export function cleanText(s: string) {
  return s
    .replace(/­/g, "") // soft hyphens
    .replace(/[   ]/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function blocksWords(chapters: Chapter[]) {
  return chapters.reduce((n, c) => n + c.blocks.reduce((m, b) => m + b.text.split(/\s+/).length, 0), 0);
}

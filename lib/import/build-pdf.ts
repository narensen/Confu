// Typeset imported material (blocks.ts) into a clean, searchable PDF with a
// real table of contents, using pdf-lib and embedded Noto fonts (subsetted, so
// a PDF only carries the characters it uses). Runs in the browser; the font
// loader is injectable so the same code can be tested in Node.

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFHexString, PDFName, PDFString, rgb, type PDFFont, type PDFPage, type PDFRef } from "pdf-lib";
import { cleanText, type Block, type DocumentSpec } from "./blocks";

type FontName = "regular" | "bold" | "italic" | "mono" | "math";
const FONT_FILES: Record<FontName, string> = {
  regular: "NotoSerif-Regular.ttf",
  bold: "NotoSerif-Bold.ttf",
  italic: "NotoSerif-Italic.ttf",
  mono: "NotoSansMono-Regular.ttf",
  math: "NotoSansMath-Regular.ttf",
};

export type FontLoader = (file: string) => Promise<Uint8Array>;
const browserFonts: FontLoader = async (file) => new Uint8Array(await (await fetch(`/fonts/${file}`)).arrayBuffer());

const PAGE = { w: 595.28, h: 841.89 }; // A4
const M = { left: 68, right: 68, top: 70, bottom: 74 };
const WIDTH = PAGE.w - M.left - M.right;
const INK = rgb(0.1, 0.1, 0.094);
const MUTED = rgb(0.4, 0.4, 0.38);
const RULE = rgb(0.86, 0.86, 0.84);
const CODE_BG = rgb(0.955, 0.955, 0.94);
const ACCENT = rgb(0.99, 0.85, 0.21);
const MAX_PAGES = 600;

type Run = { text: string; font: PDFFont };
type OutlineEntry = { title: string; level: 0 | 1; page: PDFPage; y: number };

class Typesetter {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  outline: OutlineEntry[] = [];

  constructor(
    private doc: PDFDocument,
    private fonts: Record<FontName, PDFFont>,
    private glyphs: Record<FontName, { hasGlyphForCodePoint(cp: number): boolean }>,
  ) {}

  newPage() {
    if (this.pages.length >= MAX_PAGES) throw new Error("That's too long to import (over 600 pages). Try fewer pages.");
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.pages.push(this.page);
    this.y = PAGE.h - M.top;
  }

  ensure(height: number) {
    if (this.y - height < M.bottom) this.newPage();
  }

  // Split text into runs a font can draw: the main font, else the maths font,
  // else mono; characters nobody has become "?".
  runs(text: string, main: FontName): Run[] {
    const out: Run[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      const name: FontName | null = this.glyphs[main].hasGlyphForCodePoint(cp)
        ? main
        : this.glyphs.math.hasGlyphForCodePoint(cp)
          ? "math"
          : this.glyphs.mono.hasGlyphForCodePoint(cp)
            ? "mono"
            : null;
      const font = this.fonts[name ?? main];
      const t = name ? ch : "?";
      const last = out[out.length - 1];
      if (last && last.font === font) last.text += t;
      else out.push({ text: t, font });
    }
    return out;
  }

  width(runs: Run[], size: number) {
    return runs.reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);
  }

  // Greedy word wrap; very long words (URLs, code) break by character.
  wrap(text: string, main: FontName, size: number, width: number): Run[][] {
    const lines: Run[][] = [];
    let line: Run[] = [];
    let lineW = 0;
    const space = this.fonts[main].widthOfTextAtSize(" ", size);
    const push = () => {
      lines.push(line);
      line = [];
      lineW = 0;
    };
    for (const word of text.split(/\s+/).filter(Boolean)) {
      let parts = this.runs(word, main);
      let w = this.width(parts, size);
      if (w > width) {
        // Break a too-long word into chunks that fit.
        let chunk = "";
        for (const ch of word) {
          if (this.width(this.runs(chunk + ch, main), size) > width && chunk) {
            if (line.length) push();
            line = this.runs(chunk, main);
            push();
            chunk = "";
          }
          chunk += ch;
        }
        parts = this.runs(chunk, main);
        w = this.width(parts, size);
      }
      if (line.length && lineW + space + w > width) push();
      if (line.length) {
        line.push({ text: " ", font: this.fonts[main] });
        lineW += space;
      }
      line.push(...parts);
      lineW += w;
    }
    if (line.length) push();
    return lines;
  }

  drawRuns(runs: Run[], x: number, y: number, size: number, color = INK) {
    let cx = x;
    for (const r of runs) {
      this.page.drawText(r.text, { x: cx, y, size, font: r.font, color });
      cx += r.font.widthOfTextAtSize(r.text, size);
    }
    return cx;
  }

  paragraph(text: string, opts: { font?: FontName; size?: number; leading?: number; indent?: number; after?: number; color?: ReturnType<typeof rgb> } = {}) {
    const font = opts.font ?? "regular";
    const size = opts.size ?? 10.5;
    const leading = opts.leading ?? size * 1.5;
    const indent = opts.indent ?? 0;
    for (const line of this.wrap(cleanText(text), font, size, WIDTH - indent)) {
      this.ensure(leading);
      this.y -= leading;
      this.drawRuns(line, M.left + indent, this.y + (leading - size) / 2, size, opts.color);
    }
    this.y -= opts.after ?? 7;
  }

  link(x1: number, y1: number, x2: number, y2: number, url: string) {
    const annot = this.doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x1, y1, x2, y2],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    });
    this.page.node.addAnnot(this.doc.context.register(annot));
  }

  heading(text: string, level: 1 | 2 | 3, outlineLevel: 0 | 1 | null, link?: string) {
    const size = level === 1 ? 19 : level === 2 ? 14 : 11.5;
    const before = level === 1 ? 18 : level === 2 ? 14 : 10;
    const lines = this.wrap(cleanText(text), "bold", size, WIDTH - (link ? 22 : 0));
    // Keep a heading with at least two lines of what follows.
    this.ensure(before + lines.length * size * 1.3 + 32);
    if (this.y < PAGE.h - M.top - 1) this.y -= before;
    if (outlineLevel !== null) this.outline.push({ title: cleanText(text), level: outlineLevel, page: this.page, y: Math.min(PAGE.h, this.y + 12) });
    const top = this.y;
    for (const line of lines) {
      this.y -= size * 1.3;
      const end = this.drawRuns(line, M.left, this.y + size * 0.15, size);
      if (link && line === lines[0]) {
        // A small play mark after the first line; the whole heading links.
        this.page.drawText("↗", { x: end + 6, y: this.y + size * 0.15, size: size * 0.8, font: this.fonts.math, color: MUTED });
      }
    }
    if (link) this.link(M.left, this.y, M.left + WIDTH, top, link);
    this.y -= 6;
  }

  block(b: Block, outlineFor: (level: 1 | 2 | 3) => 0 | 1 | null) {
    switch (b.t) {
      case "h":
        return this.heading(b.text, b.level, outlineFor(b.level), b.link);
      case "p":
        return this.paragraph(b.text);
      case "li": {
        const marker = b.n ? `${b.n}.` : "•";
        const lines = this.wrap(cleanText(b.text), "regular", 10.5, WIDTH - 18);
        lines.forEach((line, i) => {
          this.ensure(15.5);
          this.y -= 15.5;
          if (i === 0) this.page.drawText(marker, { x: M.left + 2, y: this.y + 2.6, size: 10.5, font: this.fonts.regular, color: MUTED });
          this.drawRuns(line, M.left + 18, this.y + 2.6, 10.5);
        });
        this.y -= 3;
        return;
      }
      case "quote": {
        const startPage = this.page;
        const top = this.y;
        this.paragraph(b.text, { font: "italic", indent: 14, after: 4, color: rgb(0.2, 0.2, 0.19) });
        if (this.page === startPage) this.page.drawLine({ start: { x: M.left + 3, y: top - 3 }, end: { x: M.left + 3, y: this.y + 6 }, thickness: 2, color: ACCENT });
        this.y -= 4;
        return;
      }
      case "note":
        return this.paragraph(b.text, { font: "italic", size: 9, color: MUTED, after: 6 });
      case "code": {
        const size = 8.6;
        const leading = 12.4;
        // Monospace: keep every space, break long lines at a fixed width.
        const perLine = Math.max(20, Math.floor((WIDTH - 16) / this.fonts.mono.widthOfTextAtSize("M", size)));
        const lines = b.text
          .replace(/\t/g, "    ")
          .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
          .split("\n")
          .flatMap((l) => {
            const chars = [...l.replace(/\s+$/, "")];
            if (!chars.length) return [[] as Run[]];
            const out: Run[][] = [];
            for (let i = 0; i < chars.length; i += perLine) out.push(this.runs(chars.slice(i, i + perLine).join(""), "mono"));
            return out;
          });
        this.y -= 4;
        let i = 0;
        while (i < lines.length) {
          // Draw the background per page-sized chunk.
          const room = Math.max(1, Math.floor((this.y - M.bottom - 12) / leading));
          if (room < 2 && i === 0) {
            this.newPage();
            continue;
          }
          const chunk = lines.slice(i, i + room);
          const h = chunk.length * leading + 10;
          this.page.drawRectangle({ x: M.left, y: this.y - h, width: WIDTH, height: h, color: CODE_BG });
          this.y -= 5;
          for (const line of chunk) {
            this.y -= leading;
            this.drawRuns(line, M.left + 8, this.y + 3, size);
          }
          this.y -= 5;
          i += chunk.length;
          if (i < lines.length) this.newPage();
        }
        this.y -= 8;
        return;
      }
    }
  }

  footers(source: string) {
    const n = this.pages.length;
    this.pages.forEach((p, i) => {
      p.drawLine({ start: { x: M.left, y: M.bottom - 24 }, end: { x: PAGE.w - M.right, y: M.bottom - 24 }, thickness: 0.5, color: RULE });
      const label = source.length > 80 ? `${source.slice(0, 78)}…` : source;
      const runs = this.runs(label, "mono");
      let x = M.left;
      for (const r of runs) {
        p.drawText(r.text, { x, y: M.bottom - 38, size: 7.5, font: r.font, color: MUTED });
        x += r.font.widthOfTextAtSize(r.text, 7.5);
      }
      const num = `${i + 1} / ${n}`;
      p.drawText(num, { x: PAGE.w - M.right - this.fonts.mono.widthOfTextAtSize(num, 7.5), y: M.bottom - 38, size: 7.5, font: this.fonts.mono, color: MUTED });
    });
  }

  // PDF bookmarks (two levels) from the headings, so Contents and the goal
  // starters' chapter picker work on imported material.
  writeOutline() {
    if (!this.outline.length) return;
    const ctx = this.doc.context;
    const rootRef = ctx.nextRef();
    type Node = { entry: OutlineEntry; ref: PDFRef; children: { entry: OutlineEntry; ref: PDFRef }[] };
    const tops: Node[] = [];
    for (const e of this.outline) {
      if (e.level === 0 || !tops.length) tops.push({ entry: e, ref: ctx.nextRef(), children: [] });
      else tops[tops.length - 1].children.push({ entry: e, ref: ctx.nextRef() });
    }
    const dest = (e: OutlineEntry) => ctx.obj([e.page.ref, "XYZ", null, e.y, null]);
    const assign = (list: { entry: OutlineEntry; ref: PDFRef }[], parent: PDFRef, kids?: (i: number) => Record<string, unknown>) =>
      list.forEach((item, i) => {
        const dict: Record<string, unknown> = { Title: PDFHexString.fromText(item.entry.title.slice(0, 200)), Parent: parent, Dest: dest(item.entry) };
        if (i > 0) dict.Prev = list[i - 1].ref;
        if (i < list.length - 1) dict.Next = list[i + 1].ref;
        Object.assign(dict, kids?.(i) ?? {});
        ctx.assign(item.ref, ctx.obj(dict as never));
      });
    assign(tops, rootRef, (i) => {
      const c = tops[i].children;
      if (!c.length) return {};
      assign(c, tops[i].ref);
      return { First: c[0].ref, Last: c[c.length - 1].ref, Count: -c.length }; // collapsed
    });
    ctx.assign(rootRef, ctx.obj({ Type: "Outlines", First: tops[0].ref, Last: tops[tops.length - 1].ref, Count: tops.length }));
    this.doc.catalog.set(PDFName.of("Outlines"), rootRef);
  }
}

export async function buildPdf(spec: DocumentSpec, loadFont: FontLoader = browserFonts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const names = Object.keys(FONT_FILES) as FontName[];
  const bytes = await Promise.all(names.map((n) => loadFont(FONT_FILES[n])));
  const glyphs = {} as Record<FontName, { hasGlyphForCodePoint(cp: number): boolean }>;
  names.forEach((n, i) => (glyphs[n] = fontkit.create(bytes[i]) as unknown as { hasGlyphForCodePoint(cp: number): boolean }));

  // Embed whole fonts (pdf-lib's subsetting drops glyphs with these fonts),
  // but only the ones this document uses: italic for quotes and notes, mono
  // for code, the maths font for symbols the serif lacks.
  const blocks = spec.chapters.flatMap((c) => c.blocks);
  const allText = [spec.title, spec.byline ?? "", ...spec.chapters.map((c) => c.title), ...blocks.map((b) => b.text)].join("\n");
  const needs = new Set<FontName>(["regular", "bold"]);
  if (blocks.some((b) => b.t === "quote" || b.t === "note")) needs.add("italic");
  if (blocks.some((b) => b.t === "code") || spec.sourceUrl) needs.add("mono");
  for (const ch of allText) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0x7f && !glyphs.regular.hasGlyphForCodePoint(cp)) {
      needs.add("math");
      if (!glyphs.math.hasGlyphForCodePoint(cp)) needs.add("mono");
    }
  }
  if (blocks.some((b) => b.t === "h" && b.link) || (spec.chapters.length > 1 && spec.chapters.some((c) => c.url))) needs.add("math"); // the ↗ mark
  const fonts = {} as Record<FontName, PDFFont>;
  for (const [i, n] of names.entries()) if (needs.has(n)) fonts[n] = await doc.embedFont(bytes[i], { subset: false });
  // Unused slots fall back to regular (glyph checks still use the real fonts).
  for (const n of names) fonts[n] ??= fonts.regular;
  for (const n of names) if (!needs.has(n)) glyphs[n] = glyphs.regular;

  doc.setTitle(cleanText(spec.title).slice(0, 300));
  if (spec.byline) doc.setAuthor(cleanText(spec.byline).slice(0, 200));
  if (spec.sourceUrl) doc.setSubject(spec.sourceUrl);
  doc.setCreator("Confu");
  doc.setProducer("Confu import");

  const ts = new Typesetter(doc, fonts, glyphs);
  ts.newPage();

  // Title block
  ts.paragraph(spec.kind.toUpperCase(), { font: "mono", size: 8, leading: 12, color: MUTED, after: 4 });
  ts.paragraph(spec.title, { font: "bold", size: 24, leading: 30, after: 6 });
  if (spec.byline) ts.paragraph(spec.byline, { size: 10, color: MUTED, after: 2 });
  if (spec.sourceUrl) {
    const top = ts.y;
    ts.paragraph(spec.sourceUrl, { font: "mono", size: 8, leading: 12, color: MUTED, after: 2 });
    ts.link(M.left, ts.y, M.left + WIDTH, top, spec.sourceUrl);
  }
  ts.y -= 10;
  ts.page.drawRectangle({ x: M.left, y: ts.y, width: 36, height: 3, color: ACCENT });
  ts.y -= 18;

  const multi = spec.chapters.length > 1;
  spec.chapters.forEach((chapter, ci) => {
    if (multi) {
      if (ci > 0) ts.newPage();
      ts.heading(chapter.title, 1, 0, chapter.url);
      if (chapter.byline) ts.paragraph(chapter.byline, { size: 9.5, color: MUTED, after: 8 });
    }
    // Courses: chapters are level 0, their sections level 1. One page or a
    // transcript: its sections are level 0, subsections level 1.
    const outlineFor = (level: 1 | 2 | 3): 0 | 1 | null =>
      multi ? (level <= 2 ? 1 : null) : level <= 2 ? 0 : level === 3 ? 1 : null;
    for (const b of chapter.blocks) ts.block(b, outlineFor);
  });

  ts.footers(spec.sourceUrl ?? spec.title);
  ts.writeOutline();
  return doc.save();
}

export async function buildPdfFile(spec: DocumentSpec, loadFont?: FontLoader): Promise<File> {
  const bytes = await buildPdf(spec, loadFont);
  const name = `${cleanText(spec.title).replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80).trim() || "Imported"}.pdf`;
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

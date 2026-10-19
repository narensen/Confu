"use client";

import { pdfjs } from "react-pdf";
import type { OutlineItem } from "@/lib/types";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type PDFDocument = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
type RawOutline = Awaited<ReturnType<PDFDocument["getOutline"]>>;

// Postgres text cannot hold NUL bytes, and PDFs sometimes contain them.
const clean = (s: string) => s.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();

async function resolveOutline(pdf: PDFDocument, items: RawOutline, level = 0, out: OutlineItem[] = []) {
  for (const item of items ?? []) {
    if (out.length >= 300) break;
    try {
      const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
      const ref = dest?.[0];
      if (ref && typeof ref === "object") {
        const index = await pdf.getPageIndex(ref as Parameters<PDFDocument["getPageIndex"]>[0]);
        out.push({ title: item.title.trim(), page: index + 1, level });
      } else if (typeof ref === "number") {
        out.push({ title: item.title.trim(), page: ref + 1, level });
      }
    } catch {
      // Broken destinations are common; skip them.
    }
    if (item.items?.length) await resolveOutline(pdf, item.items, level + 1, out);
  }
  return out;
}

// Extract per-page text (the tutor's grounding) and the outline (the
// planner's table of contents) in the browser, before upload.
export async function extractPdf(file: File, onProgress?: (done: number, total: number) => void) {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if ("str" in item) text += item.str + (item.hasEOL ? "\n" : item.str.endsWith(" ") ? "" : " ");
    }
    pages.push(clean(text));
    page.cleanup();
    onProgress?.(i, pdf.numPages);
  }
  const outline = await resolveOutline(pdf, await pdf.getOutline()).catch(() => []);
  const pageCount = pdf.numPages;
  await task.destroy();
  return { pageCount, pages, outline };
}

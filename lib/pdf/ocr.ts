"use client";

import { pdfjs } from "react-pdf";
import { readAiError, JSON_HEADERS } from "@/lib/ai-errors";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

// A page with less text than this is treated as scanned.
export const SCANNED_BELOW_CHARS = 25;
const MAX_PAGES = 150;
const PARALLEL = 3;
const TARGET_WIDTH = 1400;

// Read scanned pages with the vision model, a few at a time, so they become
// searchable and citable. Best-effort: a page that fails stays empty, and a
// missing key or exhausted allowance stops the run (the rest stay empty too).
export async function ocrPages(
  file: File,
  documentId: string,
  pageNumbers: number[],
  onProgress: (done: number, total: number) => void,
): Promise<{ read: number; stopped: string | null }> {
  const todo = pageNumbers.slice(0, MAX_PAGES);
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  let next = 0;
  let done = 0;
  let read = 0;
  let stopped: string | null = null;

  async function render(n: number) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2.5, TARGET_WIDTH / base.width) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    page.cleanup();
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  async function worker() {
    while (!stopped && next < todo.length) {
      const n = todo[next++];
      try {
        const res = await fetch("/api/ocr", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ documentId, page: n, image: await render(n) }),
        });
        if (res.ok) read++;
        // No key, or the daily limit / allowance is used up: no point going on.
        else if (res.status === 428 || res.status === 429 || res.status === 503) stopped = await readAiError(res);
      } catch {
        // Skip this page.
      }
      onProgress(++done, todo.length);
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
  } finally {
    await task.destroy();
  }
  return { read, stopped };
}

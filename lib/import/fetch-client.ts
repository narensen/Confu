"use client";

import { JSON_HEADERS } from "@/lib/ai-errors";
import type { Block } from "@/lib/import/blocks";
import { buildPdfFile } from "@/lib/import/build-pdf";

// Turning a web page, a whole course or a YouTube lecture into a PDF, in the
// browser: the server fetches and cleans up the text, the browser typesets it.
// Shared by "+ Add material" and by copying a study pack.

export type Fetched = { file: File; title: string; sourceUrl: string | null; meta: Record<string, unknown> };
export type Article = { kind: "article"; url: string; title: string; byline: string; blocks: Block[]; words: number };
export type CourseLinks = { kind: "links"; url: string; title: string; links: { url: string; title: string; inCourse: boolean }[] };
export const MAX_COURSE_PAGES = 40;

// The site turned Confu away (a bot check or a login): offer pasting instead.
export class BlockedError extends Error {}

export async function webError(res: Response) {
  const body = (await res.json().catch(() => ({}))) as { error?: string; blocked?: boolean };
  const message = body.error ?? `Request failed (${res.status}).`;
  return body.blocked ? new BlockedError(message) : new Error(message);
}

export async function fetchArticle(url: string): Promise<Article | { pdf: File }> {
  const res = await fetch("/api/import/web", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ url, mode: "page" }) });
  if (!res.ok) throw await webError(res);
  if (res.headers.get("content-type")?.includes("application/pdf")) {
    const name = decodeURIComponent(res.headers.get("x-confu-filename") ?? "document.pdf");
    return { pdf: new File([await res.blob()], name.endsWith(".pdf") ? name : `${name}.pdf`, { type: "application/pdf" }) };
  }
  return (await res.json()) as Article;
}

export async function courseLinks(url: string): Promise<CourseLinks> {
  const res = await fetch("/api/import/web", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ url, mode: "links" }) });
  if (!res.ok) throw await webError(res);
  return (await res.json()) as CourseLinks;
}

export async function webPagePdf(url: string, onStatus: (s: string) => void = () => {}): Promise<Fetched> {
  onStatus("Reading the page…");
  const got = await fetchArticle(url);
  if ("pdf" in got) return { file: got.pdf, title: got.pdf.name.replace(/\.pdf$/i, ""), sourceUrl: url, meta: { source: "web" } };
  onStatus(`Typesetting “${got.title}”…`);
  const file = await buildPdfFile({ kind: "Web page", title: got.title, byline: got.byline, sourceUrl: got.url, chapters: [{ title: got.title, blocks: got.blocks }] });
  return { file, title: got.title, sourceUrl: got.url, meta: { source: "web", words: got.words } };
}

// A course or docs site: the given pages (or the course's own list), one chapter each.
export async function coursePdf(
  o: { url: string; title?: string; pages?: { url: string; title: string }[] },
  onStatus: (s: string) => void = () => {},
): Promise<Fetched & { failed: string[] }> {
  let pages = o.pages;
  let name = o.title;
  if (!pages?.length) {
    onStatus("Finding the course's pages…");
    const found = await courseLinks(o.url);
    pages = found.links.filter((l) => l.inCourse).slice(0, MAX_COURSE_PAGES);
    name ||= found.title.split(/\s+[|—–-]\s+/)[0];
  }
  const chapters: { title: string; url: string; blocks: Block[] }[] = [];
  const failed: string[] = [];
  for (const [i, p] of pages.entries()) {
    onStatus(`Reading ${i + 1} of ${pages.length}: ${p.title}`);
    try {
      const got = await fetchArticle(p.url);
      if ("pdf" in got) failed.push(`${p.title} (a PDF; add it separately)`);
      else chapters.push({ title: p.title || got.title, url: got.url, blocks: got.blocks });
    } catch (err) {
      failed.push(`${p.title}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  if (!chapters.length) throw new Error(`None of the course's pages could be read.\n${failed.join("\n")}`);
  onStatus(`Typesetting ${chapters.length} pages…`);
  const title = name || "Course";
  const host = new URL(o.url).hostname.replace(/^www\./, "");
  const file = await buildPdfFile({ kind: "Web course", title, byline: `${host} · ${chapters.length} pages`, sourceUrl: o.url, chapters });
  // The chapter list is kept, so a shared study pack can fetch the same pages.
  const links = chapters.map((c) => ({ url: c.url, title: c.title }));
  return { file, title, sourceUrl: o.url, meta: { source: "web_course", pages: chapters.length, links }, failed };
}

export class TranscriptError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function lecturePdf(o: { url: string; transcript?: string; title?: string }, onStatus: (s: string) => void = () => {}): Promise<Fetched> {
  onStatus(o.transcript ? "Reading the transcript…" : "Fetching the lecture's transcript…");
  const res = await fetch("/api/import/youtube", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ url: o.url, ...(o.transcript ? { transcript: o.transcript, title: o.title || undefined } : {}) }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new TranscriptError(j.error ?? "Couldn't import that lecture.", j.code);
  }
  const got = (await res.json()) as { title: string; byline: string; sourceUrl?: string; blocks: Block[]; automatic: boolean };
  onStatus(`Typesetting “${got.title}”…`);
  const file = await buildPdfFile({ kind: "YouTube lecture", title: got.title, byline: got.byline, sourceUrl: got.sourceUrl, chapters: [{ title: got.title, blocks: got.blocks }] });
  return { file, title: got.title, sourceUrl: got.sourceUrl ?? null, meta: { source: "youtube", automatic_captions: got.automatic } };
}

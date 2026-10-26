"use client";

import { JSON_HEADERS } from "@/lib/ai-errors";
import type { Block } from "@/lib/import/blocks";
import { buildPdfFile } from "@/lib/import/build-pdf";

// Turning a web page, a whole course or a YouTube lecture into a PDF, in the
// browser: the server fetches and cleans up the text, the browser typesets it.
// Shared by "+ Add material" and by copying a study pack.

export type Fetched = { file: File; title: string; sourceUrl: string | null; meta: Record<string, unknown> };
export type Article = { kind: "article"; url: string; title: string; byline: string; blocks: Block[]; words: number };

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

export async function webPagePdf(url: string, onStatus: (s: string) => void = () => {}): Promise<Fetched> {
  onStatus("Reading the page…");
  const got = await fetchArticle(url);
  if ("pdf" in got) return { file: got.pdf, title: got.pdf.name.replace(/\.pdf$/i, ""), sourceUrl: url, meta: { source: "web" } };
  onStatus(`Typesetting “${got.title}”…`);
  const file = await buildPdfFile({ kind: "Web page", title: got.title, byline: got.byline, sourceUrl: got.url, chapters: [{ title: got.title, blocks: got.blocks }] });
  return { file, title: got.title, sourceUrl: got.url, meta: { source: "web", words: got.words } };
}

export class TranscriptError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export type PlaylistLecture = { id: string; title: string; seconds: number };

// A YouTube playlist's lectures, to pick which to import.
export async function playlistLectures(url: string): Promise<{ title: string; author: string; videos: PlaylistLecture[] }> {
  const res = await fetch("/api/import/youtube", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ url, mode: "playlist" }) });
  const j = (await res.json().catch(() => ({}))) as { title?: string; author?: string; videos?: PlaylistLecture[]; error?: string };
  if (!res.ok || !j.videos) throw new Error(j.error ?? "Couldn't open that playlist.");
  return { title: j.title ?? "Playlist", author: j.author ?? "", videos: j.videos };
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

"use client";

import { JSON_HEADERS } from "@/lib/ai-errors";
import type { Block } from "@/lib/import/blocks";
import { buildPdfFile } from "@/lib/import/build-pdf";

// Turning a YouTube lecture into a PDF, in the browser: the server fetches
// the transcript, the browser typesets it. Shared by "+ Add material" and by
// copying a study pack. (Web pages aren't fetched: the student prints them
// to PDF, which keeps their diagrams.)

export type Fetched = { file: File; title: string; sourceUrl: string | null; meta: Record<string, unknown> };

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

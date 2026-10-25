import "server-only";
import { cleanText, clock, type Block } from "./blocks";

// YouTube lectures -> a timestamped transcript. Uses the captions YouTube
// already has (made by the creator, or automatic). Each section links back to
// that moment in the video; the video's own chapters are used when it has them.

export class YouTubeError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "NO_CAPTIONS" | "BLOCKED",
  ) {
    super(message);
  }
}

export type Segment = { start: number; text: string };
export type Lecture = { id: string; title: string; author: string; lengthSeconds: number; description: string; segments: Segment[]; language: string | null; automatic: boolean };

export function videoIdFrom(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
    if (host === "youtu.be") return /^[\w-]{11}/.exec(u.pathname.slice(1))?.[0] ?? null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      return /^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname)?.[1] ?? null;
    }
  } catch {}
  return null;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function parseCaptions(xml: string): Segment[] {
  const out: Segment[] = [];
  // Format 3: <p t="4220" d="1180">text</p>; older: <text start="4.22" dur="1.18">text</text>
  for (const m of xml.matchAll(/<p t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) out.push({ start: Number(m[1]) / 1000, text: decode(m[2]) });
  if (!out.length) for (const m of xml.matchAll(/<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) out.push({ start: Number(m[1]), text: decode(m[2]) });
  return out.map((s) => ({ start: s.start, text: cleanText(s.text.replace(/\n/g, " ")) })).filter((s) => s.text && !/^\[(music|applause|laughter)\]$/i.test(s.text));
}

export async function fetchLecture(id: string): Promise<Lecture> {
  // The Android app's player endpoint returns caption tracks without extra tokens.
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
      "X-YouTube-Client-Name": "3",
      "X-YouTube-Client-Version": "20.10.38",
    },
    body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "en", gl: "US" } }, videoId: id }),
  }).catch(() => null);
  if (!res?.ok) throw new YouTubeError("YouTube didn't answer. Try again, or paste the transcript instead.", "BLOCKED");
  const j = (await res.json()) as {
    playabilityStatus?: { status?: string; reason?: string };
    videoDetails?: { title?: string; author?: string; lengthSeconds?: string; shortDescription?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl: string; languageCode: string; kind?: string }[] } };
  };
  const status = j.playabilityStatus?.status;
  if (status === "ERROR") throw new YouTubeError("That video doesn't exist or was removed.", "NOT_FOUND");
  if (status && status !== "OK") throw new YouTubeError("YouTube wouldn't share this video's captions with Confu. Paste the transcript instead.", "BLOCKED");
  const tracks = j.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) throw new YouTubeError("This video has no captions, so there's no transcript to import. If it has a transcript elsewhere, paste it instead.", "NO_CAPTIONS");
  // Prefer English made by the creator, then automatic English, then the video's own language.
  const track =
    tracks.find((t) => t.languageCode.startsWith("en") && t.kind !== "asr") ??
    tracks.find((t) => t.languageCode.startsWith("en")) ??
    tracks.find((t) => t.kind !== "asr") ??
    tracks[0];
  const xml = await (await fetch(track.baseUrl, { signal: AbortSignal.timeout(15_000) }).catch(() => null))?.text();
  const segments = xml ? parseCaptions(xml) : [];
  if (!segments.length) throw new YouTubeError("Couldn't read this video's captions. Paste the transcript instead.", "BLOCKED");
  return {
    id,
    title: cleanText(j.videoDetails?.title ?? "YouTube lecture"),
    author: cleanText(j.videoDetails?.author ?? ""),
    lengthSeconds: Number(j.videoDetails?.lengthSeconds ?? 0),
    description: j.videoDetails?.shortDescription ?? "",
    segments,
    language: track.languageCode,
    automatic: track.kind === "asr",
  };
}

// Title and channel only (works even when captions are refused).
export async function fetchOembed(id: string) {
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const j = (await res.json()) as { title?: string; author_name?: string };
  return { title: cleanText(j.title ?? ""), author: cleanText(j.author_name ?? "") };
}

// "0:00 Intro / 4:12 Gradient descent / …" in the description, YouTube's chapter format.
export function chaptersFrom(description: string): { start: number; title: string }[] {
  const out: { start: number; title: string }[] = [];
  for (const line of description.split("\n")) {
    const m = /^\s*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:|]?\s*(.{2,120})$/.exec(line);
    if (!m) continue;
    const parts = m[1].split(":").map(Number);
    const start = parts.reduce((s, p) => s * 60 + p, 0);
    out.push({ start, title: cleanText(m[2]) });
  }
  const ascending = out.every((c, i) => i === 0 || c.start > out[i - 1].start);
  return out.length >= 3 && out[0].start === 0 && ascending ? out : [];
}

// Pasted from YouTube's "Show transcript" panel: timestamps on their own
// lines (or at the start of a line), followed by the words.
export function parsePastedTranscript(text: string): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^((?:\d{1,2}:)?\d{1,2}:\d{2})\s*(.*)$/.exec(line);
    if (m) {
      if (current?.text) segments.push(current);
      current = { start: m[1].split(":").map(Number).reduce((s, p) => s * 60 + p, 0), text: m[2] };
    } else if (current) current.text += (current.text ? " " : "") + line;
    else current = { start: 0, text: line };
  }
  if (current?.text) segments.push(current);
  return segments.map((s) => ({ start: s.start, text: cleanText(s.text) })).filter((s) => s.text);
}

// Sections (the video's chapters, or every ~5 minutes), each linking to that
// moment, with paragraphs of ~70 words that start with their timestamp.
export function lectureBlocks(segments: Segment[], chapters: { start: number; title: string }[], videoId: string | null): Block[] {
  const at = (s: number) => (videoId ? `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(s)}s` : undefined);
  const sections: { start: number; title: string; segs: Segment[] }[] = [];
  if (chapters.length) {
    for (const [i, c] of chapters.entries()) {
      const end = chapters[i + 1]?.start ?? Infinity;
      sections.push({ start: c.start, title: c.title, segs: segments.filter((s) => s.start >= c.start && s.start < end) });
    }
  } else {
    let cur: { start: number; title: string; segs: Segment[] } | null = null;
    for (const s of segments) {
      if (!cur || s.start - cur.start >= 300) {
        cur = { start: s.start, title: "", segs: [] };
        sections.push(cur);
      }
      cur.segs.push(s);
    }
  }
  const blocks: Block[] = [];
  for (const sec of sections) {
    if (!sec.segs.length) continue;
    const last = sec.segs[sec.segs.length - 1].start;
    const label = sec.title ? `${clock(sec.start)} · ${sec.title}` : `${clock(sec.start)} – ${clock(last)}`;
    blocks.push({ t: "h", level: 2, text: label, ...(at(sec.start) ? { link: at(sec.start) } : {}) });
    let para: Segment[] = [];
    const flush = () => {
      if (!para.length) return;
      blocks.push({ t: "p", text: `[${clock(para[0].start)}] ${para.map((p) => p.text).join(" ")}` });
      para = [];
    };
    for (const s of sec.segs) {
      para.push(s);
      const words = para.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
      if (words >= 70 && /[.?!]$/.test(s.text)) flush();
      else if (words >= 110) flush();
    }
    flush();
  }
  return blocks;
}

import "server-only";
import { Innertube, Log } from "youtubei.js";
import { logError } from "@/lib/log";
import { cleanText, clock, type Block } from "./blocks";

// YouTube lectures -> a timestamped transcript. Uses the captions YouTube
// already has (made by the creator, or automatic), trying several of
// YouTube's own app clients in turn. Each section links back to
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

// A playlist's id from its link (…/playlist?list=PL…, or a video in one).
// Watch Later, Liked videos and auto-made mixes aren't real playlists.
export function playlistIdFrom(input: string): string | null {
  const s = input.trim();
  let id = /^(PL|OL|UU|FL)[\w-]{10,}$/.test(s) ? s : null;
  if (!id) {
    try {
      id = new URL(s).searchParams.get("list");
    } catch {}
  }
  return id && /^[\w-]{10,}$/.test(id) && !/^(WL|LL|RD)/.test(id) ? id : null;
}

export type PlaylistVideo = { id: string; title: string; seconds: number };
const MAX_PLAYLIST = 200;

// A playlist's videos, in order (up to 200), for picking which lectures to import.
export async function fetchPlaylist(id: string): Promise<{ title: string; author: string; videos: PlaylistVideo[] }> {
  type Item = { id?: string; content_id?: string; title?: { toString(): string }; metadata?: { title?: { toString(): string } }; duration?: { seconds?: number } };
  let page;
  try {
    page = await (await innertube()).getPlaylist(id);
  } catch (err) {
    logError("youtube playlist failed", err);
    throw new YouTubeError("Couldn't open that playlist. Check it's public, or import its lectures one by one.", "NOT_FOUND");
  }
  const title = page.info.title ?? "Playlist";
  const author = page.info.author?.name ?? "";
  const videos: PlaylistVideo[] = [];
  const take = (items: unknown[]) => {
    for (const raw of items) {
      const it = raw as Item;
      const vid = it.id ?? it.content_id;
      const name = (it.title ?? it.metadata?.title)?.toString().trim();
      if (vid && /^[\w-]{11}$/.test(vid) && name && !videos.some((v) => v.id === vid)) videos.push({ id: vid, title: name, seconds: it.duration?.seconds ?? 0 });
    }
  };
  take(page.items as unknown[]);
  while (page.has_continuation && videos.length < MAX_PLAYLIST) {
    try {
      page = await page.getContinuation();
    } catch {
      break;
    }
    take(page.items as unknown[]);
  }
  if (!videos.length) throw new YouTubeError("That playlist has no videos we can read.", "NOT_FOUND");
  return { title, author, videos: videos.slice(0, MAX_PLAYLIST) };
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

const tidy = (segments: Segment[]) =>
  segments
    .map((s) => ({ start: s.start, text: cleanText(s.text.replace(/\n/g, " ")) }))
    .filter((s) => s.text && !/^\[(music|applause|laughter)\]$/i.test(s.text));

function parseXml(xml: string): Segment[] {
  const out: Segment[] = [];
  // Format 3: <p t="4220" d="1180">text</p>; older: <text start="4.22" dur="1.18">text</text>
  for (const m of xml.matchAll(/<p t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) out.push({ start: Number(m[1]) / 1000, text: decode(m[2]) });
  if (!out.length) for (const m of xml.matchAll(/<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) out.push({ start: Number(m[1]), text: decode(m[2]) });
  return tidy(out);
}

// A caption track's text: JSON (json3) first, the XML formats as a fallback.
async function readTrack(baseUrl: string): Promise<Segment[]> {
  const url = new URL(baseUrl);
  url.searchParams.set("fmt", "json3");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const j = (await res.json()) as { events?: { tStartMs?: number; segs?: { utf8?: string }[] }[] };
    const segments = tidy(
      (j.events ?? []).filter((e) => e.segs?.length).map((e) => ({ start: (e.tStartMs ?? 0) / 1000, text: e.segs!.map((x) => x.utf8 ?? "").join("") })),
    );
    if (segments.length) return segments;
  } catch {}
  const xml = await (await fetch(baseUrl, { signal: AbortSignal.timeout(15_000) }).catch(() => null))?.text().catch(() => "");
  return xml ? parseXml(xml) : [];
}

type Track = { url: string; lang: string; asr: boolean };
type Player = {
  status: string; // OK, ERROR, LOGIN_REQUIRED, UNPLAYABLE, LIVE_STREAM_OFFLINE…
  reason: string;
  title: string;
  author: string;
  lengthSeconds: number;
  description: string;
  tracks: Track[];
};

// YouTube.js keeps the app clients' versions current as YouTube changes them.
// Its own transcript call is broken (YouTube answers 400), so it's used to
// find the caption tracks, which are then read directly.
let tube: Promise<Innertube> | null = null;
function innertube() {
  Log.setLevel(Log.Level.NONE); // its parser warns about every new YouTube UI element
  tube ??= Innertube.create({ retrieve_player: false, generate_session_locally: true, lang: "en", location: "US" }).catch((err) => {
    tube = null;
    throw err;
  });
  return tube;
}

async function viaLibrary(id: string, client: "ANDROID" | "IOS"): Promise<Player> {
  const info = await (await innertube()).getBasicInfo(id, { client });
  return {
    status: info.playability_status?.status ?? "OK",
    reason: info.playability_status?.reason ?? "",
    title: info.basic_info.title ?? "",
    author: info.basic_info.author ?? "",
    lengthSeconds: info.basic_info.duration ?? 0,
    description: info.basic_info.short_description ?? "",
    tracks: (info.captions?.caption_tracks ?? []).map((t) => ({ url: t.base_url, lang: t.language_code, asr: t.kind === "asr" })),
  };
}

// Without the library: the Android app's player endpoint, which returns
// caption tracks without extra tokens. The last resort if YouTube.js breaks.
async function viaPlayer(id: string): Promise<Player> {
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
  });
  if (!res.ok) throw new Error(`player answered ${res.status}`);
  const j = (await res.json()) as {
    playabilityStatus?: { status?: string; reason?: string };
    videoDetails?: { title?: string; author?: string; lengthSeconds?: string; shortDescription?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl: string; languageCode: string; kind?: string }[] } };
  };
  return {
    status: j.playabilityStatus?.status ?? "OK",
    reason: j.playabilityStatus?.reason ?? "",
    title: j.videoDetails?.title ?? "",
    author: j.videoDetails?.author ?? "",
    lengthSeconds: Number(j.videoDetails?.lengthSeconds ?? 0),
    description: j.videoDetails?.shortDescription ?? "",
    tracks: (j.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).map((t) => ({ url: t.baseUrl, lang: t.languageCode, asr: t.kind === "asr" })),
  };
}

// Prefer English made by the creator, then automatic English, then the video's own language.
const pickTrack = (tracks: Track[]) =>
  tracks.find((t) => t.lang.startsWith("en") && !t.asr) ?? tracks.find((t) => t.lang.startsWith("en")) ?? tracks.find((t) => !t.asr) ?? tracks[0];

export async function fetchLecture(id: string): Promise<Lecture> {
  const attempts: [string, () => Promise<Player>][] = [
    ["android", () => viaLibrary(id, "ANDROID")],
    ["ios", () => viaLibrary(id, "IOS")],
    ["player", () => viaPlayer(id)],
  ];
  const tried: string[] = [];
  let found: Player | null = null;
  for (const [name, attempt] of attempts) {
    let player: Player;
    try {
      player = await attempt();
    } catch (err) {
      tried.push(`${name}: ${err instanceof Error ? err.message.slice(0, 80) : "failed"}`);
      continue;
    }
    tried.push(`${name}: ${player.status}${player.reason ? ` (${player.reason.slice(0, 60)})` : ""}, ${player.tracks.length} tracks`);
    if (player.status === "ERROR") throw new YouTubeError("That video doesn't exist or was removed.", "NOT_FOUND");
    if (player.status !== "OK" || !player.tracks.length) {
      found ??= player.status === "OK" ? player : null;
      continue;
    }
    const track = pickTrack(player.tracks);
    const segments = await readTrack(track.url);
    if (!segments.length) {
      tried.push(`${name}: empty track`);
      continue;
    }
    return {
      id,
      title: cleanText(player.title || "YouTube lecture"),
      author: cleanText(player.author),
      lengthSeconds: player.lengthSeconds,
      description: player.description,
      segments,
      language: track.lang,
      automatic: track.asr,
    };
  }
  // Every route failed: say why, and keep the details for the admin dashboard.
  logError(`youtube transcript failed for ${id}`, new Error(tried.join(" | ")));
  if (found) throw new YouTubeError("This video has no captions, so there's no transcript to import. If it has a transcript elsewhere, paste it instead.", "NO_CAPTIONS");
  throw new YouTubeError("YouTube wouldn't share this video's captions with Confu right now. Paste the transcript instead: it takes a few seconds.", "BLOCKED");
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

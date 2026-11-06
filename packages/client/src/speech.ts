import type { Connection } from "@confu/ai/connection";
import type { FetchLike } from "@confu/ai/fetch-like";
import { ORPHEUS, speechChunks } from "@confu/core/podcast";
import type { FileStore } from "@confu/storage/files";
import type { LocalPodcast } from "./tools";

// Natural voices for audio overviews: Groq's Orpheus reads each line (in
// pieces of at most 200 characters). Every piece is kept on the device, so
// an episode is voiced once and then replays free and offline.

export type Piece = { line: number; part: number; speaker: "A" | "B"; text: string };

export class SpeechError extends Error {
  constructor(
    message: string,
    readonly kind: "limit" | "terms" | "key" | "other",
  ) {
    super(message);
  }
}

// Every piece of a script, in order, from a line on.
export function pieces(p: Pick<LocalPodcast, "script">, fromLine = 0): Piece[] {
  return p.script.flatMap((l, line) => (line < fromLine ? [] : speechChunks(l.text).map((text, part) => ({ line, part, speaker: l.speaker, text }))));
}

const pathOf = (podcastId: string, piece: Pick<Piece, "line" | "part">) => `podcasts/${podcastId}/${piece.line}-${piece.part}.wav`;

export function podcastAudioPaths(p: LocalPodcast): string[] {
  return pieces(p).map((x) => pathOf(p.id, x));
}

// Groq's free plan takes about 10 voice requests a minute: space them out
// here rather than be refused.
const PER_MINUTE = 9;
const sent: number[] = [];
async function turn(signal?: AbortSignal) {
  for (;;) {
    if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
    const now = Date.now();
    while (sent.length && now - sent[0] > 60_000) sent.shift();
    if (sent.length < PER_MINUTE) {
      sent.push(now);
      return;
    }
    await new Promise((r) => setTimeout(r, Math.min(60_000 - (now - sent[0]) + 50, 1000)));
  }
}

async function speak(conn: Connection, text: string, voice: string, opts: { fetch?: FetchLike; signal?: AbortSignal }): Promise<Blob> {
  for (let attempt = 0; ; attempt++) {
    await turn(opts.signal);
    const res = await (opts.fetch ?? fetch)(`${conn.baseUrl}/audio/speech`, {
      method: "POST",
      headers: { authorization: `Bearer ${conn.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: ORPHEUS.model, input: text, voice, response_format: "wav" }),
      signal: opts.signal,
    });
    if (res.ok) return await res.blob();
    const message = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? "";
    const wait = Number(res.headers.get("retry-after"));
    // A short wait (the minute's allowance): wait it out once.
    if (res.status === 429 && attempt === 0 && wait > 0 && wait <= 30) {
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (res.status === 429) throw new SpeechError("Groq's voice allowance is used up for now (its free plan voices a few episodes a day).", "limit");
    if (/terms/i.test(message))
      throw new SpeechError(`Groq needs you to accept Orpheus's terms once: open console.groq.com/playground?model=${ORPHEUS.model}, accept them, then play again.`, "terms");
    if (res.status === 401 || res.status === 403) throw new SpeechError("Groq rejected the voice key. Replace it in Listen.", "key");
    throw new SpeechError(message || `Groq answered ${res.status}.`, "other");
  }
}

// One piece's audio: from the device if it was voiced before, else from Groq
// (then kept).
export async function pieceAudio(files: FileStore, conn: Connection, podcastId: string, piece: Piece, opts: { fetch?: FetchLike; signal?: AbortSignal } = {}): Promise<Blob> {
  const path = pathOf(podcastId, piece);
  const kept = await files.get(path);
  if (kept) return kept;
  const audio = await speak(conn, piece.text, ORPHEUS.voices[piece.speaker], opts);
  await files.put(path, audio);
  return audio;
}

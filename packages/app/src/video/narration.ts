import type { Connection } from "@confu/ai/connection";
import { asEpisode, type LocalVideo } from "@confu/client/video";
import { pieceAudio, pieces, type Piece } from "@confu/client/speech";
import { estimateSeconds } from "@confu/core/video/timing";
import type { FileStore } from "@confu/storage/files";

// A video's narration voiced with natural voices (Groq's Orpheus), piece by
// piece, kept on the device like a podcast's. Lines are numbered across the
// whole video; scenes know where theirs start.

export type VoicedLine = { blobs: Blob[]; seconds: number };

export const firstLine = (v: Pick<LocalVideo, "script">, scene: number) => v.script.scenes.slice(0, scene).reduce((n, s) => n + s.narration.length, 0);

// A WAV file's length from its header (Orpheus answers in WAV).
export async function wavSeconds(blob: Blob): Promise<number | null> {
  const head = new DataView(await blob.slice(0, 4096).arrayBuffer());
  if (head.byteLength < 44 || head.getUint32(0) !== 0x52494646) return null; // "RIFF"
  const byteRate = head.getUint32(28, true);
  let at = 12;
  while (at + 8 <= head.byteLength) {
    const id = head.getUint32(at);
    const size = head.getUint32(at + 4, true);
    if (id === 0x64617461) {
      // "data": a streamed WAV may say 0 or the maximum; then use the file size.
      const bytes = size && size !== 0xffffffff ? Math.min(size, blob.size - at - 8) : blob.size - at - 8;
      return byteRate ? bytes / byteRate : null;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

// Every piece of one scene's narration, voiced (or from the device if voiced before).
export async function voiceScene(files: FileStore, conn: Connection, video: LocalVideo, scene: number, signal?: AbortSignal): Promise<VoicedLine[]> {
  const start = firstLine(video, scene);
  const n = video.script.scenes[scene].narration.length;
  const all = pieces(asEpisode(video)).filter((p) => p.line >= start && p.line < start + n);
  const blobs = await Promise.all(all.map((p) => pieceAudio(files, conn, video.id, p, { signal })));
  const lines: VoicedLine[] = Array.from({ length: n }, () => ({ blobs: [], seconds: 0 }));
  for (const [k, p] of all.entries()) {
    const line = lines[p.line - start];
    line.blobs.push(blobs[k]);
    line.seconds += (await wavSeconds(blobs[k])) ?? estimateSeconds((p as Piece).text);
  }
  return lines;
}

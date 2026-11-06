// Recorded lectures: a transcript becomes a document the tutor can cite,
// one "page" per stretch of a few minutes, each starting with its time.

export type Segment = { start: number; end: number; text: string };

export const PAGE_SECONDS = 5 * 60;

export const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

// Page n covers [ (n-1)·5 min, n·5 min ). A transcript without timings is
// split by length instead (about 700 words a page).
export function transcriptPages(input: { text: string; segments?: Segment[] | null }): { pages: string[]; starts: number[] } {
  const segs = (input.segments ?? []).filter((s) => s.text.trim());
  if (segs.length) {
    const byPage = new Map<number, Segment[]>();
    for (const s of segs) {
      const n = Math.floor(Math.max(0, s.start) / PAGE_SECONDS);
      byPage.set(n, [...(byPage.get(n) ?? []), s]);
    }
    const keys = [...byPage.keys()].sort((a, b) => a - b);
    return {
      pages: keys.map((k) => `[${clock(k * PAGE_SECONDS)}] ${byPage.get(k)!.map((s) => s.text.trim()).join(" ")}`),
      starts: keys.map((k) => k * PAGE_SECONDS),
    };
  }
  const words = input.text.split(/\s+/).filter(Boolean);
  const pages: string[] = [];
  for (let i = 0; i < words.length; i += 700) pages.push(words.slice(i, i + 700).join(" "));
  return { pages: pages.length ? pages : [""], starts: pages.map(() => 0) };
}

// Which transcription model a provider offers, if any.
export function transcriptionModel(provider: string, models: string[] = []): string | null {
  if (provider === "groq") return "whisper-large-v3-turbo";
  if (provider === "openai") return "whisper-1";
  if (provider === "custom") return models.find((m) => /whisper|transcri/i.test(m)) ?? null;
  return null;
}

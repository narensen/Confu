import { useEffect, useState } from "react";

// Playing narration on the device: the device's own voices, and voiced
// audio (natural voices) that the browser has to be allowed to play.

export function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  return voices;
}

// Two different voices, in the page's language when there are any.
export function pickVoices(voices: SpeechSynthesisVoice[]): [SpeechSynthesisVoice | null, SpeechSynthesisVoice | null] {
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2);
  const mine = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  const pool = mine.length ? mine : voices;
  return [pool[0] ?? null, pool.find((v) => v.name !== pool[0]?.name) ?? pool[0] ?? null];
}

// A moment of silence, played straight from the click so the browser lets
// the episode's audio play after the first piece has been fetched.
let silence: string | null = null;
export function silentClip(): string {
  if (silence) return silence;
  const b = new Uint8Array(44 + 800);
  const v = new DataView(b.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + 800, true);
  w(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  w(36, "data");
  v.setUint32(40, 800, true);
  b.fill(128, 44);
  silence = URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
  return silence;
}

// Resolves when the piece has played, or false if the browser wouldn't play it.
export function playBlob(audio: HTMLAudioElement, blob: Blob, rate: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    let ok = true;
    const done = () => {
      audio.removeEventListener("ended", done);
      audio.removeEventListener("error", done);
      signal.removeEventListener("abort", done);
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    audio.addEventListener("ended", done);
    audio.addEventListener("error", done);
    signal.addEventListener("abort", done);
    audio.src = url;
    audio.playbackRate = rate;
    audio.play().catch((e: unknown) => {
      if (e instanceof DOMException && e.name === "NotAllowedError") ok = false;
      done();
    });
  });
}

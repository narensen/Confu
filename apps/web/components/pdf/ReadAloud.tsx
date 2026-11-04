"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/dialogs";
import { track } from "@/lib/telemetry";

// Read aloud with the browser's own speech (no AI, no cost), sentence by
// sentence from the current page onward, turning pages as it goes.

const RATES = [0.8, 1, 1.25, 1.5, 1.75, 2];

function sentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?:;])\s+(?=[A-Z0-9“"‘'(\[])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function pickVoice() {
  const voices = window.speechSynthesis.getVoices();
  const lang = navigator.language?.slice(0, 2) || "en";
  const same = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  return (
    same.find((v) => /natural|neural|premium|enhanced/i.test(v.name)) ??
    same.find((v) => /google/i.test(v.name)) ??
    same.find((v) => v.default) ??
    same[0] ??
    voices[0] ??
    null
  );
}

export function useReadAloud({ pageText, numPages, onPage }: { pageText: (page: number) => Promise<string>; numPages: number; onPage: (page: number) => void }) {
  const [state, setState] = useState<"idle" | "playing" | "paused">("idle");
  const [sentence, setSentence] = useState("");
  const [page, setPage] = useState(0);
  const [rate, setRate] = useState(1);
  const run = useRef(0);
  const rateRef = useRef(1);

  const stop = useCallback(() => {
    run.current++;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setState("idle");
    setSentence("");
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    async (from: number) => {
      if (!("speechSynthesis" in window)) {
        toast("Your browser can't read aloud. Try Chrome, Edge or Safari.", "error");
        return;
      }
      stop();
      const id = ++run.current;
      setState("playing");
      track("reader.read_aloud");
      const voice = pickVoice();
      for (let p = from; p <= numPages && run.current === id; p++) {
        setPage(p);
        if (p !== from) onPage(p);
        const parts = sentences(await pageText(p));
        for (const s of parts) {
          if (run.current !== id) return;
          setSentence(s);
          await new Promise<void>((resolve) => {
            const u = new SpeechSynthesisUtterance(s);
            if (voice) u.voice = voice;
            u.rate = rateRef.current;
            u.onend = () => resolve();
            u.onerror = () => resolve();
            window.speechSynthesis.speak(u);
          });
        }
      }
      if (run.current === id) stop();
    },
    [numPages, onPage, pageText, stop],
  );

  const toggle = useCallback(() => {
    if (state === "playing") {
      window.speechSynthesis.pause();
      setState("paused");
    } else if (state === "paused") {
      window.speechSynthesis.resume();
      setState("playing");
    }
  }, [state]);

  const cycleRate = useCallback(() => {
    const next = RATES[(RATES.indexOf(rateRef.current) + 1) % RATES.length];
    rateRef.current = next;
    setRate(next);
  }, []);

  return { state, sentence, page, rate, start, stop, toggle, cycleRate };
}

export function ReadAloudBar({ ctl }: { ctl: ReturnType<typeof useReadAloud> }) {
  if (ctl.state === "idle") return null;
  return (
    <div role="region" aria-label="Read aloud" className="animate-pop absolute bottom-4 left-1/2 z-20 flex w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-2 rounded-xl border border-ink bg-panel p-2 shadow-hard">
      <button
        type="button"
        onClick={ctl.toggle}
        aria-label={ctl.state === "playing" ? "Pause" : "Resume"}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink text-white"
      >
        {ctl.state === "playing" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M7 5v14l12-7z" />
          </svg>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] tracking-wider text-muted uppercase">Reading p. {ctl.page}</p>
        <p className="truncate font-serif text-sm" aria-live="off">
          {ctl.sentence}
        </p>
      </div>
      <button type="button" onClick={ctl.cycleRate} title="Speed" className="h-8 shrink-0 rounded-md border border-ink/30 px-2 font-mono text-xs hover:border-ink">
        {ctl.rate}×
      </button>
      <button type="button" onClick={ctl.stop} aria-label="Stop reading" className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-paper hover:text-ink">
        ✕
      </button>
    </div>
  );
}

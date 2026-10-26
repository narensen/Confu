"use client";

import { speechPause, speechRate, speechResume, speechStop, useSpeech } from "@/lib/speech";

const RATES = [0.85, 1, 1.25, 1.5];

// The audio overview being read aloud: what it is, how far along, pause,
// speed and stop. Floats at the bottom left of the workspace.
export function AudioBar() {
  const s = useSpeech();
  if (!s) return null;
  return (
    <div role="region" aria-label="Audio overview" className="animate-pop fixed bottom-4 left-4 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-ink bg-panel shadow-hard">
      <div className="h-0.5 bg-line">
        <div className="h-full bg-ink transition-[width] duration-500" style={{ width: `${Math.round(s.progress * 100)}%` }} />
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => (s.status === "playing" ? speechPause() : speechResume())}
          disabled={s.status === "loading" || s.status === "failed"}
          aria-label={s.status === "playing" ? "Pause" : "Play"}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-ink bg-ink text-white disabled:opacity-40"
        >
          {s.status === "loading" ? (
            <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : s.status === "playing" ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] tracking-wider text-muted uppercase">{s.status === "loading" ? "Writing your overview…" : "Audio overview"}</p>
          {s.status === "failed" ? (
            <p className="text-xs leading-snug text-danger">This browser has no voice to read with. Try Chrome, Edge or Safari, or check your system&apos;s speech settings.</p>
          ) : (
            <p className="truncate text-sm font-medium">{s.title}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => speechRate(RATES[(RATES.indexOf(s.rate) + 1) % RATES.length] ?? 1)}
          title="Speed"
          className="shrink-0 rounded-md border border-ink/25 px-1.5 py-0.5 font-mono text-[11px] transition hover:border-ink"
        >
          {s.rate}×
        </button>
        <button type="button" onClick={speechStop} aria-label="Stop" className="shrink-0 rounded px-1 text-muted transition hover:text-ink">
          ✕
        </button>
      </div>
    </div>
  );
}

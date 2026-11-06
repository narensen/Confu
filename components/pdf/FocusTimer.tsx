"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "@/components/dialogs";
import { track } from "@/lib/telemetry";

// A focus timer (Pomodoro) in the reader's toolbar. Its state lives outside
// React so it keeps running when you switch PDFs. Ends with a soft chime.

type Phase = "idle" | "focus" | "break";
type Timer = { phase: Phase; endsAt: number; minutes: number; pausedLeft: number | null };

let timer: Timer = { phase: "idle", endsAt: 0, minutes: 25, pausedLeft: null };
const listeners = new Set<() => void>();
const set = (t: Timer) => {
  timer = t;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.65);
    });
  } catch {}
}

const BREAK = { 25: 5, 50: 10, 15: 3 } as Record<number, number>;
const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function FocusTimer() {
  const t = useSyncExternalStore(subscribe, () => timer, () => timer);
  const [now, setNow] = useState(() => Date.now());
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Tick while running; handle the end of a focus block or break.
  useEffect(() => {
    if (t.phase === "idle" || t.pausedLeft !== null) return;
    const id = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n < timer.endsAt) return;
      chime();
      if (timer.phase === "focus") {
        track("reader.focus_done", { minutes: timer.minutes });
        const brk = BREAK[timer.minutes] ?? 5;
        toast(`${timer.minutes} minutes of focus done. Take a ${brk}-minute break: stand up, look away from the screen.`);
        set({ ...timer, phase: "break", endsAt: n + brk * 60_000 });
      } else {
        toast("Break's over. Ready for another round?");
        set({ ...timer, phase: "idle" });
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [t.phase, t.pausedLeft]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  const left = t.pausedLeft ?? t.endsAt - now;
  const running = t.phase !== "idle";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setMenu((v) => !v)}
        aria-label={running ? `${t.phase === "focus" ? "Focus" : "Break"} timer: ${fmt(left)} left` : "Focus timer"}
        title="Focus timer"
        className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs transition hover:bg-paper ${
          t.phase === "focus" ? "bg-ink font-mono text-white hover:bg-ink/85" : t.phase === "break" ? "bg-yellow-300 font-mono" : ""
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2.5 2.5M9 2h6" />
        </svg>
        {running && <span className="tabular-nums">{fmt(left)}</span>}
      </button>
      {menu && (
        <div role="menu" className="animate-pop absolute top-full right-0 z-30 mt-1.5 w-52 rounded-xl border border-ink bg-panel p-1.5 shadow-hard">
          {!running ? (
            <>
              <p className="px-2 pt-1 pb-1.5 text-[11px] text-muted">Focus, then take a short break.</p>
              {[25, 50, 15].map((m) => (
                <button
                  key={m}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    set({ phase: "focus", minutes: m, endsAt: Date.now() + m * 60_000, pausedLeft: null });
                    setNow(Date.now());
                    setMenu(false);
                    track("reader.focus_start", { minutes: m });
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-paper"
                >
                  Focus {m} min <span className="text-[11px] text-muted">+{BREAK[m]} break</span>
                </button>
              ))}
            </>
          ) : (
            <>
              <p className="px-2 pt-1 pb-1.5 text-[11px] text-muted">
                {t.phase === "focus" ? `Focus · ${t.minutes} min` : "Break"} · {fmt(left)} left
              </p>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  if (t.pausedLeft === null) set({ ...t, pausedLeft: t.endsAt - Date.now() });
                  else set({ ...t, endsAt: Date.now() + t.pausedLeft, pausedLeft: null });
                  setMenu(false);
                }}
                className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-paper"
              >
                {t.pausedLeft === null ? "Pause" : "Resume"}
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  set({ ...t, phase: "idle", pausedLeft: null });
                  setMenu(false);
                }}
                className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-paper"
              >
                Stop
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

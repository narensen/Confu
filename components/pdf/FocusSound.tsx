"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { track } from "@/lib/telemetry";

// White, pink and brown noise in the reader's toolbar: 60-second recorded
// loops in public/noise/ (made by scripts/noise-loops.py), played gaplessly
// with Web Audio. A colour without a recording is generated in the browser
// instead. Like the focus timer, it lives outside React so it keeps playing
// when you switch PDFs, and stops shortly after you leave the reader.

export type Noise = "white" | "pink" | "brown";
type Sound = { playing: Noise | null; volume: number; loading: boolean };

const NOISES: { id: Noise; name: string; hint: string }[] = [
  { id: "white", name: "White noise", hint: "A soft, steady hum, like a fan in the next room." },
  { id: "pink", name: "Pink noise", hint: "Softer and balanced, like steady rain." },
  { id: "brown", name: "Brown noise", hint: "Deep rumble, like a distant waterfall." },
];
const FILES: Record<Noise, string> = { white: "/noise/White_Noise.mp3", pink: "/noise/Pink_Noise.mp3", brown: "/noise/Brown_Noise.mp3" };
const PREFS = "confu:focus-sound";
const SECONDS = 12;
const FADE = 0.4;

let sound: Sound = { playing: null, volume: 0.5, loading: false };
const listeners = new Set<() => void>();
const set = (s: Sound) => {
  sound = s;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let source: AudioBufferSourceNode | null = null;
type Loop = { buffer: AudioBuffer; start: number; end: number };
let cached: { kind: Noise; loop: Loop } | null = null; // one at a time: a decoded minute is ~20 MB
let request = 0;

// Seamless loop: render a little extra and cross-fade it into the start.
function render(kind: Noise, ac: AudioContext) {
  const rate = ac.sampleRate;
  const len = rate * SECONDS;
  const overlap = Math.floor(rate * 0.5);
  const buf = ac.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const raw = new Float32Array(len + overlap);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "white") raw[i] = w * 0.17;
      else if (kind === "pink") {
        // Paul Kellet's pink filter.
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.08;
        b6 = w * 0.115926;
      } else {
        // Leaky integration of white noise: brown (red) noise without drift.
        last = (last + 0.02 * w) / 1.02;
        raw[i] = last * 2.6;
      }
    }
    const out = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) out[i] = raw[i];
    for (let i = 0; i < overlap; i++) {
      const t = i / overlap;
      out[i] = raw[i] * Math.sqrt(t) + raw[len + i] * Math.sqrt(1 - t);
    }
  }
  return buf;
}

// MP3 adds a few milliseconds of silence at each end; loop only the sound.
function trimmed(buffer: AudioBuffer): Loop {
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const loud = (i: number) => chans.some((d) => Math.abs(d[i]) > 1e-4);
  let a = 0;
  let b = buffer.length - 1;
  while (a < b && !loud(a)) a++;
  while (b > a && !loud(b)) b--;
  return { buffer, start: a / buffer.sampleRate, end: (b + 1) / buffer.sampleRate };
}

async function load(kind: Noise, ac: AudioContext): Promise<Loop> {
  if (cached?.kind === kind) return cached.loop;
  let loop: Loop;
  try {
    const res = await fetch(FILES[kind]);
    if (!res.ok) throw new Error(String(res.status));
    loop = trimmed(await ac.decodeAudioData(await res.arrayBuffer()));
  } catch {
    const buffer = render(kind, ac);
    loop = { buffer, start: 0, end: buffer.duration };
  }
  cached = { kind, loop };
  return loop;
}

function stopSource(at: number) {
  if (!source || !gain || !ctx) return;
  const old = source;
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + at);
  old.stop(ctx.currentTime + at + 0.05);
  source = null;
}

async function play(kind: Noise | null, volume = sound.volume) {
  const mine = ++request;
  try {
    if (!kind) {
      stopSource(FADE);
      set({ ...sound, playing: null, loading: false });
      return;
    }
    ctx ??= new AudioContext();
    void ctx.resume();
    const ac = ctx;
    set({ ...sound, playing: kind, loading: true });
    const loop = await load(kind, ac);
    if (mine !== request) return; // another choice came in while this one loaded
    const wasPlaying = Boolean(source);
    stopSource(wasPlaying ? 0.15 : 0);
    gain = ac.createGain();
    gain.gain.setValueAtTime(0, ac.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ac.currentTime + FADE + (wasPlaying ? 0.15 : 0));
    gain.connect(ac.destination);
    source = ac.createBufferSource();
    source.buffer = loop.buffer;
    source.loop = true;
    source.loopStart = loop.start;
    source.loopEnd = loop.end;
    source.connect(gain);
    source.start(0, loop.start);
    set({ playing: kind, volume, loading: false });
  } catch {
    if (mine === request) set({ ...sound, playing: null, loading: false });
  }
}

function setVolume(volume: number) {
  if (gain && ctx) gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  set({ ...sound, volume });
}

// Keep playing across PDF switches (the viewer remounts), but stop once no
// reader is on screen for a moment.
let mounted = 0;
let leaveTimer: number | undefined;

export function FocusSound() {
  const s = useSyncExternalStore(subscribe, () => sound, () => sound);
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted++;
    window.clearTimeout(leaveTimer);
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS) ?? "null") as { volume?: number } | null;
      if (saved?.volume && !sound.playing) set({ ...sound, volume: Math.min(1, Math.max(0.05, saved.volume)) });
    } catch {}
    return () => {
      mounted--;
      leaveTimer = window.setTimeout(() => mounted === 0 && void play(null), 1500);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ volume: s.volume }));
    } catch {}
  }, [s.volume]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setMenu(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const current = NOISES.find((n) => n.id === s.playing);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setMenu((v) => !v)}
        aria-label={current ? `${current.name} playing` : "Background sound"}
        aria-expanded={menu}
        title="Background sound"
        className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs transition ${current ? "bg-ink text-white hover:bg-ink/85" : "hover:bg-paper"}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
          <rect x="3" y="14" width="4" height="7" rx="1.5" />
          <rect x="17" y="14" width="4" height="7" rx="1.5" />
        </svg>
        {current && <span className="capitalize">{s.loading ? "…" : current.id}</span>}
      </button>
      {menu && (
        <div role="menu" className="animate-pop absolute top-full right-0 z-30 mt-1.5 w-64 rounded-xl border border-ink bg-panel p-1.5 shadow-hard">
          <p className="px-2 pt-1 pb-1.5 text-[11px] text-muted">Background sound to block out distractions.</p>
          {NOISES.map((n) => {
            const on = s.playing === n.id;
            return (
              <button
                key={n.id}
                role="menuitemradio"
                aria-checked={on}
                type="button"
                onClick={() => {
                  void play(on ? null : n.id);
                  if (!on) track("reader.sound", { kind: n.id });
                }}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${on ? "bg-ink text-white" : "hover:bg-paper"}`}
              >
                <span
                  aria-hidden
                  className={`mt-1 size-2.5 shrink-0 rounded-full border ${on ? "border-yellow-300 bg-yellow-300" : "border-ink/40"}`}
                  style={!on ? { background: n.id === "white" ? "#fff" : n.id === "pink" ? "#f9a8d4" : "#92400e" } : undefined}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {n.name}
                    {on && s.loading && <span className="ml-1.5 text-[11px] font-normal text-white/70">loading…</span>}
                  </span>
                  <span className={`block text-[11px] leading-snug ${on ? "text-white/70" : "text-muted"}`}>{n.hint}</span>
                </span>
              </button>
            );
          })}
          <label className="mt-1 flex items-center gap-2.5 border-t border-line px-2 pt-2.5 pb-1.5 text-[11px] text-muted">
            Volume
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={s.volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="min-w-0 flex-1 accent-[var(--ink)]"
            />
          </label>
          {current && (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                void play(null);
                setMenu(false);
              }}
              className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-paper"
            >
              Stop
            </button>
          )}
        </div>
      )}
    </div>
  );
}

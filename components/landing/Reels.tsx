"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const REELS = [
  { id: "stop-highlighting", title: "Stop highlighting", body: "Rereading feels like learning. Asking yourself questions is what works.", label: "Reel: why highlighting your notes doesn't help you remember, and what to do instead." },
  { id: "start", title: "Know where to start", body: "Pick a goal or a chapter; Confu turns your material into a plan.", label: "Reel: starting a study session from a goal and getting a plan." },
  { id: "forget", title: "Forget less", body: "What you finish comes back for review, just before you'd forget it.", label: "Reel: spaced review bringing back what you studied before you forget it." },
];

// Three short vertical reels in phone frames. They play muted while on
// screen; a tap turns the sound on for that one (and off for the others).
// With reduced motion, nothing plays until asked.
export function Reels() {
  const [sound, setSound] = useState<string | null>(null);
  return (
    <ul className="grid gap-8 sm:grid-cols-3 sm:gap-6">
      {REELS.map((r) => (
        <li key={r.id} data-reveal-item className="flex flex-col items-center text-center">
          <Reel {...r} sound={sound === r.id} onSound={(on) => setSound(on ? r.id : null)} />
          <h3 className="mt-5 font-serif text-2xl">{r.title}</h3>
          <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted">{r.body}</p>
        </li>
      ))}
    </ul>
  );
}

const MOTION = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const m = window.matchMedia(MOTION);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

function Reel({ id, label, sound, onSound }: { id: string; label: string; sound: boolean; onSound: (on: boolean) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(MOTION).matches, () => false);

  useEffect(() => {
    const el = video.current!;
    if (reduced) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  useEffect(() => {
    const el = video.current!;
    el.muted = !sound;
    if (sound) void el.play().catch(() => {});
  }, [sound]);

  return (
    <div className="relative w-full max-w-[17rem] rounded-[2rem] border-2 border-ink bg-ink p-1.5 shadow-[6px_6px_0_0_#facc15]">
      <video
        ref={video}
        muted
        loop
        playsInline
        preload="none"
        poster={`/reels/${id}.jpg`}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        aria-label={label}
        className="block aspect-[9/16] w-full rounded-[1.6rem] bg-paper object-cover"
      >
        <source src={`/reels/${id}.mp4`} type="video/mp4" />
      </video>
      <button
        type="button"
        onClick={() => {
          if (reduced && !playing) {
            void video.current?.play();
            onSound(true);
            return;
          }
          onSound(!sound);
        }}
        aria-label={sound ? "Mute" : reduced && !playing ? "Play with sound" : "Turn sound on"}
        className="absolute right-4 bottom-4 flex h-9 items-center gap-1.5 rounded-full border border-ink bg-panel px-3 text-xs font-medium shadow-hard-sm transition hover:-translate-y-px"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M11 5 6 9H2v6h4l5 4V5Z" />
          {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="m22 9-6 6M16 9l6 6" />}
        </svg>
        {sound ? "Sound on" : reduced && !playing ? "Play" : "Tap for sound"}
      </button>
    </div>
  );
}

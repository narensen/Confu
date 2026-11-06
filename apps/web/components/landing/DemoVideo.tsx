"use client";

import { useEffect, useRef, useState } from "react";

// The 20-second product clip: highlight → ask → cited answer → jump to page.
// Plays only while on screen; with reduced motion it waits for a click.
export function DemoVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = video.current!;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-ink bg-panel">
      <video
        ref={video}
        muted
        loop
        playsInline
        preload="metadata"
        poster="/demo/confu-demo-poster.jpg"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="block aspect-[1280/760] w-full"
        aria-label="Demo: selecting a sentence in a PDF, asking why the eigenvalue is the variance, and getting an answer that cites page 2, which opens when clicked."
      >
        <source src="/demo/confu-demo.webm" type="video/webm" />
        <source src="/demo/confu-demo.mp4" type="video/mp4" />
      </video>
      <button
        type="button"
        onClick={() => (playing ? video.current?.pause() : void video.current?.play())}
        className="absolute right-3 bottom-3 rounded-full border border-ink bg-panel/90 px-3 py-1 font-mono text-[11px] transition hover:bg-ink hover:text-white"
      >
        {playing ? "Pause" : "Play"}
      </button>
    </div>
  );
}

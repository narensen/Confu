"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SpeechError } from "@confu/client/speech";
import type { LocalVideo } from "@confu/client/video";
import { sceneHeading, type Line } from "@confu/core/video/script";
import { timeline, type SceneTime } from "@confu/core/video/timing";
import { ghostButtonClass } from "@confu/ui/classes";
import { useDevice } from "../local";
import { pickVoices, playBlob, silentClip, useVoices } from "../voice";
import { exportVideo, canExport } from "./export";
import { voiceScene, type VoicedLine } from "./narration";
import { Caption, H, SceneHost, Stage, W } from "./stage";

// Plays a video: one scene at a time, its picture animating while the hosts
// talk. Natural voices (a Groq key) give exact timing; the device's voice
// is used otherwise, and the picture waits for it.

type Status = "idle" | "loading" | "playing" | "paused" | "ended";

export function VideoPlayer({ video, sessionId, natural }: { video: LocalVideo; sessionId: string; natural: boolean }) {
  const { files, keys } = useDevice();
  const scenes = video.script.scenes;
  const voices = useVoices();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [index, setIndex] = useState(0);
  const [mount, setMount] = useState(0); // remounts the scene
  const [time, setTime] = useState<SceneTime>(() => timeline(scenes).scenes[0]);
  const [status, setStatus] = useState<Status>("idle");
  const [line, setLine] = useState<{ scene: number; k: number } | null>(null);
  const [captions, setCaptions] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ done: number; label: string } | null>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);
  const tlWaiters = useRef<((t: gsap.core.Timeline) => void)[]>([]);
  const run = useRef(0); // bumped on every pause/seek: older loops stop
  const audio = useRef<HTMLAudioElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const voiced = useRef(new Map<number, VoicedLine[]>());
  const useNatural = useRef(natural);
  useNatural.current = natural;

  // The stage fills the player's width.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W));
    ro.observe(el);
    setScale(el.clientWidth / W);
    return () => ro.disconnect();
  }, []);

  const silence = useCallback(() => {
    run.current++;
    abort.current?.abort();
    audio.current?.pause();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }, []);
  useEffect(() => silence, [silence]);

  const onTimeline = useCallback((t: gsap.core.Timeline) => {
    tl.current = t;
    for (const w of tlWaiters.current.splice(0)) w(t);
  }, []);
  const nextTimeline = () => new Promise<gsap.core.Timeline>((r) => tlWaiters.current.push(r));

  // Shows a scene, finished (when not playing) or ready to play.
  async function show(i: number, durations?: VoicedLine[]) {
    const t = timeline([scenes[i]], durations ? (_, l) => durations[l].seconds : undefined).scenes[0];
    const ready = nextTimeline();
    setIndex(i);
    setTime(t);
    setMount((m) => m + 1);
    return { tl: await ready, t };
  }

  const waitFor = (cond: () => boolean, id: number) =>
    new Promise<boolean>((resolve) => {
      const tick = () => {
        if (run.current !== id) return resolve(false);
        if (cond()) return resolve(true);
        requestAnimationFrame(tick);
      };
      tick();
    });

  function sayDevice(l: Line, id: number): Promise<void> {
    return new Promise((resolve) => {
      if (typeof speechSynthesis === "undefined") return setTimeout(resolve, 1500);
      const [a, b] = pickVoices(voices);
      const u = new SpeechSynthesisUtterance(l.text);
      const v = l.speaker === "A" ? a : b;
      if (v) u.voice = v;
      u.pitch = l.speaker === "B" && a?.name === b?.name ? 1.25 : 1;
      u.onend = u.onerror = () => resolve();
      if (run.current === id) speechSynthesis.speak(u);
      else resolve();
    });
  }

  async function play(from: number, fromLine = 0) {
    silence();
    const id = run.current;
    setNotice(null);
    const el = (audio.current ??= new Audio());
    // Allowed to play from this click on.
    el.src = silentClip();
    void el.play().catch(() => {});
    const ac = new AbortController();
    abort.current = ac;
    const conn = useNatural.current ? await keys.groq(sessionId) : null;
    for (let i = from; i < scenes.length; i++) {
      if (run.current !== id) return;
      let lines = voiced.current.get(i);
      if (conn && !lines) {
        setStatus("loading");
        try {
          lines = await voiceScene(files, conn, video, i, ac.signal);
          voiced.current.set(i, lines);
        } catch (e) {
          if (run.current !== id) return;
          setNotice(`${e instanceof SpeechError ? e.message : "The natural voices stopped."} Carrying on with this device's voice.`);
          useNatural.current = false;
        }
      }
      // Voice the next scene while this one plays.
      if (conn && useNatural.current && i + 1 < scenes.length && !voiced.current.has(i + 1))
        void voiceScene(files, conn, video, i + 1, ac.signal).then((l) => voiced.current.set(i + 1, l), () => {});
      if (run.current !== id) return;
      const { tl: t, t: st } = await show(i, useNatural.current ? lines : undefined);
      setStatus("playing");
      const start = i === from ? fromLine : 0;
      t.time(start ? st.lines[start].start : 0).play();
      for (let k = start; k < scenes[i].narration.length; k++) {
        if (!(await waitFor(() => t.time() >= st.lines[k].start, id))) return;
        setLine({ scene: i, k });
        if (useNatural.current && lines) {
          for (const blob of lines[k].blobs) {
            if (run.current !== id) return;
            if (!(await playBlob(el, blob, 1, ac.signal))) {
              if (run.current === id) {
                setStatus("paused");
                setNotice("Your browser didn't let the audio play. Press play again.");
              }
              return;
            }
          }
        } else await sayDevice(scenes[i].narration[k], id);
      }
      if (!(await waitFor(() => t.progress() >= 1, id))) return;
    }
    if (run.current === id) {
      setStatus("ended");
      setLine(null);
    }
  }

  function pause() {
    silence();
    tl.current?.pause();
    setStatus("paused");
  }

  async function jump(i: number) {
    const wasPlaying = status === "playing" || status === "loading";
    silence();
    setLine(null);
    if (wasPlaying) return void play(i);
    const { tl: t } = await show(i, voiced.current.get(i));
    t.progress(1);
    setStatus("paused");
  }

  // Before playing: the first scene's finished picture.
  useEffect(() => {
    void show(0).then(({ tl: t }) => t.progress(1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

  async function download() {
    silence();
    tl.current?.pause();
    setStatus("paused");
    setSaving({ done: 0, label: "Voicing the narration" });
    try {
      const conn = natural ? await keys.groq(sessionId) : null;
      let all: VoicedLine[][] | null = null;
      if (conn) {
        all = [];
        for (let i = 0; i < scenes.length; i++) {
          setSaving({ done: i / scenes.length / 4, label: `Voicing scene ${i + 1} of ${scenes.length}` });
          const l = voiced.current.get(i) ?? (await voiceScene(files, conn, video, i));
          voiced.current.set(i, l);
          all.push(l);
        }
      }
      const { blob, ext } = await exportVideo(video, { voiced: all, captions, onProgress: (p) => setSaving({ done: (all ? 0.25 : 0) + p.done * (all ? 0.75 : 1), label: p.label }) });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${video.title.replace(/[^\w\s-]/g, "").trim() || "video"}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      if (!all) setNotice("Saved without sound: add a free Groq key under Listen to include the voices.");
    } catch (e) {
      setNotice(e instanceof SpeechError ? e.message : `Couldn't make the file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(null);
    }
  }

  const current: Line | null = line && line.scene === index ? scenes[index].narration[line.k] : null;
  const playing = status === "playing" || status === "loading";

  return (
    <div className="space-y-3">
      <div
        ref={box}
        className="relative w-full overflow-hidden rounded-xl border border-ink/20 bg-[#0e0e0d]"
        style={{ aspectRatio: `${W} / ${H}` }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === " ") {
            e.preventDefault();
            if (playing) pause();
            else void play(status === "ended" ? 0 : index, status === "paused" && line?.scene === index ? line.k : 0);
          }
        }}
      >
        <Stage scale={scale}>
          <SceneHost key={mount} scene={scenes[index]} time={time} onTimeline={onTimeline} />
          {captions && <Caption line={current} />}
        </Stage>
        {!playing && (
          <button
            type="button"
            onClick={() => void play(status === "ended" ? 0 : index, status === "paused" && line?.scene === index ? line.k : 0)}
            aria-label={status === "ended" ? "Play again" : "Play"}
            className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/15"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-[#f5a524] text-[#0e0e0d]">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                {status === "ended" ? <path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" /> : <path d="M8 5v14l11-7z" />}
              </svg>
            </span>
          </button>
        )}
        {status === "loading" && <p className="absolute top-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">Voicing…</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => (playing ? pause() : void play(status === "ended" ? 0 : index, status === "paused" && line?.scene === index ? line.k : 0))} className={`${ghostButtonClass} px-3 py-1.5 text-xs`}>
          {playing ? "Pause" : status === "ended" ? "Play again" : "Play"}
        </button>
        <span className="font-mono text-[11px] text-muted">
          {index + 1} / {scenes.length}
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
          Captions
        </label>
        <button type="button" onClick={() => void box.current?.requestFullscreen?.()} className={`${ghostButtonClass} px-3 py-1.5 text-xs`}>
          Full screen
        </button>
        {canExport() && (
          <button type="button" onClick={() => void download()} disabled={Boolean(saving)} className={`${ghostButtonClass} px-3 py-1.5 text-xs`}>
            {saving ? `${Math.round(saving.done * 100)}%` : "Download video"}
          </button>
        )}
      </div>
      {saving && (
        <div className="space-y-1" role="status">
          <div className="h-1 overflow-hidden rounded-full bg-paper">
            <div className="h-full bg-[#f5a524] transition-[width]" style={{ width: `${Math.round(saving.done * 100)}%` }} />
          </div>
          <p className="text-xs text-muted">{saving.label}…</p>
        </div>
      )}
      {notice && <p className="text-xs text-warn">{notice}</p>}

      <ol className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Scenes">
        {scenes.map((s, i) => (
          <li key={i} className="shrink-0">
            <button
              type="button"
              onClick={() => void jump(i)}
              aria-current={i === index}
              className={`max-w-44 truncate rounded-full border px-2.5 py-1 text-xs transition-colors ${i === index ? "border-ink text-ink" : "border-ink/15 text-muted hover:border-ink/40 hover:text-ink"}`}
              title={sceneHeading(s)}
            >
              {i + 1}. {sceneHeading(s)}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

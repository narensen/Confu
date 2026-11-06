"use client";

import { useEffect, useRef, useState } from "react";
import type { LocalDocument } from "@confu/client/library";
import { deletePodcast, listPodcasts, makePodcast, type LocalPodcast } from "@confu/client/tools";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@confu/ui/classes";
import { useDevice, useLocal } from "../local";

// Audio overviews: two hosts talk the session through. The script comes
// from the student's AI; the device's own voices read it (free, offline,
// nothing uploaded).

export function ListenPanel({ sessionId, docs, title }: { sessionId: string; docs: LocalDocument[]; title: string }) {
  const { store, keys, changed } = useDevice();
  const { data: podcasts = [] } = useLocal((d) => listPodcasts(d.store, sessionId), [sessionId]);
  const [docId, setDocId] = useState<string>("");
  const [minutes, setMinutes] = useState("5");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const doc = docs.find((d) => d.id === docId);
      const p = await makePodcast(store, keys, { sessionId, documentId: doc?.id ?? null, title: doc?.title ?? title, minutes: Number(minutes), focus: focus.trim() || null });
      changed();
      setPlaying(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make the overview.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-panel">
      <div className="mx-auto max-w-2xl space-y-6 px-5 py-6">
        <header>
          <p className={eyebrowClass}>Listen</p>
          <h2 className="mt-1 font-serif text-2xl">An audio overview of your material</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">Two voices talk it through, for a walk or the bus. Read aloud by this device, so it&apos;s free and works offline once made.</p>
        </header>
        {docs.length === 0 ? (
          <p className="text-sm text-muted">Add a file first.</p>
        ) : (
          <div className="space-y-3 rounded-xl border border-ink bg-paper p-4">
            <div className="flex flex-wrap gap-2">
              <select value={docId} onChange={(e) => setDocId(e.target.value)} aria-label="About" className={`${inputClass} w-auto max-w-60 py-1.5`}>
                <option value="">All files</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
              <select value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Length" className={`${inputClass} w-auto py-1.5`}>
                {["3", "5", "10"].map((m) => (
                  <option key={m} value={m}>
                    about {m} min
                  </option>
                ))}
              </select>
            </div>
            <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Focus on… (optional)" className={inputClass} />
            <button type="button" onClick={make} disabled={busy} className={`${buttonClass} w-full`}>
              {busy ? "Writing the script…" : "Make an overview"}
            </button>
            {error && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
          </div>
        )}
        <ul className="space-y-3">
          {podcasts.map((p) => (
            <Episode key={p.id} p={p} open={playing === p.id} onOpen={() => setPlaying(playing === p.id ? null : p.id)} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function useVoices() {
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
function pickVoices(voices: SpeechSynthesisVoice[]): [SpeechSynthesisVoice | null, SpeechSynthesisVoice | null] {
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2);
  const mine = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  const pool = mine.length ? mine : voices;
  return [pool[0] ?? null, pool.find((v) => v.name !== pool[0]?.name) ?? pool[0] ?? null];
}

function Episode({ p, open, onOpen }: { p: LocalPodcast; open: boolean; onOpen: () => void }) {
  const { store, changed } = useDevice();
  const voices = useVoices();
  const [line, setLine] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  const playingRef = useRef(false);
  const lineRefs = useRef<(HTMLLIElement | null)[]>([]);

  const stop = () => {
    playingRef.current = false;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setLine(null);
  };
  // Closing the episode (or leaving) silences it.
  useEffect(() => {
    if (!open) return;
    return () => {
      playingRef.current = false;
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    };
  }, [open]);

  function play(from: number) {
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    playingRef.current = true;
    const [a, b] = pickVoices(voices);
    const say = (i: number) => {
      if (!playingRef.current || i >= p.script.length) return stop();
      setLine(i);
      lineRefs.current[i]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const u = new SpeechSynthesisUtterance(p.script[i].text);
      const voice = p.script[i].speaker === "A" ? a : b;
      if (voice) u.voice = voice;
      u.rate = rate;
      // The same voice for both on some devices: tell them apart by pitch.
      u.pitch = p.script[i].speaker === "A" ? 1 : a?.name === b?.name ? 1.25 : 1;
      u.onend = () => say(i + 1);
      u.onerror = () => stop();
      speechSynthesis.speak(u);
    };
    say(from);
  }

  const noVoices = open && typeof speechSynthesis !== "undefined" && voices.length === 0;

  return (
    <li className="rounded-xl border border-ink/20">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-white" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{p.title}</span>
          <span className="font-mono text-[11px] text-muted">{p.script.length} lines · {new Date(p.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {line === null ? (
              <button type="button" onClick={() => play(0)} disabled={noVoices} className={buttonClass}>
                Play
              </button>
            ) : (
              <button type="button" onClick={stop} className={buttonClass}>
                Stop
              </button>
            )}
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Speed" className={`${inputClass} w-auto py-1.5`}>
              {[0.85, 1, 1.15, 1.3, 1.5].map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={async () => {
                stop();
                await deletePodcast(store, p.id);
                changed();
              }}
              className={`${ghostButtonClass} ml-auto px-2.5 py-1 text-xs text-danger`}
            >
              Delete
            </button>
          </div>
          {noVoices && <p className="mb-2 text-xs text-warn">This device has no voices for reading aloud. The script is below.</p>}
          <ol className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {p.script.map((l, i) => (
              <li
                key={i}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                onClick={() => play(i)}
                className={`cursor-pointer rounded-lg px-2 py-1 transition ${line === i ? "bg-ink text-white" : "hover:bg-paper"}`}
              >
                <span className="mr-2 font-mono text-[10px] opacity-60">{l.speaker === "A" ? "HOST" : "GUEST"}</span>
                {l.text}
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}

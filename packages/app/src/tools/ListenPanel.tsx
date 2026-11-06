"use client";

import { useEffect, useRef, useState } from "react";
import type { LocalDocument } from "@confu/client/library";
import { pieceAudio, pieces, SpeechError } from "@confu/client/speech";
import { deletePodcast, listPodcasts, makePodcast, type LocalPodcast } from "@confu/client/tools";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@confu/ui/classes";
import { useDevice, useLocal } from "../local";

// Audio overviews: two hosts talk the session through. The script comes
// from the student's AI. The voices are either natural ones (Groq's Orpheus,
// with a Groq key; each episode is voiced once and kept on the device) or
// the device's own (free and offline from the start).

type Voices = "natural" | "device";
const VOICES_KEY = "podcast.voices";

export function ListenPanel({ sessionId, docs, title }: { sessionId: string; docs: LocalDocument[]; title: string }) {
  const { store, keys, changed } = useDevice();
  const { data: podcasts = [] } = useLocal((d) => listPodcasts(d.store, sessionId), [sessionId]);
  const { data: hasGroq = false } = useLocal(async (d) => Boolean(await d.keys.groq(sessionId)), [sessionId]);
  const { data: chosen } = useLocal((d) => d.store.getMeta(VOICES_KEY), []);
  const voices: Voices = chosen === "device" ? "device" : "natural";
  const natural = voices === "natural" && hasGroq;
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

  async function choose(v: Voices) {
    await store.setMeta(VOICES_KEY, v);
    changed();
  }

  return (
    <div className="h-full overflow-y-auto bg-panel">
      <div className="mx-auto max-w-2xl space-y-6 px-5 py-6">
        <header>
          <p className={eyebrowClass}>Listen</p>
          <h2 className="mt-1 font-serif text-2xl">An audio overview of your material</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">Two hosts talk it through, for a walk or the bus.</p>
        </header>

        <section aria-label="Voices" className="space-y-3">
          <div role="radiogroup" aria-label="Voices" className="flex rounded-full bg-paper p-0.5 text-xs font-medium">
            {(
              [
                ["natural", "Natural voices"],
                ["device", "This device's voice"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={voices === v}
                onClick={() => void choose(v)}
                className={`flex-1 rounded-full px-3 py-1.5 transition ${voices === v ? "bg-panel text-ink shadow-[0_0_0_1px_var(--ink)]" : "text-muted hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {voices === "natural" ? <VoiceKey sessionId={sessionId} hasGroq={hasGroq} /> : <p className="text-xs leading-relaxed text-muted">Read aloud by this device: free, and works offline straight away.</p>}
        </section>

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
            <Episode key={p.id} p={p} sessionId={sessionId} natural={natural} open={playing === p.id} onOpen={() => setPlaying(playing === p.id ? null : p.id)} />
          ))}
        </ul>
      </div>
    </div>
  );
}

// The Groq key the natural voices use, when the main AI isn't Groq.
function VoiceKey({ sessionId, hasGroq }: { sessionId: string; hasGroq: boolean }) {
  const { keys, changed } = useDevice();
  const { data: info } = useLocal((d) => d.keys.voiceInfo(), [sessionId]);
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hasGroq) {
    return (
      <p className="text-xs leading-relaxed text-muted">
        Voiced by Groq&apos;s Orpheus{info ? ` (key ending ${info.last4})` : ", with your Groq key"}. Each episode is voiced once as it plays and kept on this device,
        so replays are free and work offline. Groq&apos;s free plan voices a few episodes a day; after that, this device&apos;s voice takes over.
        {info && (
          <button
            type="button"
            onClick={async () => {
              await keys.removeVoice();
              changed();
            }}
            className="ml-1 underline underline-offset-2 hover:text-ink"
          >
            Remove the key
          </button>
        )}
      </p>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
          const res = await keys.addVoice(key);
          if (!res.ok) return setError(res.error);
          setKey("");
          changed();
        } finally {
          setPending(false);
        }
      }}
      className="space-y-2 rounded-xl border border-ink/20 p-3"
    >
      <p className="text-xs leading-relaxed text-muted">
        Natural voices come from Groq&apos;s Orpheus, with a free Groq key from{" "}
        <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-2">
          console.groq.com/keys
        </a>
        . It&apos;s only used for voices (and lecture transcripts); your tutor keeps its own AI.
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label="Groq API key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="gsk_…"
          className={`${inputClass} min-w-0 flex-1 py-1.5 font-mono`}
        />
        <button className={`${buttonClass} shrink-0 py-1.5`} disabled={pending || !key.trim()}>
          {pending ? "Checking…" : "Save"}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
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

// A moment of silence, played straight from the click so the browser lets
// the episode's audio play after the first piece has been fetched.
let silence: string | null = null;
function silentClip(): string {
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
function playBlob(audio: HTMLAudioElement, blob: Blob, rate: number, signal: AbortSignal): Promise<boolean> {
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

const AHEAD = 3; // pieces fetched ahead of the one playing

function Episode({ p, sessionId, natural, open, onOpen }: { p: LocalPodcast; sessionId: string; natural: boolean; open: boolean; onOpen: () => void }) {
  const { store, files, keys, changed } = useDevice();
  const voices = useVoices();
  const [line, setLine] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const rateRef = useRef(1);
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lineRefs = useRef<(HTMLLIElement | null)[]>([]);

  const silenceAll = () => {
    playingRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    audioRef.current?.pause();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  };
  const stop = () => {
    silenceAll();
    setLine(null);
    setWaiting(false);
  };
  // Closing the episode (or leaving) silences it.
  useEffect(() => {
    if (!open) return;
    return silenceAll;
  }, [open]);

  const show = (i: number) => {
    setLine(i);
    lineRefs.current[i]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  function playDevice(from: number) {
    if (typeof speechSynthesis === "undefined") return stop();
    speechSynthesis.cancel();
    playingRef.current = true;
    const [a, b] = pickVoices(voices);
    const say = (i: number) => {
      if (!playingRef.current || i >= p.script.length) return stop();
      show(i);
      const u = new SpeechSynthesisUtterance(p.script[i].text);
      const voice = p.script[i].speaker === "A" ? a : b;
      if (voice) u.voice = voice;
      u.rate = rateRef.current;
      // The same voice for both on some devices: tell them apart by pitch.
      u.pitch = p.script[i].speaker === "A" ? 1 : a?.name === b?.name ? 1.25 : 1;
      u.onend = () => say(i + 1);
      u.onerror = () => stop();
      speechSynthesis.speak(u);
    };
    say(from);
  }

  // Natural voices: the first piece plays as soon as it arrives while the
  // next few are fetched, so it never waits long. If Groq stops (its daily
  // allowance, say), the device's voice carries on from the same line.
  function playNatural(from: number) {
    silenceAll();
    const ac = new AbortController();
    abortRef.current = ac;
    playingRef.current = true;
    setNotice(null);
    const audio = (audioRef.current ??= new Audio());
    audio.src = silentClip();
    void audio.play().catch(() => {});
    const live = () => playingRef.current && !ac.signal.aborted;
    const list = pieces(p, from);
    void (async () => {
      const conn = await keys.groq(sessionId);
      if (!live()) return;
      if (!conn) return playDevice(from);
      const jobs: Promise<Blob>[] = [];
      const job = (k: number) => (jobs[k] ??= pieceAudio(files, conn, p.id, list[k], { signal: ac.signal }));
      for (let k = 0; k < list.length; k++) {
        for (let j = k; j < Math.min(list.length, k + AHEAD); j++) job(j).catch(() => {});
        if (!live()) return;
        show(list[k].line);
        setWaiting(true);
        let blob: Blob;
        try {
          blob = await job(k);
        } catch (e) {
          if (!live()) return;
          setWaiting(false);
          const why = e instanceof SpeechError ? e.message : "Groq couldn't voice this part.";
          setNotice(`${why} Carrying on with this device's voice.`);
          return playDevice(list[k].line);
        }
        setWaiting(false);
        if (!live()) return;
        if (!(await playBlob(audio, blob, rateRef.current, ac.signal)) && live()) {
          stop();
          return setNotice("Your browser didn't let the audio play. Press Play again.");
        }
      }
      if (live()) stop();
    })();
  }

  const play = (from: number) => (natural ? playNatural(from) : (silenceAll(), playDevice(from)));
  const noVoices = open && !natural && typeof speechSynthesis !== "undefined" && voices.length === 0;

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
            <select
              value={rate}
              onChange={(e) => {
                const r = Number(e.target.value);
                setRate(r);
                rateRef.current = r;
                if (audioRef.current) audioRef.current.playbackRate = r;
              }}
              aria-label="Speed"
              className={`${inputClass} w-auto py-1.5`}
            >
              {[0.85, 1, 1.15, 1.3, 1.5].map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
            {waiting && (
              <span role="status" className="font-mono text-[11px] text-muted">
                Voicing…
              </span>
            )}
            <button
              type="button"
              onClick={async () => {
                stop();
                await deletePodcast(store, files, p.id);
                changed();
              }}
              className={`${ghostButtonClass} ml-auto px-2.5 py-1 text-xs text-danger`}
            >
              Delete
            </button>
          </div>
          {notice && <p className="mb-2 text-xs text-warn">{notice}</p>}
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

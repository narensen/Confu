"use client";

import { useEffect, useRef, useState } from "react";
import { clock } from "@confu/core/lecture";
import { deleteRecording, listRecordings, saveRecording, transcribe, type LocalRecording } from "@confu/client/tools";
import { buttonClass, eyebrowClass, ghostButtonClass } from "@confu/ui/classes";
import { useHost } from "../host";
import { useDevice, useLocal } from "../local";

// Record a lecture (the microphone, the computer's own sound, or both),
// then have the student's provider transcribe it. The transcript becomes a
// file in the session, cited by time like a PDF is by page.

type Source = "mic" | "system" | "both";
const BITRATE = 24_000; // speech: about 11 MB an hour, under providers' 25 MB per file

function pickMime() {
  for (const m of ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

export function LecturesPanel({ sessionId, onOpenDoc }: { sessionId: string; onOpenDoc: (docId: string) => void }) {
  const { store, files, keys, changed } = useDevice();
  const { platform } = useHost();
  const { data: recordings = [] } = useLocal((d) => listRecordings(d.store, sessionId), [sessionId]);
  const [source, setSource] = useState<Source>("mic");
  const [rec, setRec] = useState<{ started: number; stop: () => void } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const streams = useRef<MediaStream[]>([]);

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setSeconds((Date.now() - rec.started) / 1000), 500);
    return () => clearInterval(t);
  }, [rec]);

  // Stop the microphone if the student leaves mid-recording.
  useEffect(() => () => streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop())), []);

  async function start() {
    setError(null);
    try {
      const parts: MediaStream[] = [];
      if (source !== "system") parts.push(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: source === "mic", noiseSuppression: true } }));
      if (source !== "mic") {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        screen.getVideoTracks().forEach((t) => t.stop());
        if (!screen.getAudioTracks().length) throw new Error(platform === "desktop" ? "This computer didn't share its sound." : "No sound was shared. Pick a tab and turn on “Share tab audio”.");
        parts.push(screen);
      }
      streams.current = parts;
      // One track to record: the sources mixed together.
      let stream = parts[0];
      if (parts.length > 1) {
        const ctx = new AudioContext();
        const out = ctx.createMediaStreamDestination();
        for (const p of parts) ctx.createMediaStreamSource(p).connect(out);
        stream = out.stream;
      }
      const mime = pickMime();
      const recorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()), { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: BITRATE });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const started = Date.now();
      recorder.onstop = async () => {
        parts.forEach((p) => p.getTracks().forEach((t) => t.stop()));
        streams.current = [];
        const secs = (Date.now() - started) / 1000;
        setRec(null);
        setSeconds(0);
        if (secs < 2) return;
        const audio = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
        const title = `Lecture, ${new Date(started).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`;
        const id = await saveRecording(store, files, { sessionId, audio, seconds: secs, title });
        changed();
        await runTranscribe(id);
      };
      recorder.start(10_000);
      setRec({ started, stop: () => recorder.state !== "inactive" && recorder.stop() });
    } catch (e) {
      streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Recording was blocked. Allow the microphone (or screen sharing) for Confu." : e instanceof Error ? e.message : "Couldn't start recording.");
    }
  }

  async function runTranscribe(id: string) {
    setError(null);
    setWorking(id);
    changed();
    try {
      const docId = await transcribe(store, files, keys, id);
      changed();
      onOpenDoc(docId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't transcribe.");
      changed();
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-panel">
      <div className="mx-auto max-w-2xl space-y-6 px-5 py-6">
        <header>
          <p className={eyebrowClass}>Lectures</p>
          <h2 className="mt-1 font-serif text-2xl">Record, and ask about it later</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            The audio stays on this device. Your AI provider transcribes it (Groq and OpenAI can; Groq&apos;s is free), and the transcript joins your
            files, so the tutor can answer from it and cite the minute.
          </p>
        </header>

        <div className="rounded-xl border border-ink bg-paper p-4">
          {rec ? (
            <div className="flex items-center gap-4">
              <span className="size-3 animate-pulse rounded-full bg-danger" aria-hidden />
              <span className="font-mono text-2xl tabular-nums">{clock(seconds)}</span>
              <button type="button" onClick={rec.stop} className={`${buttonClass} ml-auto`}>
                Stop
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div role="radiogroup" aria-label="What to record" className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["mic", "Microphone", "a lecture in the room"],
                    ["system", platform === "desktop" ? "This computer's sound" : "A browser tab's sound", "a video or online class"],
                    ["both", "Both", "a call you take part in"],
                  ] as const
                ).map(([v, label, hint]) => (
                  <button key={v} type="button" role="radio" aria-checked={source === v} title={hint} onClick={() => setSource(v)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${source === v ? "border-ink bg-ink text-white" : "border-ink/25 text-muted hover:border-ink hover:text-ink"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={start} className={`${buttonClass} w-full py-2.5`}>
                <span className="size-2.5 rounded-full bg-danger" aria-hidden />
                Start recording
              </button>
            </div>
          )}
        </div>
        {error && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}

        {recordings.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-ink/20">
            {recordings.map((r) => (
              <RecordingRow key={r.id} r={r} working={working === r.id} onTranscribe={() => runTranscribe(r.id)} onOpenDoc={onOpenDoc} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RecordingRow({ r, working, onTranscribe, onOpenDoc }: { r: LocalRecording; working: boolean; onTranscribe: () => void; onOpenDoc: (docId: string) => void }) {
  const { store, files, changed } = useDevice();
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate">{r.title}</p>
        <p className="font-mono text-[11px] text-muted">
          {clock(r.seconds)} ·{" "}
          {working || r.status === "transcribing" ? "transcribing…" : r.status === "ready" ? "transcribed" : r.status === "failed" ? (r.error ?? "failed") : "not transcribed"}
        </p>
      </div>
      {r.status === "ready" && r.document_id ? (
        <button type="button" onClick={() => onOpenDoc(r.document_id!)} className={`${ghostButtonClass} px-2.5 py-1 text-xs`}>
          Open
        </button>
      ) : (
        <button type="button" disabled={working} onClick={onTranscribe} className={`${ghostButtonClass} px-2.5 py-1 text-xs`}>
          {r.status === "failed" ? "Try again" : "Transcribe"}
        </button>
      )}
      <button
        type="button"
        onClick={async () => {
          if (!window.confirm(`Delete the audio of “${r.title}”? A transcript stays in your files.`)) return;
          await deleteRecording(store, files, r);
          changed();
        }}
        className="text-xs text-danger"
      >
        Delete
      </button>
    </li>
  );
}

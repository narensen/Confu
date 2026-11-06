"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass, eyebrowClass, ghostButtonClass } from "@/components/ui";
import { JSON_HEADERS, readAiError } from "@/lib/ai-errors";

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function speechCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const SECONDS = 45;

// Forty-five seconds against the page. The browser hears it. The server
// scores it and keeps the score and the gap, then the words are dropped.
export function ExplainBack({
  sessionId,
  documentId,
  page,
  topic,
  onClose,
}: {
  sessionId: string;
  documentId: string;
  page: number;
  topic: string;
  onClose: () => void;
}) {
  const hearable = speechCtor() !== null;
  const [phase, setPhase] = useState<"ready" | "live" | "scoring" | "done">("ready");
  const [left, setLeft] = useState(SECONDS);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<{ score: number; gap: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const said = useRef("");
  const sent = useRef(false);
  const rec = useRef<SpeechRec | null>(null);
  const phaseRef = useRef(phase);
  const submitRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && phaseRef.current !== "scoring" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    return () => {
      sent.current = true;
      rec.current?.stop();
      rec.current = null;
    };
  }, []);

  async function submit(text: string) {
    if (sent.current) return;
    sent.current = true;
    rec.current?.stop();
    rec.current = null;
    setPhase("scoring");
    setTyped("");
    said.current = "";
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sessionId, documentId, page, topic, answer: text }),
      });
      if (!res.ok) throw new Error(await readAiError(res));
      setResult((await res.json()) as { score: number; gap: string });
      setPhase("done");
    } catch (err) {
      sent.current = false;
      setPhase("ready");
      setLeft(SECONDS);
      setError(err instanceof Error ? err.message : "Couldn't score that.");
    }
  }

  useEffect(() => {
    submitRef.current = submit;
  });

  function start() {
    setError(null);
    setLeft(SECONDS);
    sent.current = false;
    said.current = typed.trim();
    setPhase("live");
    const Ctor = speechCtor();
    if (!Ctor) return;
    const hear = new Ctor();
    hear.lang = document.documentElement.lang || "en";
    hear.continuous = true;
    hear.interimResults = true;
    hear.onresult = (ev) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) text += `${ev.results[i][0]?.transcript ?? ""} `;
      said.current = text.trim();
    };
    hear.onerror = () => setError("The microphone didn't start. Type it instead.");
    hear.onend = () => {
      if (phaseRef.current === "live") void submit(said.current);
    };
    rec.current = hear;
    try {
      hear.start();
    } catch {
      rec.current = null;
      setError("The microphone didn't start. Type it instead.");
    }
  }

  useEffect(() => {
    if (phase !== "live") return;
    const started = Date.now();
    const id = window.setInterval(() => {
      const remain = SECONDS - Math.floor((Date.now() - started) / 1000);
      if (remain <= 0) {
        window.clearInterval(id);
        setLeft(0);
        void submitRef.current(said.current);
        return;
      }
      setLeft(remain);
    }, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  const label = result ? (result.score === 1 ? "Covers the page" : result.score > 0 ? "Partly there" : "The gap is wide") : "";

  return (
    <div className="animate-fade fixed inset-0 z-[70] flex items-center justify-center bg-scrim p-3" onMouseDown={(e) => e.target === e.currentTarget && phase !== "scoring" && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="explain-title" className="animate-pop w-full max-w-md rounded-2xl border border-ink bg-panel p-6 shadow-hard">
        <p className={eyebrowClass}>Explain back · p. {page}</p>
        <h2 id="explain-title" className="mt-1 font-serif text-2xl">
          {topic.trim() || "This page"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">45 seconds. Say what this page is about. Nothing is recorded. Confu keeps the score and what&apos;s missing.</p>

        {phase === "done" && result ? (
          <div className="mt-5">
            <p className="font-serif text-3xl">{label}</p>
            <p className="mt-2 text-sm leading-relaxed">{result.gap}</p>
            <button type="button" onClick={onClose} className={`${buttonClass} mt-5 py-2`}>
              Done
            </button>
          </div>
        ) : phase === "scoring" ? (
          <p className="mt-6 font-serif text-xl">Scoring it against the page…</p>
        ) : (
          <>
            {phase === "live" && <p className="mt-4 font-mono text-sm tabular-nums">{left}s</p>}
            {!hearable && (
              <textarea
                rows={4}
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  said.current = e.target.value;
                }}
                placeholder="This browser can't hear you. Type what you'd say. It still isn't saved."
                className="mt-4 w-full resize-y rounded-lg border border-ink/30 bg-paper px-3 py-2 text-sm leading-relaxed outline-none focus:border-ink"
              />
            )}
            {hearable && phase === "live" && <p className="mt-3 text-sm text-muted">Listening…</p>}
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            <div className="mt-5 flex gap-2">
              {phase === "ready" ? (
                <button type="button" onClick={start} className={`${buttonClass} py-2`}>
                  Start
                </button>
              ) : (
                <button type="button" onClick={() => void submit(said.current)} className={`${buttonClass} py-2`}>
                  Stop and score
                </button>
              )}
              <button type="button" onClick={onClose} className={`${ghostButtonClass} py-2`}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

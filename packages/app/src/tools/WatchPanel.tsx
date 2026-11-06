"use client";

import { useState } from "react";
import type { LocalDocument } from "@confu/client/library";
import { deleteVideo, listVideos, makeVideo } from "@confu/client/video";
import { buttonClass, eyebrowClass, inputClass } from "@confu/ui/classes";
import { ago } from "../chrome";
import { useDevice, useLocal } from "../local";
import { VideoPlayer } from "../video/Player";

// Explainer videos: the student's AI storyboards their material, Confu
// animates it, and two hosts talk it through (the same voices as Listen).

const VOICES_KEY = "podcast.voices";

export function WatchPanel({ sessionId, docs, title }: { sessionId: string; docs: LocalDocument[]; title: string }) {
  const { store, files, keys, changed } = useDevice();
  const { data: videos = [] } = useLocal((d) => listVideos(d.store, sessionId), [sessionId]);
  const { data: hasGroq = false } = useLocal(async (d) => Boolean(await d.keys.groq(sessionId)), [sessionId]);
  const { data: chosen } = useLocal((d) => d.store.getMeta(VOICES_KEY), []);
  const natural = chosen !== "device" && hasGroq;
  const [docId, setDocId] = useState("");
  const [minutes, setMinutes] = useState("2");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const doc = docs.find((d) => d.id === docId);
      const v = await makeVideo(store, keys, { sessionId, documentId: doc?.id ?? null, title: doc?.title ?? title, minutes: Number(minutes), focus: focus.trim() || null });
      changed();
      setOpen(v.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make the video.");
    } finally {
      setBusy(false);
    }
  }

  const current = videos.find((v) => v.id === open) ?? null;

  return (
    <div className="h-full overflow-y-auto bg-panel">
      <div className="mx-auto max-w-3xl space-y-6 px-5 py-6">
        <header>
          <p className={eyebrowClass}>Watch</p>
          <h2 className="mt-1 font-serif text-2xl">Explainer videos of your material</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Your AI plans the scenes; Confu draws and animates them while two hosts talk it through. {natural ? "Voiced with natural voices." : "Voiced by this device (natural voices: add a Groq key under Listen)."}
          </p>
        </header>

        {current && (
          <section aria-label={current.title} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="min-w-0 truncate font-serif text-xl">{current.title}</h3>
              <button type="button" onClick={() => setOpen(null)} className="shrink-0 text-xs text-muted hover:text-ink">
                Close
              </button>
            </div>
            <VideoPlayer key={current.id} video={current} sessionId={sessionId} natural={natural} />
          </section>
        )}

        {docs.length === 0 ? (
          <p className="text-sm text-muted">Add a file first.</p>
        ) : (
          <div className="space-y-3 rounded-xl border border-ink/20 p-4">
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
                {["1", "2", "3"].map((m) => (
                  <option key={m} value={m}>
                    about {m} min
                  </option>
                ))}
              </select>
            </div>
            <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Focus on… (optional)" className={inputClass} />
            <button type="button" onClick={make} disabled={busy} className={`${buttonClass} w-full`}>
              {busy ? "Planning the scenes…" : "Make a video"}
            </button>
            {error && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
          </div>
        )}

        {videos.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-ink/20">
            {videos.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-3">
                <button type="button" onClick={() => setOpen(open === v.id ? null : v.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0e0e0d] text-[#f5a524]" aria-hidden>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{v.title}</span>
                    <span className="block text-xs text-muted">
                      {v.script.scenes.length} scenes · {ago(v.created_at)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Delete “${v.title}”?`)) return;
                    if (open === v.id) setOpen(null);
                    await deleteVideo(store, files, v.id);
                    changed();
                  }}
                  className="shrink-0 text-xs text-muted hover:text-danger"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { clock } from "@confu/core/lecture";
import type { LocalDocument } from "@confu/client/library";
import type { LocalRecording } from "@confu/client/tools";
import { useDevice, useLocal } from "../local";

// A recorded lecture's transcript, with its audio: each "page" is a few
// minutes, starting with its time; click a time to hear that part.

export function TranscriptView({ doc, jump, onPageChange }: { doc: LocalDocument; jump: { page: number; seq: number } | null; onPageChange: (page: number) => void }) {
  const { files } = useDevice();
  const meta = doc.meta as { recording_id?: string; starts?: number[] };
  const { data: pages = [] } = useLocal((d) => d.store.list<{ page_number: number; content: string }>("document_pages", { document_id: doc.id }, { order: "page_number" }), [doc.id]);
  const { data: rec } = useLocal((d) => (meta.recording_id ? d.store.get<LocalRecording>("recordings", { id: meta.recording_id }) : Promise.resolve(null)), [meta.recording_id]);
  const [src, setSrc] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const refs = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    if (!rec?.storage_path) return;
    let url: string | null = null;
    let live = true;
    void files.get(rec.storage_path).then((b) => {
      if (!live || !b) return;
      url = URL.createObjectURL(b);
      setSrc(url);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [rec?.storage_path, files]);

  useEffect(() => {
    if (jump) refs.current.get(jump.page)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [jump]);

  const seek = (page: number) => {
    onPageChange(page);
    const at = meta.starts?.[page - 1];
    if (audio.current && at !== undefined) {
      audio.current.currentTime = at;
      void audio.current.play();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      {src ? (
        <audio ref={audio} src={src} controls className="w-full shrink-0 border-b border-line px-3 py-2" />
      ) : (
        <p className="shrink-0 border-b border-line px-4 py-2 text-xs text-muted">{rec === null || !rec?.storage_path ? "The audio isn't on this device (deleted, or not synced yet)." : "Loading audio…"}</p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-5 px-5 py-5">
          {pages.map((p) => {
            const m = /^\[([\d:]+)\]\s*/.exec(p.content);
            return (
              <section
                key={p.page_number}
                data-page={p.page_number}
                ref={(el) => {
                  if (el) refs.current.set(p.page_number, el);
                }}
              >
                <button type="button" onClick={() => seek(p.page_number)} className="mb-1 font-mono text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline">
                  {m ? m[1] : clock(meta.starts?.[p.page_number - 1] ?? 0)} · p. {p.page_number}
                </button>
                <p className="text-sm leading-relaxed">{m ? p.content.slice(m[0].length) : p.content}</p>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

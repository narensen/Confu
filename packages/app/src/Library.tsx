"use client";

import { useRef, useState } from "react";
import { createSession, deleteSession, listSessions, pdfTitle, updateSession, type LocalSession } from "@confu/client/library";
import { buttonClass, eyebrowClass, ghostButtonClass } from "@confu/ui/classes";
import { ago, dropHandlers, isPdf } from "./chrome";
import { useDevice, useLocal } from "./local";

type Row = LocalSession & { files: number };

async function loadLibrary(store: Parameters<typeof listSessions>[0]): Promise<Row[]> {
  const [sessions, counts] = await Promise.all([
    listSessions(store),
    store.query<{ session_id: string; n: number }>(`SELECT session_id, count(*) AS n FROM documents GROUP BY session_id`),
  ]);
  const n = new Map(counts.map((c) => [c.session_id, c.n]));
  return sessions.map((s) => ({ ...s, files: n.get(s.id) ?? 0 }));
}

export function Library({ onOpen }: { onOpen: (id: string, files?: File[]) => void }) {
  const device = useDevice();
  const { data: sessions } = useLocal((d) => loadLibrary(d.store), []);
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function start(files?: File[]) {
    setProblem(null);
    const pdfs = files?.filter(isPdf);
    if (files && !pdfs?.length) return setProblem("Only PDFs can be added for now.");
    setBusy(true);
    try {
      const s = await createSession(device.store, { title: pdfs?.length ? pdfTitle(pdfs[0].name) : undefined });
      device.changed();
      onOpen(s.id, pdfs);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't create the session.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" {...dropHandlers((f) => void start(f))}>
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className={eyebrowClass}>On this device</p>
            <h1 className="mt-1 font-serif text-3xl sm:text-4xl">Your library</h1>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => start()} disabled={busy} className={ghostButtonClass}>
              New session
            </button>
            <button type="button" onClick={() => picker.current?.click()} disabled={busy} className={buttonClass}>
              Open PDFs
            </button>
            <input
              ref={picker}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = "";
                if (picked.length) void start(picked);
              }}
            />
          </div>
        </div>

        {problem && <p className="animate-pop mt-6 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{problem}</p>}

        {sessions && sessions.length === 0 && (
          <div className="mt-10 rounded-2xl border border-dashed border-ink/40 bg-panel px-6 py-14 text-center">
            <h2 className="font-serif text-2xl">Start with a PDF</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
              Drop a textbook, lecture notes or a paper here. Confu reads it on this device, and the tutor answers from it with page citations, using
              your own AI.
            </p>
            <button type="button" onClick={() => picker.current?.click()} disabled={busy} className={`${buttonClass} mt-6`}>
              Choose PDFs
            </button>
            <p className="mt-6 text-xs text-muted">No account needed. Your files and chats stay in this browser.</p>
          </div>
        )}

        {sessions && sessions.length > 0 && (
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((s) => (
              <SessionCard key={s.id} s={s} onOpen={() => onOpen(s.id)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SessionCard({ s, onOpen }: { s: Row; onOpen: () => void }) {
  const { store, files, changed } = useDevice();
  const [menu, setMenu] = useState(false);
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full flex-col rounded-xl border border-ink bg-panel p-4 text-left transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-hard-sm"
      >
        <span className="line-clamp-2 pr-8 font-serif text-lg leading-snug">{s.title}</span>
        <span className="mt-auto pt-4 font-mono text-[11px] text-muted">
          {s.files === 0 ? "No files" : s.files === 1 ? "1 file" : `${s.files} files`} · {ago(s.updated_at)}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Options for ${s.title}`}
        onClick={() => setMenu((m) => !m)}
        onBlur={(e) => !e.currentTarget.parentElement?.contains(e.relatedTarget) && setMenu(false)}
        className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-full text-muted opacity-60 transition group-hover:opacity-100 hover:bg-paper hover:text-ink"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {menu && (
        <div className="animate-pop absolute top-11 right-3 z-20 w-40 overflow-hidden rounded-xl border border-ink bg-panel p-1 shadow-hard">
          <button
            type="button"
            onClick={async () => {
              setMenu(false);
              const title = window.prompt("Rename session", s.title);
              if (title === null) return;
              await updateSession(store, s.id, { title });
              changed();
            }}
            className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-paper"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={async () => {
              setMenu(false);
              if (!window.confirm(`Delete “${s.title}”? Its files, chat and progress are removed from this device.`)) return;
              await deleteSession(store, files, s.id);
              changed();
            }}
            className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-danger hover:bg-paper"
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

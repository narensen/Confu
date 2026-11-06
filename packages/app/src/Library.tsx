"use client";

import { useRef, useState } from "react";
import { importSession } from "@confu/client/bundle";
import { startCourse } from "@confu/client/courses";
import { TEMPLATES, type Template } from "@confu/core/templates";
import { createSession, deleteSession, listSessions, pdfTitle, updateSession, type LocalSession } from "@confu/client/library";
import { buttonClass, eyebrowClass, ghostButtonClass } from "@confu/ui/classes";
import { useEnter, useFlip } from "@confu/ui/motion";
import { ago, dropHandlers, isPdf } from "./chrome";
import { useHost } from "./host";
import { useDevice, useLocal } from "./local";
import { BringOver } from "./SyncPanel";

type Row = LocalSession & { files: number };

async function loadLibrary(store: Parameters<typeof listSessions>[0]): Promise<Row[]> {
  const [sessions, counts] = await Promise.all([
    listSessions(store),
    store.query<{ session_id: string; n: number }>(`SELECT session_id, count(*) AS n FROM documents GROUP BY session_id`),
  ]);
  const n = new Map(counts.map((c) => [c.session_id, c.n]));
  return sessions.map((s) => ({ ...s, files: n.get(s.id) ?? 0 }));
}

export function Library({ onOpen }: { onOpen: (id: string, files?: File[], tool?: "plan") => void }) {
  const device = useDevice();
  const { data: sessions } = useLocal((d) => loadLibrary(d.store), []);
  const { account } = useHost();
  const picker = useRef<HTMLInputElement>(null);
  const sessionFile = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const page = useRef<HTMLDivElement>(null);
  // Once the library is read, everything cascades in; later, cards glide
  // into place when one is removed.
  useEnter(page, [Boolean(sessions)]);
  const beforeChange = useFlip(page, [sessions]);

  async function openSessionFile(file: File) {
    setProblem(null);
    setBusy(true);
    try {
      const s = await importSession(device.store, device.files, file);
      device.changed();
      onOpen(s.id);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't open that file.");
    } finally {
      setBusy(false);
    }
  }

  async function start(files?: File[]) {
    setProblem(null);
    const sessionFiles = files?.filter((f) => /\.confu$/i.test(f.name)) ?? [];
    if (sessionFiles.length) return openSessionFile(sessionFiles[0]);
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
    <div ref={page} className="min-h-0 flex-1 overflow-y-auto" {...dropHandlers((f) => void start(f))}>
      {/* Read from this device in a moment; shown all at once when it is. */}
      {sessions && (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <div data-enter className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className={eyebrowClass}>On this device</p>
            <h1 className="mt-1 font-serif text-3xl sm:text-4xl">Your library</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => sessionFile.current?.click()} disabled={busy} className={ghostButtonClass} title="Open a session someone shared with you (.confu)">
              Open a session file
            </button>
            <input
              ref={sessionFile}
              type="file"
              accept=".confu,application/x-confu-session"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void openSessionFile(file);
              }}
            />
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
          <div data-enter className="mt-10 rounded-2xl border border-dashed border-ink/40 bg-panel px-6 py-14 text-center">
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

        {sessions && sessions.length === 0 && account && (
          <div data-enter className="mx-auto mt-6 max-w-md rounded-2xl border border-ink bg-panel p-5">
            <h2 className="mb-2 font-serif text-xl">Already studying on Confu?</h2>
            <BringOver compact />
          </div>
        )}

        {sessions && sessions.length > 0 && (
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((s) => (
              <SessionCard key={s.id} s={s} onOpen={() => onOpen(s.id)} beforeRemove={beforeChange} />
            ))}
          </ul>
        )}

        <Courses onOpen={onOpen} />
      </div>
      )}
    </div>
  );
}

function SessionCard({ s, onOpen, beforeRemove }: { s: Row; onOpen: () => void; beforeRemove: () => void }) {
  const { store, files, changed } = useDevice();
  const [menu, setMenu] = useState(false);
  return (
    <li data-enter data-flip className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full flex-col rounded-xl border border-ink bg-panel p-4 text-left transition-[background-color,scale] duration-150 hover:bg-paper active:scale-[0.985]"
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
              beforeRemove();
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

// Ready-made courses: a goal, a plan of topics over a few weeks, and free
// sources (videos, readings, open papers).
function Courses({ onOpen }: { onOpen: (id: string, files?: File[], tool?: "plan") => void }) {
  const { store, changed } = useDevice();
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const shown = all ? TEMPLATES : TEMPLATES.slice(0, 6);
  const list = useRef<HTMLUListElement>(null);
  const beforeToggle = useFlip(list, [all]);

  async function start(t: Template) {
    setBusy(t.slug);
    try {
      const s = await startCourse(store, t);
      changed();
      onOpen(s.id, undefined, "plan");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-14">
      <div data-enter className="flex items-end justify-between gap-4">
        <div>
          <p className={eyebrowClass}>Start from a course</p>
          <h2 className="mt-1 font-serif text-2xl">A plan and free sources, ready to go</h2>
        </div>
        {TEMPLATES.length > 6 && (
          <button
            type="button"
            onClick={() => {
              beforeToggle();
              setAll((a) => !a);
            }}
            className="shrink-0 text-sm font-medium underline underline-offset-2"
          >
            {all ? "Fewer" : `All ${TEMPLATES.length}`}
          </button>
        )}
      </div>
      <ul ref={list} className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((t) => (
          <li key={t.slug} data-enter data-flip className="flex flex-col rounded-xl border border-ink/25 bg-panel p-4">
            <span className="font-serif text-lg leading-snug">{t.title}</span>
            <span className="mt-1 line-clamp-2 text-sm text-muted">{t.tagline}</span>
            <span className="mt-auto flex items-center justify-between gap-2 pt-4">
              <span className="font-mono text-[11px] text-muted">
                {t.weeks} wk · {t.minutesPerDay} min/day · {t.level}
              </span>
              <button type="button" disabled={Boolean(busy)} onClick={() => start(t)} className={`${ghostButtonClass} px-3 py-1 text-xs`}>
                {busy === t.slug ? "Starting…" : "Start"}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

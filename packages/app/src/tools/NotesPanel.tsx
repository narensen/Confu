"use client";

import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { diff, encodeDoc, joinLive, moveIndex, newShareCode, noteDoc } from "@confu/client/live";
import { deleteNote, listNotes, saveNote, type LocalNote } from "@confu/client/tools";
import { eyebrowClass, ghostButtonClass } from "@confu/ui/classes";
import { Markdown } from "@confu/ui/Markdown";
import { useHost } from "../host";
import { useDevice, useLocal } from "../local";

// The student's own notes, in Markdown (math and chemistry render in the
// preview). Each note is a Yjs document, so it can be edited live with
// others: "Edit together" makes a link with an end-to-end encrypted room.

const SAVE_MS = 700;

export function NotesPanel({ sessionId, openNoteId, joinCode }: { sessionId: string; openNoteId?: string | null; joinCode?: string | null }) {
  const { store, changed } = useDevice();
  const { data: notes } = useLocal((d) => listNotes(d.store, sessionId), [sessionId]);
  const [openId, setOpenId] = useState<string | null>(openNoteId ?? null);
  const current = notes?.find((n) => n.id === openId) ?? notes?.[0] ?? null;

  async function create() {
    const id = await saveNote(store, { sessionId, title: "Notes", content: "" });
    changed();
    setOpenId(id);
  }

  if (!notes) return <div className="h-full bg-panel" />;
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel sm:flex-row">
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 sm:w-52 sm:flex-col sm:border-r sm:border-b-0">
        <button type="button" onClick={create} className="shrink-0 rounded-lg border border-dashed border-ink/40 px-3 py-1.5 text-left text-xs font-medium text-muted transition hover:border-ink hover:text-ink">
          + New note
        </button>
        {notes.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => setOpenId(n.id)}
            className={`shrink-0 truncate rounded-lg px-3 py-1.5 text-left text-sm transition ${n.id === current?.id ? "bg-ink text-white" : "hover:bg-paper"}`}
          >
            {n.title}
          </button>
        ))}
      </nav>
      <div className="min-h-0 min-w-0 flex-1">
        {current ? (
          <NoteEditor key={current.id} note={current} joinCode={current.id === openNoteId ? joinCode : null} onDeleted={() => setOpenId(null)} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div>
              <h2 className="font-serif text-xl">Your notes</h2>
              <p className="mt-1.5 text-sm text-muted">Markdown, with math ($E=mc^2$) and chemistry ($\ce{'{'}H2O{'}'}$).</p>
              <button type="button" onClick={create} className={`${ghostButtonClass} mt-4`}>
                Start a note
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NoteEditor({ note, joinCode, onDeleted }: { note: LocalNote; joinCode: string | null | undefined; onDeleted: () => void }) {
  const { store, changed } = useDevice();
  const host = useHost();
  const [doc] = useState<Y.Doc>(() => noteDoc(note));
  const [text, setText] = useState(() => doc.getText("content").toString());
  const [title, setTitle] = useState(note.title);
  const [mode, setMode] = useState<"edit" | "preview">(note.content ? "preview" : "edit");
  const [code, setCode] = useState<string | null>(joinCode ?? null);
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Save a moment after the last change (local or from someone else).
  useEffect(() => {
    const ytext = doc.getText("content");
    const save = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveNote(store, { id: note.id, sessionId: note.session_id, content: ytext.toString(), ydoc: encodeDoc(doc) }), SAVE_MS);
    };
    const observe = (e: Y.YTextEvent) => {
      const el = area.current;
      const next = ytext.toString();
      if (!e.transaction.local && el && document.activeElement === el) {
        // Someone else typed: keep my cursor where it was in the text.
        const start = moveIndex(el.selectionStart, e.delta as { retain?: number; insert?: unknown; delete?: number }[]);
        const end = moveIndex(el.selectionEnd, e.delta as { retain?: number; insert?: unknown; delete?: number }[]);
        setText(next);
        requestAnimationFrame(() => el.setSelectionRange(start, end));
      } else setText(next);
      save();
    };
    ytext.observe(observe);
    return () => {
      ytext.unobserve(observe);
      if (timer.current) {
        clearTimeout(timer.current);
        void saveNote(store, { id: note.id, sessionId: note.session_id, content: ytext.toString(), ydoc: encodeDoc(doc) }).then(() => changed());
      }
    };
  }, [doc, store, note.id, note.session_id, changed]);

  // Live editing, while a share code is set.
  useEffect(() => {
    if (!code || !host.live) return;
    let left = false;
    let leave = () => {};
    void store.setMeta(`note.share.${note.id}`, code);
    void joinLive(doc, code, host.live).then((live) => {
      if (left) live.leave();
      else leave = live.leave;
    });
    return () => {
      left = true;
      leave();
    };
  }, [code, doc, host.live, note.id, store]);

  // A note shared before keeps its room.
  useEffect(() => {
    if (code) return;
    void store.getMeta(`note.share.${note.id}`).then((c) => c && setCode(c));
  }, [code, note.id, store]);

  function onInput(next: string) {
    const ytext = doc.getText("content");
    const d = diff(ytext.toString(), next);
    doc.transact(() => {
      if (d.remove) ytext.delete(d.index, d.remove);
      if (d.insert) ytext.insert(d.index, d.insert);
    });
  }

  const link = code && host.shareNoteUrl ? host.shareNoteUrl(code) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={async () => {
            if (title.trim() !== note.title) {
              await saveNote(store, { id: note.id, sessionId: note.session_id, title, content: doc.getText("content").toString() });
              changed();
            }
          }}
          aria-label="Note title"
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-1 font-serif text-lg outline-none hover:bg-paper focus:bg-paper"
        />
        <div className="flex rounded-full border border-ink/25 p-0.5 text-xs">
          {(["edit", "preview"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-full px-3 py-1 transition ${mode === m ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
              {m === "edit" ? "Write" : "Read"}
            </button>
          ))}
        </div>
        {host.live && (
          <button type="button" onClick={() => setCode((c) => c ?? newShareCode())} className="rounded-full px-2.5 py-1 text-xs font-medium text-muted transition hover:bg-paper hover:text-ink">
            {code ? "Live" : "Edit together"}
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm(`Delete “${note.title}”?`)) return;
            if (timer.current) clearTimeout(timer.current);
            await deleteNote(store, note.id);
            await store.setMeta(`note.share.${note.id}`, null);
            changed();
            onDeleted();
          }}
          className="rounded-full px-2.5 py-1 text-xs text-danger"
        >
          Delete
        </button>
      </div>
      {link && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-paper px-4 py-2 text-xs">
          <span className="size-1.5 animate-pulse rounded-full bg-ok" aria-hidden />
          <span className="text-muted">Anyone with this link edits along with you (end-to-end encrypted):</span>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded border border-ink/20 bg-panel px-2 py-1 font-mono" />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            }}
            className="font-medium"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={async () => {
              await store.setMeta(`note.share.${note.id}`, null);
              setCode(null);
            }}
            className="text-muted hover:text-ink"
          >
            Stop
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode === "edit" ? (
          <textarea
            ref={area}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              onInput(e.target.value);
            }}
            placeholder={"# Heading\n\nWrite in Markdown. $\\int_0^1 x\\,dx$ for math, $\\ce{CO2}$ for chemistry."}
            spellCheck
            className="block h-full min-h-80 w-full resize-none bg-transparent px-5 py-4 font-mono text-sm leading-6 outline-none"
            aria-label="Note"
          />
        ) : (
          <div className="mx-auto max-w-2xl px-5 py-4">
            {text.trim() ? <Markdown content={text} /> : <p className={eyebrowClass}>Empty note</p>}
          </div>
        )}
      </div>
    </div>
  );
}

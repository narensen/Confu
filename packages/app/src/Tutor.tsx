"use client";

import { useEffect, useRef, useState } from "react";
import type { LocalDocument, LocalMessage } from "@confu/client/library";
import { clearChat, listMessages, updateSession } from "@confu/client/library";
import { askTutor, type AskInput } from "@confu/client/tutor/ask";
import { ACTION_LABELS } from "@confu/core/tutor/format";
import { docLabel, type TutorAction } from "@confu/core/types";
import { eyebrowClass } from "@confu/ui/classes";
import { Markdown } from "@confu/ui/Markdown";
import { useArrive } from "@confu/ui/motion";
import { KeySetup, useAiKey } from "./KeySetup";
import { useDevice, useLocal } from "./local";

// The tutor, on this device: the question, the pages it needs, and the
// answer all stay here, except what goes to the student's own AI provider.

export type Ask = Pick<AskInput, "action" | "message" | "selection" | "topicId"> & { label?: string };

type Live = { user: string; action: TutorAction; text: string; status: string | null };

const STARTERS: { label: string; ask: Ask }[] = [
  { label: "Summarize this page", ask: { action: "chat", message: "Summarize this page in a few bullet points." } },
  { label: "Explain the main idea", ask: { action: "chat", message: "What's the main idea here, and why does it matter?" } },
  { label: "Quiz me on this page", ask: { action: "chat", message: "Ask me three short questions to check I understood this page. Don't give the answers yet." } },
];

export function Tutor({
  sessionId,
  citeMode,
  docs,
  activeDoc,
  page,
  incoming,
  onCite,
}: {
  sessionId: string;
  citeMode: boolean;
  docs: LocalDocument[];
  activeDoc: LocalDocument | null;
  page: number;
  incoming: (Ask & { seq: number }) | null; // asked from the reader
  onCite: (docId: string, page: number) => void;
}) {
  const device = useDevice();
  const { data: key } = useAiKey();
  const { data: messages = [] } = useLocal((d) => listMessages(d.store, sessionId), [sessionId]);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const handled = useRef(0);
  const shown = messages.filter((m) => m.content);

  async function send(ask: Ask) {
    if (live) return;
    setError(null);
    const preview = ask.message?.trim() || (ask.selection ? `> ${ask.selection.text.slice(0, 280)}` : (ask.label ?? ""));
    setLive({ user: preview, action: ask.action, text: "", status: null });
    try {
      for await (const ev of askTutor(
        { store: device.store, keys: device.keys },
        { sessionId, documentId: activeDoc?.id ?? null, page: activeDoc ? page : null, action: ask.action, message: ask.message, selection: ask.selection, topicId: ask.topicId },
      )) {
        if (ev.type === "text") setLive((l) => (l ? { ...l, text: l.text + ev.text, status: null } : l));
        else if (ev.type === "status") setLive((l) => (l ? { ...l, status: ev.label } : l));
        else if (ev.type === "error") setError(ev.error);
        else if (ev.type === "done") void ev.notes.catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLive(null);
      device.changed();
    }
  }

  // A question asked from the reader (a selected passage).
  useEffect(() => {
    if (!incoming || incoming.seq === handled.current) return;
    handled.current = incoming.seq;
    void send(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  // The question just asked eases in (an answer already given doesn't replay).
  const turn = useRef<HTMLDivElement>(null);
  useArrive(turn, [Boolean(live)], { y: 10, initial: false });

  // Follow the answer as it's written, unless the student scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [live?.text, shown.length]);

  const submit = () => {
    const message = draft.trim();
    if (!message || live) return;
    setDraft("");
    void send({ action: "chat", message });
  };

  const cite = (p: number, label?: string) => {
    const doc = label ? docs.find((_, i) => docLabel(i) === label) : activeDoc;
    if (doc) onCite(doc.id, p);
  };

  if (key === undefined) return <div className="h-full bg-panel" />;

  if (!key) {
    return (
      <div className="h-full overflow-y-auto bg-panel px-5 py-6">
        <div className="mx-auto max-w-md">
          <p className={eyebrowClass}>Tutor</p>
          <h2 className="mt-1 font-serif text-2xl">Connect your AI to start</h2>
          <p className="mt-2 mb-5 text-sm leading-relaxed text-muted">Confu has no AI of its own. Use your OpenRouter account or a key from any provider.</p>
          <KeySetup />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2 text-xs">
        <span className={eyebrowClass}>Tutor</span>
        <label title="Answers have to cite a page in this session." className="ml-auto flex cursor-pointer items-center gap-1.5 text-muted">
          <input
            type="checkbox"
            checked={citeMode}
            onChange={async (e) => {
              await updateSession(device.store, sessionId, { cite_mode: e.target.checked });
              device.changed();
            }}
            className="size-3.5"
          />
          Answers must cite
        </label>
        {shown.length > 0 && (
          <button
            type="button"
            disabled={Boolean(live)}
            onClick={async () => {
              if (!window.confirm("Clear this chat? Saved notes about your progress stay.")) return;
              await clearChat(device.store, sessionId);
              device.changed();
            }}
            className="text-muted hover:text-ink disabled:opacity-40"
          >
            Clear
          </button>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 pt-5 pb-4">
        <div className="mx-auto w-full max-w-3xl space-y-5">
          {shown.length === 0 && !live && (
            <div className="py-6">
              <h2 className="font-serif text-2xl">Ask about {activeDoc ? "what you're reading" : "anything"}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                {activeDoc ? "Answers cite the pages they come from. Select text in the file to ask about just that passage." : "Add a PDF and the tutor answers from it, citing pages."}
              </p>
              {activeDoc && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {STARTERS.map((s) => (
                    <button key={s.label} type="button" onClick={() => send(s.ask)} className="rounded-full border border-ink/25 px-3 py-1.5 text-xs transition hover:border-ink">
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {shown.map((m) => (
            <Message key={m.id} m={m} onCite={cite} />
          ))}

          {live && (
            <div ref={turn} className="space-y-5">
              <UserTurn action={live.action} content={live.user} onCite={cite} />
              <div className="pr-2">
                {live.text ? (
                  <div className="is-streaming">
                    <Markdown content={live.text} onPage={cite} live />
                  </div>
                ) : (
                  <Thinking label={live.status ?? "Thinking…"} />
                )}
              </div>
            </div>
          )}

          {error && <p className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
        </div>
      </div>

      <div className="shrink-0 px-3 pt-1 pb-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="tutor-composer mx-auto flex max-w-3xl items-end gap-1.5 rounded-[24px] border py-1.5 pr-1.5 pl-4 transition-[border-color] duration-200 ease-fluid"
        >
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={activeDoc ? "Ask about this file, or anything…" : "Ask anything…"}
            className="max-h-40 min-h-9 flex-1 resize-none self-center bg-transparent py-2 text-sm leading-5 outline-none placeholder:text-muted"
          />
          <button disabled={!draft.trim() || Boolean(live)} aria-label="Send" title="Send (Enter)" className="tutor-send flex size-9 shrink-0 items-center justify-center rounded-full">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

function Message({ m, onCite }: { m: LocalMessage; onCite: (page: number, label?: string) => void }) {
  if (m.role === "user") return <UserTurn action={m.action as TutorAction} content={m.content} onCite={onCite} />;
  return (
    <div className="pr-2">
      <Markdown content={m.content} onPage={onCite} />
    </div>
  );
}

function UserTurn({ action, content, onCite }: { action: TutorAction; content: string; onCite: (page: number, label?: string) => void }) {
  return (
    <div className="ml-10">
      <div className="rounded-xl rounded-br-sm border border-ink bg-panel px-4 py-3 text-sm shadow-hard-sm">
        {action !== "chat" && ACTION_LABELS[action] && <p className={`${eyebrowClass} mb-1.5`}>{ACTION_LABELS[action]}</p>}
        <Markdown content={content} onPage={onCite} />
      </div>
    </div>
  );
}

function Thinking({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 py-1 font-mono text-[11px] text-muted" role="status">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-bounce rounded-full bg-ink" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
      <span className="ml-1">{label}</span>
    </p>
  );
}

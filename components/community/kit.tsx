"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/dialogs";
import { buttonClass, eyebrowClass, inputClass } from "@/components/ui";
import { Markdown } from "@/components/workspace/Markdown";
import { browseSpaces, createThread, loadSpaces, toggleVote, type SpaceCard, type SpaceRef } from "@/lib/community";
import { track } from "@/lib/telemetry";

// Shared pieces of Threads and Spaces: people, subjects, votes, and the
// composer (Markdown with maths, with a preview).

/* ----------------------------------------------------------------- people */

const TONES = ["bg-yellow-200", "bg-accent-soft", "bg-panel", "bg-yellow-100"];

export function Avatar({ name, size = "md", me = false }: { name: string; size?: "sm" | "md" | "lg"; me?: boolean }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const tone = me ? "bg-yellow-300" : TONES[Math.abs(hash) % TONES.length];
  const box = size === "sm" ? "size-6 text-[11px]" : size === "lg" ? "size-11 text-lg" : "size-8 text-sm";
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-full border border-ink font-serif ${box} ${tone}`}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/* --------------------------------------------------------------- subjects */

export function SpaceIcon({ space, size = "md" }: { space: Pick<SpaceRef, "icon" | "visibility" | "name">; size?: "sm" | "md" | "lg" }) {
  const box = size === "sm" ? "size-6 text-sm rounded-md" : size === "lg" ? "size-14 text-3xl rounded-2xl" : "size-9 text-lg rounded-lg";
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center border border-ink bg-panel ${box}`}>
      {space.icon ? (
        space.icon
      ) : space.visibility === "private" ? (
        <svg width="45%" height="45%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      ) : (
        <span className="font-serif">{space.name.slice(0, 1)}</span>
      )}
    </span>
  );
}

export function SpaceChip({ space }: { space: SpaceRef }) {
  return (
    <Link
      href={`/spaces/${space.slug}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink/25 bg-panel px-2 py-0.5 text-[11px] font-medium transition hover:border-ink"
    >
      <span aria-hidden>{space.icon || (space.visibility === "private" ? "🔒" : "#")}</span>
      <span className="truncate">{space.name}</span>
    </Link>
  );
}

/* ------------------------------------------------------------------ votes */

export function VoteButton({
  postId,
  votes,
  voted,
  mine,
  layout = "row",
  onChange,
}: {
  postId: string;
  votes: number;
  voted: boolean;
  mine: boolean;
  layout?: "row" | "column";
  onChange?: (next: { votes: number; voted: boolean }) => void;
}) {
  const [state, setState] = useState({ votes, voted });
  const [busy, setBusy] = useState(false);
  // Follow fresh data from the server (a reload after replying).
  const [seen, setSeen] = useState({ votes, voted });
  if (seen.votes !== votes || seen.voted !== voted) {
    setSeen({ votes, voted });
    setState({ votes, voted });
  }

  async function vote() {
    if (mine || busy) return;
    const optimistic = { voted: !state.voted, votes: state.votes + (state.voted ? -1 : 1) };
    setState(optimistic);
    setBusy(true);
    try {
      const next = await toggleVote(postId);
      setState(next);
      onChange?.(next);
      if (next.voted) track("thread.vote");
    } catch (err) {
      setState(state);
      toast(err instanceof Error ? err.message : "Couldn't vote.", "error");
    } finally {
      setBusy(false);
    }
  }

  const column = layout === "column";
  return (
    <button
      type="button"
      onClick={() => void vote()}
      aria-pressed={state.voted}
      disabled={mine}
      title={mine ? "You can't vote on your own post" : state.voted ? "Take back your vote" : "Helpful"}
      className={`group inline-flex shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-medium tabular-nums transition duration-150 active:scale-95 disabled:cursor-default ${
        column ? "w-11 flex-col gap-0.5 py-1.5" : "gap-1.5 px-2 py-1"
      } ${state.voted ? "border-ink bg-ink text-white" : "border-ink/25 bg-panel enabled:hover:border-ink"} ${mine ? "opacity-60" : ""}`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden className={state.voted ? "" : "text-muted group-enabled:group-hover:text-ink"}>
        <path d="M12 4 3 15h6v5h6v-5h6z" />
      </svg>
      <span>{state.votes}</span>
    </button>
  );
}

/* --------------------------------------------------------------- composer */

// A Markdown box with Write and Preview. Maths in $…$ and $$…$$.
export function MarkdownField({
  value,
  onChange,
  placeholder,
  rows = 5,
  autoFocus,
  label = "Details",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  rows?: number;
  autoFocus?: boolean;
  label?: string;
}) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const id = useId();
  return (
    <div className="overflow-hidden rounded-lg border border-ink/25 bg-panel transition focus-within:border-ink focus-within:shadow-hard-sm">
      <div className="flex items-center gap-1 border-b border-line bg-paper px-1.5 py-1">
        {(["write", "preview"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${mode === m ? "bg-panel text-ink shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-ink"}`}
          >
            {m}
          </button>
        ))}
        <span className="ml-auto hidden pr-1.5 font-mono text-[10px] text-muted sm:inline">**bold** · `code` · $x^2$ · - list</span>
      </div>
      {mode === "write" ? (
        <textarea
          id={id}
          aria-label={label}
          value={value}
          maxLength={8000}
          rows={rows}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="block w-full resize-y bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted/70"
        />
      ) : (
        <div className="min-h-28 px-3 py-2.5">
          {value.trim() ? <Markdown content={value} /> : <p className="text-sm text-muted">Nothing to preview yet.</p>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- ask dialog */

type Choice = { id: string | null; label: string; icon: string; group: string };

// Ask a question: where (anyone, a subject, or one of your private spaces),
// the question in one line, then the details.
export function AskDialog({ initialSpaceId, onClose, onPosted }: { initialSpaceId?: string | null; onClose: () => void; onPosted: (id: string) => void }) {
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(initialSpaceId ?? null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    let live = true;
    void Promise.all([browseSpaces().catch(() => [] as SpaceCard[]), loadSpaces().catch(() => [] as SpaceCard[])]).then(([subjects, mine]) => {
      if (!live) return;
      setChoices([
        { id: null, label: "Everyone (no subject)", icon: "💬", group: "" },
        ...subjects.map((s) => ({ id: s.id, label: s.name, icon: s.icon, group: s.category || "Subjects" })),
        ...mine.filter((s) => s.visibility === "private").map((s) => ({ id: s.id, label: s.name, icon: "🔒", group: "Your private spaces" })),
      ]);
    });
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  async function submit() {
    setError(null);
    if (title.trim().length < 3) return setError("Ask it in one sentence.");
    if (!body.trim()) return setError("Add a little more so people can answer: what you're stuck on, and what you've tried.");
    setPending(true);
    try {
      const id = await createThread({ title, body, spaceId });
      track("thread.post", { space: Boolean(spaceId) });
      onPosted(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post that.");
      setPending(false);
    }
  }

  const groups = choices ? [...new Set(choices.map((c) => c.group))] : [];
  const picked = choices?.find((c) => c.id === spaceId);

  return createPortal(
    <div className="animate-fade fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-ink/40 p-3 backdrop-blur-[2px] sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="animate-pop my-6 w-full max-w-2xl overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard"
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink px-6 pt-5 pb-4">
          <div>
            <p className={eyebrowClass}>New question</p>
            <h2 id="ask-title" className="mt-1 font-serif text-2xl">
              Ask the community
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-paper">
            ✕
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Where</span>
            <span className="flex items-center gap-2">
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-ink text-lg">
                {picked?.icon ?? "💬"}
              </span>
              <select value={spaceId ?? ""} onChange={(e) => setSpaceId(e.target.value || null)} disabled={!choices} className={inputClass}>
                {!choices && <option>Loading subjects…</option>}
                {groups.map((g) =>
                  g ? (
                    <optgroup key={g} label={g}>
                      {choices!
                        .filter((c) => c.group === g)
                        .map((c) => (
                          <option key={c.id ?? "none"} value={c.id ?? ""}>
                            {c.label}
                          </option>
                        ))}
                    </optgroup>
                  ) : (
                    choices!
                      .filter((c) => c.group === g)
                      .map((c) => (
                        <option key={c.id ?? "none"} value={c.id ?? ""}>
                          {c.label}
                        </option>
                      ))
                  ),
                )}
              </select>
            </span>
            <span className="mt-1 block text-xs text-muted">Picking a subject puts it in front of the people who follow it, and makes it easier to find.</span>
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-baseline justify-between text-sm font-medium">
              Your question
              <span className={`font-mono text-[10px] ${title.length > 140 ? "text-warn" : "text-muted"}`}>{title.length}/160</span>
            </span>
            <input ref={titleRef} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Why does the electric field vanish inside a conductor?" className={inputClass} />
          </label>
          <div>
            <span className="mb-1.5 block text-sm font-medium">Details</span>
            <MarkdownField value={body} onChange={setBody} rows={7} placeholder="The part you're stuck on, what you've tried, and where it's from (a book, a lecture, a past paper)." />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line bg-paper px-6 py-3.5">
          <p className="text-xs text-muted">Be kind. Anyone signed in can read and answer.</p>
          <button type="submit" disabled={pending} className={buttonClass}>
            {pending ? "Posting…" : "Post question"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function AskButton({ spaceId, className, children = "Ask a question", onPosted }: { spaceId?: string | null; className?: string; children?: ReactNode; onPosted: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className ?? buttonClass}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        {children}
      </button>
      {open && (
        <AskDialog
          initialSpaceId={spaceId}
          onClose={() => setOpen(false)}
          onPosted={(id) => {
            setOpen(false);
            onPosted(id);
          }}
        />
      )}
    </>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">{children}</p>;
}

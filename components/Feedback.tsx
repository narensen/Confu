"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/dialogs";
import { createClient } from "@/lib/supabase/client";
import { routeOf, track } from "@/lib/telemetry";

// "Send feedback": opens from anywhere with openFeedback(), lands in the
// owner's admin dashboard (feedback table, migration 0018).

type Kind = "bug" | "idea" | "confusing" | "love";
const EVENT = "confu:feedback";

const KINDS: { id: Kind; label: string; placeholder: string }[] = [
  { id: "bug", label: "Something broke", placeholder: "What happened, and what did you expect instead?" },
  { id: "idea", label: "Idea", placeholder: "What would make Confu better for you?" },
  { id: "confusing", label: "Confusing", placeholder: "What was unclear or hard to find?" },
  { id: "love", label: "Love it", placeholder: "What's working well for you?" },
];

export function openFeedback(opts: { kind?: Kind; message?: string } = {}) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: opts }));
}

export function FeedbackHost() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("idea");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ kind?: Kind; message?: string }>).detail ?? {};
      setKind(d.kind ?? "idea");
      setMessage(d.message ?? "");
      setError(null);
      setOpen(true);
      track("feedback.open");
    };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send() {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    const { error: err } = await createClient()
      .from("feedback")
      .insert({ kind, message: message.trim().slice(0, 4000), path: routeOf(location.pathname), user_agent: navigator.userAgent.slice(0, 300) });
    setSending(false);
    if (err) {
      setError("Couldn't send that. Make sure you're signed in, or email confuedu.ai@gmail.com.");
      return;
    }
    track("feedback.sent", { kind });
    setOpen(false);
    toast("Thanks. Every message is read by the person building Confu.");
  }

  if (!open) return null;
  const current = KINDS.find((k) => k.id === kind)!;

  return (
    <div
      className="animate-fade fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="fb-title" className="animate-pop w-full max-w-md rounded-xl border border-ink bg-panel p-5 shadow-[6px_6px_0_0_#0d0d0c]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p id="fb-title" className="font-serif text-2xl leading-tight">
              Send feedback
            </p>
            <p className="mt-1 text-sm text-muted">It goes straight to the person building Confu.</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded px-1.5 text-muted transition hover:text-ink">
            ✕
          </button>
        </div>

        <div role="radiogroup" aria-label="Kind of feedback" className="mt-4 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={kind === k.id}
              onClick={() => setKind(k.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                kind === k.id ? "border-ink bg-ink text-white" : "border-ink/30 hover:border-ink"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <textarea
          ref={box}
          rows={5}
          maxLength={4000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
          placeholder={current.placeholder}
          className="mt-3 w-full resize-y rounded-lg border border-ink/25 bg-panel px-3 py-2 text-sm leading-relaxed outline-none transition placeholder:text-muted/70 focus:border-ink focus:shadow-hard-sm"
        />
        <p className="mt-1 text-[11px] text-muted">We&apos;ll include the page you&apos;re on, so we can find the problem. Nothing else.</p>
        {error && <p className="animate-pop mt-2 text-sm text-danger">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-ink bg-panel px-3.5 py-2 text-sm font-medium transition hover:-translate-y-px hover:shadow-hard-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={!message.trim() || sending}
            onClick={send}
            className="rounded-lg border border-ink bg-ink px-3.5 py-2 text-sm font-medium text-white transition hover:-translate-y-px hover:shadow-[2px_2px_0_0_#facc15] disabled:pointer-events-none disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

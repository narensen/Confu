"use client";

import { useCallback, useEffect, useState } from "react";
import { JSON_HEADERS, readAiError } from "@/lib/ai-errors";
import { createClient } from "@/lib/supabase/client";

export type PagePin = {
  id: string;
  page_number: number;
  quote: string;
  question: string;
  answer: string | null;
  mine: boolean;
  author_name: string | null;
};

// Pins on this PDF. Yours always. A classmate's only when you both share
// progress on the same course, and then only the passage, the question and
// one stored answer.
export function PagePins({
  sessionId,
  documentId,
  page,
  draft,
  onExplain,
}: {
  sessionId: string;
  documentId: string;
  page: number;
  draft: { page: number; text: string } | null;
  onExplain: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pins, setPins] = useState<PagePin[]>([]);
  const [question, setQuestion] = useState("");
  const [quote, setQuote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracked, setTracked] = useState(draft);
  if (draft && draft !== tracked) {
    setTracked(draft);
    setOpen(true);
    setQuote(draft.text.slice(0, 500));
  }

  const load = useCallback(() => {
    void createClient()
      .rpc("list_page_pins", { p_session: sessionId, p_document: documentId })
      .then(({ data, error: err }) => {
        if (err) return;
        setPins((data ?? []) as PagePin[]);
      });
  }, [documentId, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const here = pins.filter((p) => p.page_number === page);

  async function save() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await createClient().rpc("save_page_pin", {
      p_session: sessionId,
      p_document: documentId,
      p_page: page,
      p_quote: quote,
      p_question: question,
    });
    setBusy(false);
    if (err) {
      setError(/save_page_pin|schema cache|Could not find the function/i.test(err.message) ? "Pins need migration 0028 to be run." : err.message);
      return;
    }
    const row = data as PagePin | null;
    if (row?.id) setPins((list) => [row, ...list.filter((p) => p.id !== row.id)]);
    setQuestion("");
    setQuote("");
  }

  async function answer(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pins/answer", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ pinId: id }) });
      if (!res.ok) throw new Error(await readAiError(res));
      const body = (await res.json()) as { answer: string };
      setPins((list) => list.map((p) => (p.id === id ? { ...p, answer: body.answer } : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't answer that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex max-w-sm flex-col items-start gap-2">
      {open && (
        <div className="pointer-events-auto max-h-[50vh] w-80 overflow-y-auto rounded-xl border border-ink bg-panel p-3 shadow-hard">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] tracking-wider text-muted uppercase">Pins · p. {page}</p>
            <button type="button" onClick={onExplain} className="text-xs font-medium underline-offset-2 hover:underline">
              Explain (45s)
            </button>
          </div>
          <ul className="mt-2 space-y-2">
            {here.map((p) => (
              <li key={p.id} className="rounded-lg border border-line bg-paper px-2.5 py-2 text-xs leading-relaxed">
                <p className="font-medium">{p.mine ? "You" : (p.author_name ?? "Someone")}</p>
                {p.quote && <p className="mt-1 text-muted">&ldquo;{p.quote}&rdquo;</p>}
                {p.question && <p className="mt-1">{p.question}</p>}
                {p.answer ? (
                  <p className="mt-1">{p.answer}</p>
                ) : p.mine && p.question ? (
                  <button type="button" disabled={busy} onClick={() => void answer(p.id)} className="mt-1 font-medium underline-offset-2 hover:underline disabled:opacity-40">
                    Answer from this page
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <label className="mt-3 block text-xs">
            <span className="text-muted">Passage</span>
            <textarea value={quote} maxLength={500} rows={2} onChange={(e) => setQuote(e.target.value)} placeholder="Or select text on the page and pin it." className="mt-1 w-full resize-y rounded-md border border-ink/30 bg-panel px-2 py-1 outline-none focus:border-ink" />
          </label>
          <label className="mt-2 block text-xs">
            <span className="text-muted">Question</span>
            <input value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} placeholder="Optional. Answered once for the class." className="mt-1 w-full rounded-md border border-ink/30 bg-panel px-2 py-1 outline-none focus:border-ink" />
          </label>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          <button type="button" disabled={busy || (!quote.trim() && !question.trim())} onClick={() => void save()} className="mt-2 rounded-md border border-ink bg-ink px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
            {busy ? "Saving…" : "Pin this page"}
          </button>
        </div>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} className="pointer-events-auto rounded-md border border-ink bg-panel px-2.5 py-1 text-xs font-medium shadow-hard-sm">
        Pins{here.length ? ` · ${here.length}` : ""}
      </button>
    </div>
  );
}

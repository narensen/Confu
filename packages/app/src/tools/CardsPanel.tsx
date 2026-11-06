"use client";

import { useEffect, useMemo, useState } from "react";
import { GRADES, preview } from "@confu/core/cards";
import type { LocalDocument } from "@confu/client/library";
import { addCard, answerCard, deleteCard, dueCards, listCards, makeCards, saveCard, type LocalCard } from "@confu/client/tools";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@confu/ui/classes";
import { Markdown } from "@confu/ui/Markdown";
import { useDevice, useLocal } from "../local";

// Flashcards: written by the AI from a file's pages (or by hand), reviewed
// with spaced repetition (FSRS).

export function CardsPanel({ sessionId, docs, activeDoc, page, onOpenPage }: { sessionId: string; docs: LocalDocument[]; activeDoc: LocalDocument | null; page: number; onOpenPage: (docId: string, page: number) => void }) {
  const { store, keys, changed } = useDevice();
  const { data: cards = [] } = useLocal((d) => listCards(d.store, sessionId), [sessionId]);
  const [reviewing, setReviewing] = useState(false);
  const [making, setMaking] = useState(false);
  // Due now: asked of the database (with the time at asking), again after
  // every change and every half minute.
  const tick = useTick();
  const { data: dueList = [] } = useLocal((d) => dueCards(d.store, sessionId), [sessionId, tick]);
  const due = dueList.length;

  if (reviewing) return <Review sessionId={sessionId} onDone={() => setReviewing(false)} onOpenPage={onOpenPage} />;

  return (
    <div className="h-full overflow-y-auto bg-panel">
      <div className="mx-auto max-w-2xl space-y-6 px-5 py-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className={eyebrowClass}>Flashcards</p>
            <h2 className="mt-1 font-serif text-2xl">{due ? `${due} to review now` : cards.length ? "All caught up" : "No cards yet"}</h2>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMaking((m) => !m)} className={ghostButtonClass}>
              {making ? "Close" : "Make cards"}
            </button>
            <button type="button" disabled={!due} onClick={() => setReviewing(true)} className={buttonClass}>
              Review
            </button>
          </div>
        </header>

        {(making || !cards.length) && (
          <MakeCards
            sessionId={sessionId}
            docs={docs}
            activeDoc={activeDoc}
            page={page}
            onMade={() => {
              setMaking(false);
              changed();
            }}
            keysReady={keys}
            store={store}
          />
        )}

        {cards.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-ink/20">
            {cards.map((c) => (
              <CardRow key={c.id} card={c} doc={docs.find((d) => d.id === c.document_id) ?? null} onOpenPage={onOpenPage} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function useTick(every = 30_000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), every);
    return () => clearInterval(t);
  }, [every]);
  return tick;
}

function MakeCards({
  sessionId,
  docs,
  activeDoc,
  page,
  onMade,
  store,
  keysReady,
}: {
  sessionId: string;
  docs: LocalDocument[];
  activeDoc: LocalDocument | null;
  page: number;
  onMade: () => void;
  store: ReturnType<typeof useDevice>["store"];
  keysReady: ReturnType<typeof useDevice>["keys"];
}) {
  const [docId, setDocId] = useState(activeDoc?.id ?? docs[0]?.id ?? "");
  const doc = docs.find((d) => d.id === docId) ?? null;
  const [from, setFrom] = useState(String(Math.max(1, page)));
  const [to, setTo] = useState(String(Math.min(doc?.page_count ?? page, Math.max(1, page) + 9)));
  const [count, setCount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  async function write() {
    if (!doc) return;
    setBusy(true);
    setError(null);
    try {
      await makeCards(store, keysReady, { sessionId, documentId: doc.id, title: doc.title, from: Number(from) || 1, to: Number(to) || doc.page_count, count: Number(count) || 10 });
      onMade();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write cards.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-ink bg-paper p-4">
      {docs.length > 0 ? (
        <>
          <p className="text-sm font-medium">Write cards from a file</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select value={docId} onChange={(e) => setDocId(e.target.value)} className={`${inputClass} w-auto max-w-56 py-1.5`} aria-label="File">
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
            <span className="text-muted">pages</span>
            <input value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label="From page" className={`${inputClass} w-14 py-1.5 text-center`} />
            <span className="text-muted">to</span>
            <input value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label="To page" className={`${inputClass} w-14 py-1.5 text-center`} />
            <select value={count} onChange={(e) => setCount(e.target.value)} aria-label="How many" className={`${inputClass} w-auto py-1.5`}>
              {["5", "10", "15", "20"].map((n) => (
                <option key={n} value={n}>
                  {n} cards
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={write} disabled={busy || !doc} className={`${buttonClass} w-full`}>
            {busy ? "Writing cards…" : "Write cards with AI"}
          </button>
        </>
      ) : (
        <p className="text-sm text-muted">Add a file to write cards from it, or write your own below.</p>
      )}
      {error && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      <form
        className="space-y-2 border-t border-line pt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!front.trim() || !back.trim()) return;
          await addCard(store, { sessionId, front, back });
          setFront("");
          setBack("");
          onMade();
        }}
      >
        <p className="text-sm font-medium">Or write one yourself</p>
        <input value={front} onChange={(e) => setFront(e.target.value)} placeholder="Question" className={inputClass} />
        <input value={back} onChange={(e) => setBack(e.target.value)} placeholder="Answer" className={inputClass} />
        <button className={`${ghostButtonClass} w-full`} disabled={!front.trim() || !back.trim()}>
          Add card
        </button>
      </form>
    </div>
  );
}

function CardRow({ card, doc, onOpenPage }: { card: LocalCard; doc: LocalDocument | null; onOpenPage: (docId: string, page: number) => void }) {
  const { store, changed } = useDevice();
  return (
    <li className={`group flex gap-3 px-3 py-2.5 text-sm ${card.suspended ? "opacity-50" : ""}`}>
      <div className="min-w-0 flex-1">
        <Markdown content={card.front} className="prose-tutor prose-compact font-medium" />
        <Markdown content={card.back} className="prose-tutor prose-compact text-muted" />
        <p className="mt-1 font-mono text-[10px] text-muted">
          {card.reps ? `due ${new Date(card.due).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "new"}
          {doc && card.page_number && (
            <>
              {" · "}
              <button type="button" onClick={() => onOpenPage(doc.id, card.page_number!)} className="underline underline-offset-2 hover:text-ink">
                {doc.title}, p. {card.page_number}
              </button>
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-xs opacity-60 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={async () => {
            await saveCard(store, { id: card.id, suspended: !card.suspended });
            changed();
          }}
          className="text-muted hover:text-ink"
        >
          {card.suspended ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          onClick={async () => {
            await deleteCard(store, card.id);
            changed();
          }}
          className="text-danger"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function Review({ sessionId, onDone, onOpenPage }: { sessionId: string; onDone: () => void; onOpenPage: (docId: string, page: number) => void }) {
  const { store, changed } = useDevice();
  const [queue, setQueue] = useState<LocalCard[] | null>(null);
  const [shown, setShown] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const card = queue?.[0] ?? null;
  const intervals = useMemo(() => (card ? preview(card) : null), [card]);

  useEffect(() => {
    void dueCards(store, sessionId).then(setQueue);
  }, [store, sessionId]);

  async function answer(g: 1 | 2 | 3 | 4) {
    if (!card) return;
    await answerCard(store, card, g);
    setReviewed((n) => n + 1);
    setShown(false);
    // "Again" comes back in this sitting; the rest leave the queue.
    setQueue((q) => (q ? [...q.slice(1), ...(g === 1 ? [card] : [])] : q));
    changed();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (!shown && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ["1", "2", "3", "4"].includes(e.key)) void answer(Number(e.key) as 1 | 2 | 3 | 4);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2 text-xs">
        <button type="button" onClick={onDone} className="text-muted hover:text-ink">
          ← Cards
        </button>
        <span className="ml-auto font-mono text-muted">
          {reviewed} done · {queue?.length ?? 0} left
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        {!queue ? null : !card ? (
          <div className="text-center">
            <h2 className="font-serif text-2xl">Done for now</h2>
            <p className="mt-1.5 text-sm text-muted">{reviewed ? `${reviewed} reviewed. The next ones come back when they're due.` : "Nothing is due."}</p>
            <button type="button" onClick={onDone} className={`${buttonClass} mt-5`}>
              Back to cards
            </button>
          </div>
        ) : (
          <div className="w-full max-w-xl">
            <div className="animate-enter rounded-2xl border border-ink bg-panel p-6 shadow-hard">
              <Markdown content={card.front} className="prose-tutor text-lg" />
              {shown && (
                <div className="animate-enter mt-5 border-t border-line pt-5">
                  <Markdown content={card.back} className="prose-tutor" />
                  {card.document_id && card.page_number && (
                    <button type="button" onClick={() => onOpenPage(card.document_id!, card.page_number!)} className="mt-3 font-mono text-[11px] text-muted underline underline-offset-2 hover:text-ink">
                      see p. {card.page_number}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="mt-5">
              {!shown ? (
                <button type="button" onClick={() => setShown(true)} className={`${buttonClass} w-full py-3`}>
                  Show answer <span className="font-mono text-[10px] opacity-60">space</span>
                </button>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {GRADES.map((g) => (
                    <button key={g.grade} type="button" onClick={() => answer(g.grade)} className={`${g.grade === 3 ? buttonClass : ghostButtonClass} flex-col gap-0.5 py-2.5`}>
                      <span>{g.label}</span>
                      <span className="font-mono text-[10px] opacity-60">{intervals?.[g.grade]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

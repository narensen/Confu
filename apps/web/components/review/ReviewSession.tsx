"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { Markdown } from "@confu/ui/Markdown";
import { JSON_HEADERS, notifyAiUsed, readAiError } from "@/lib/ai-errors";
import { cueFor, endOfToday, nextIn, REVIEW_SELECT, revealFor, sessionLink, type ReviewItem, type ReviewRating } from "@/lib/review";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";

type Check = { score: number; feedback: string };

const RATINGS: { id: ReviewRating; label: string; key: string }[] = [
  { id: "again", label: "Missed it", key: "1" },
  { id: "hard", label: "Shaky", key: "2" },
  { id: "good", label: "Got it", key: "3" },
];

export function ReviewSession() {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [nextDue, setNextDue] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tally, setTally] = useState<Record<ReviewRating, number>>({ again: 0, hard: 0, good: 0 });

  useEffect(() => {
    let live = true;
    void Promise.all([
      supabase.from("review_items").select(REVIEW_SELECT).eq("suspended", false).lte("due_at", endOfToday()).order("due_at").limit(60),
      supabase.from("review_items").select("due_at").eq("suspended", false).gt("due_at", endOfToday()).order("due_at").limit(1),
    ]).then(([due, later]) => {
      if (!live) return;
      if (due.error) setError("Couldn't load your reviews. If you just updated Confu, run the newest database migration.");
      setItems((due.data ?? []) as unknown as ReviewItem[]);
      setNextDue((later.data?.[0] as { due_at: string } | undefined)?.due_at ?? null);
    });
    return () => {
      live = false;
    };
  }, [supabase]);

  const item = items?.[index] ?? null;
  const cue = item ? cueFor(item) : null;
  const reveal = item ? revealFor(item) : null;
  const suggested: ReviewRating | null = check ? (check.score >= 1 ? "good" : check.score > 0 ? "hard" : "again") : null;

  async function rate(rating: ReviewRating) {
    if (!item || saving) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.rpc("review_answer", { p_item: item.id, p_rating: rating });
    setSaving(false);
    if (err) return setError("Couldn't save that. Check your connection and try again.");
    setTally((t) => ({ ...t, [rating]: t[rating] + 1 }));
    track("review.rate", { rating, source: item.source });
    advance();
  }

  async function suspend() {
    if (!item) return;
    await supabase.from("review_items").update({ suspended: true }).eq("id", item.id);
    advance();
  }

  function advance() {
    setIndex((i) => i + 1);
    setText("");
    setRevealed(false);
    setCheck(null);
  }

  async function checkAnswer() {
    if (!item || !text.trim()) return;
    track("review.check");
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/review/check", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ itemId: item.id, answer: text }) });
      if (!res.ok) throw new Error(await readAiError(res));
      setCheck((await res.json()) as Check);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check that answer.");
    } finally {
      setChecking(false);
      notifyAiUsed();
    }
  }

  // Keyboard: Enter (with Cmd/Ctrl in the box) reveals; 1/2/3 rate once revealed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "TEXTAREA";
      if (!revealed && e.key === "Enter" && (!typing || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && !typing) {
        const r = RATINGS.find((x) => x.key === e.key);
        if (r) void rate(r.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (items === null) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-6 w-40 rounded" />
        <div className="skeleton h-72 rounded-2xl border border-ink/20" />
      </div>
    );
  }

  const total = items.length;
  const doneCount = tally.again + tally.hard + tally.good;

  if (!item) {
    return (
      <div className="animate-enter rounded-2xl border border-ink bg-panel px-6 py-10 text-center shadow-[4px_4px_0_0_#facc15]">
        <p className={eyebrowClass}>{doneCount ? "Done for today" : "All caught up"}</p>
        <p className="mt-2 font-serif text-3xl">{doneCount ? `${doneCount} reviewed` : "Nothing due today"}</p>
        {doneCount > 0 && (
          <p className="mt-3 text-sm text-muted">
            {tally.good} got it · {tally.hard} shaky · {tally.again} missed. Missed ones come back tomorrow.
          </p>
        )}
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted">
          {nextDue
            ? `Your next review is due ${new Date(nextDue).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}.`
            : "Finish a topic, highlight a passage or practise exam questions, and they'll come back here to review."}
        </p>
        <Link href="/dashboard" className={`${buttonClass} mt-6`}>
          Back to dashboard
        </Link>
        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div key={item.id} className="animate-enter">
      <div className="flex items-center justify-between gap-4">
        <p className={eyebrowClass}>Today&apos;s review</p>
        <span className="font-mono text-xs text-muted tabular-nums">
          {index + 1} of {total}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full border border-ink bg-panel">
        <div className="h-full bg-ink transition-[width] duration-500 ease-fluid" style={{ width: `${(index / total) * 100}%` }} />
      </div>

      <article className="mt-6 rounded-2xl border border-ink bg-panel p-6 shadow-[4px_4px_0_0_#facc15]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={eyebrowClass}>{cue!.eyebrow}</p>
          {item.study_sessions?.title && <span className="truncate rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">{item.study_sessions.title}</span>}
        </div>
        {cue!.quote && <blockquote className="mt-4 border-l-4 border-yellow-400 pl-4 font-serif text-lg leading-relaxed">{cue!.quote}</blockquote>}
        <h2 className="mt-4 font-serif text-2xl leading-snug">{cue!.question}</h2>

        <label className="mt-5 block">
          <span className="sr-only">Your answer</span>
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Answer from memory first. Type it, or just say it out loud."
            className={`${inputClass} resize-y leading-relaxed`}
          />
        </label>

        {!revealed ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setRevealed(true)} className={buttonClass}>
              Show answer
            </button>
            <span className="text-xs text-muted">or press Ctrl + Enter</span>
          </div>
        ) : (
          <div className="animate-enter mt-5 space-y-4">
            {reveal ? (
              <div className="rounded-xl border border-line bg-paper p-4">
                <p className={eyebrowClass}>{reveal.label}</p>
                <Markdown content={reveal.body} className="prose-tutor prose-compact mt-2" />
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-ink/40 bg-paper p-4 text-sm leading-relaxed text-muted">
                There&apos;s no stored answer for this one. Check yours with the tutor, or open the session to look it up.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={checking || !text.trim()} onClick={checkAnswer} className={`${ghostButtonClass} py-1.5 text-xs`}>
                {checking ? "Checking…" : check ? "Check again" : "Check my answer with the tutor"}
              </button>
              <a href={sessionLink(item)} target="_blank" rel="noreferrer" className={`${ghostButtonClass} py-1.5 text-xs`}>
                {item.page_number ? `Open p. ${item.page_number} ↗` : "Open session ↗"}
              </a>
            </div>
            {!text.trim() && <p className="-mt-2 text-[11px] text-muted">Type your answer to have the tutor check it.</p>}

            {check && (
              <div className="animate-pop rounded-xl border border-ink p-4 text-sm">
                <p className="font-medium">{check.score >= 1 ? "✓ Correct" : check.score > 0 ? "◐ Partly right" : "✗ Not quite"}</p>
                <p className="mt-1 leading-relaxed text-muted">{check.feedback}</p>
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-medium">How did you do?</p>
              <div className="grid grid-cols-3 gap-2">
                {RATINGS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    disabled={saving}
                    onClick={() => rate(r.id)}
                    className={`rounded-lg border px-2 py-2.5 text-center transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-hard-sm disabled:opacity-50 ${
                      suggested === r.id ? "border-ink bg-ink text-white" : "border-ink bg-panel"
                    }`}
                  >
                    <span className="block text-sm font-medium">{r.label}</span>
                    <span className={`block font-mono text-[11px] ${suggested === r.id ? "text-white/70" : "text-muted"}`}>
                      {nextIn(item.step, r.id)} · {r.key}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </article>

      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <button type="button" onClick={advance} className="underline-offset-4 transition hover:text-ink hover:underline">
          Skip for now
        </button>
        <button type="button" onClick={suspend} className="underline-offset-4 transition hover:text-ink hover:underline">
          Don&apos;t show this again
        </button>
      </div>
    </div>
  );
}

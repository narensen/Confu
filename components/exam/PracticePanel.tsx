"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Markdown } from "@/components/workspace/Markdown";
import { GroqKeyForm } from "@/components/keys/GroqKeyForm";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { JSON_HEADERS } from "@/lib/ai-errors";
import { countdownLabel, daysUntil, type ExamQuestion, type QuestionKind } from "@/lib/exam";
import { endOfToday } from "@/lib/review";
import { SITTING_COUNT, SITTING_SECONDS } from "@/lib/sitting";
import { SITE } from "@/lib/site";
import { createClient } from "@/lib/supabase/client";
import { useToday } from "@/lib/use-today";
import type { SessionDoc } from "@/lib/types";
import { SectionPaper } from "./SectionPaper";
import type { ExamPractice } from "./useExamPractice";

type Props = {
  practice: ExamPractice;
  docs: SessionDoc[];
  examDate: string | null;
  onExamDate: (date: string | null) => void;
  onJump: (page: number, docId?: string | null) => void;
  onAsk: (message: string) => void;
  onTrial: boolean;
};

const MIXES: { value: "mixed" | QuestionKind; label: string }[] = [
  { value: "mixed", label: "Mixed" },
  { value: "mcq", label: "Multiple choice" },
  { value: "short", label: "Short answer" },
];

export function PracticePanel({ practice, docs, examDate, onExamDate, onJump, onAsk, onTrial }: Props) {
  const { quiz, loading, error, stats } = practice;
  const [scope, setScope] = useState<string>("all");
  const [mix, setMix] = useState<"mixed" | QuestionKind>("mixed");
  const [keyAdded, setKeyAdded] = useState(false);
  const [due, setDue] = useState<number | null>(null);
  const weak = stats.filter((t) => t.level === "weak" || t.level === "improving").slice(0, 5);
  const today = useToday();
  const days = today ? daysUntil(examDate, today) : null;

  useEffect(() => {
    if (today === null || days === null || days >= 0) return;
    void createClient()
      .from("review_items")
      .select("id", { count: "exact", head: true })
      .eq("suspended", false)
      .lte("due_at", endOfToday())
      .then(({ count }) => setDue(count ?? 0));
  }, [days, today]);

  const over = today !== null && days !== null && days < 0 && (due ?? 0) > 0;
  const showKey = onTrial && !keyAdded && days !== null && days >= 21 && days <= 28;

  return (
    <div className="h-full overflow-y-auto">
      <section className="flex items-center justify-between gap-4 border-b border-ink px-6 py-4">
        <div>
          <p className={eyebrowClass}>Exam</p>
          {over ? (
            <Link href="/review" className="mt-0.5 block font-serif text-xl underline decoration-ink/30 underline-offset-4">
              The paper is over. {due} {due === 1 ? "miss is" : "misses are"} due
            </Link>
          ) : (
            <p className="mt-0.5 font-serif text-xl">{today ? countdownLabel(days) : "\u00a0"}</p>
          )}
        </div>
        <label className="text-right">
          <span className="block font-mono text-[10px] text-muted uppercase">Exam date</span>
          <input
            type="date"
            value={examDate ?? ""}
            onChange={(e) => onExamDate(e.target.value || null)}
            className="mt-1 rounded-md border border-ink/30 bg-panel px-2 py-1 font-mono text-xs outline-none focus:border-ink"
          />
        </label>
      </section>

      {loading ? (
        <div className="animate-fade flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="font-serif text-2xl">Writing questions from your notes…</p>
          <div className="indeterminate h-[3px] w-48 rounded-full bg-line" />
        </div>
      ) : practice.marking && quiz?.sealed ? (
        <div className="animate-fade flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="font-serif text-2xl">Marking the paper…</p>
          <div className="indeterminate h-[3px] w-48 rounded-full bg-line" />
        </div>
      ) : quiz && quiz.index < quiz.questions.length ? (
        <QuestionCard key={quiz.questions[quiz.index].id} {...{ practice, onJump, onAsk }} />
      ) : quiz ? (
        <Summary practice={practice} onWeak={(topics) => practice.start({ topics, mix })} />
      ) : (
        <section className="animate-enter space-y-5 px-6 py-6">
          <SectionPaper sessionId={practice.sessionId} docs={docs} onJump={onJump} />
          {showKey && (
            <div className="rounded-lg border border-ink bg-yellow-50 p-4">
              <p className="text-sm leading-relaxed">The section paper does not use a prompt. Your own questions do. Add the free Groq key now.</p>
              <div className="mt-3">
                <GroqKeyForm sessionId={practice.sessionId} onSaved={() => setKeyAdded(true)} />
              </div>
            </div>
          )}
          <div>
            <h2 className="font-serif text-2xl leading-tight">Practise with exam-style questions</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              Five questions written from your own notes. Each one shows where the answer is, and your results find your weak topics.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">From</span>
              <select value={scope} onChange={(e) => setScope(e.target.value)} className={inputClass}>
                <option value="all">All my material</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} · {d.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Questions</span>
              <select value={mix} onChange={(e) => setMix(e.target.value as typeof mix)} className={inputClass}>
                {MIXES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && <p className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}

          <button
            onClick={() => practice.start({ documentId: scope === "all" ? null : scope, mix })}
            disabled={!docs.length}
            className={`${buttonClass} w-full py-2.5`}
          >
            Practise 5 questions
          </button>
          <button
            onClick={() => practice.start({ documentId: scope === "all" ? null : scope, mix, sitting: true })}
            disabled={!docs.length}
            className={`${ghostButtonClass} w-full py-2.5`}
          >
            Timed paper · {SITTING_COUNT} questions · {SITTING_SECONDS / 60} min
          </button>
          <p className="text-xs leading-relaxed text-muted">A timed paper hides the marks until you hand it in. Then you can share the score, not the questions.</p>

          {weak.length > 0 && (
            <div className="rounded-lg border border-dashed border-ink/40 bg-paper p-4">
              <p className="text-sm font-medium">Your weak topics</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {weak.map((t) => (
                  <span key={t.topic} className="rounded border border-ink/30 bg-panel px-2 py-0.5 text-xs">
                    {t.topic} · {Math.round(t.accuracy * 100)}%
                  </span>
                ))}
              </div>
              <button onClick={() => practice.start({ topics: weak.map((t) => t.topic), mix })} className={`${ghostButtonClass} mt-3 py-1.5 text-xs`}>
                Practise these
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SourceLink({ q, onJump }: { q: ExamQuestion; onJump: Props["onJump"] }) {
  if (!q.page) return null;
  return (
    <button onClick={() => onJump(q.page!, q.documentId)} className="rounded bg-paper px-1.5 py-0.5 font-mono text-[11px] underline decoration-ink/30 underline-offset-2 transition hover:bg-ink hover:text-white">
      {q.label} p. {q.page}
    </button>
  );
}

function SittingClock({ startedAt, limitSec, onDone }: { startedAt: number; limitSec: number; onDone: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, limitSec * 1000 - (now - startedAt));
  const fired = useRef(false);
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onDone();
    }
  }, [left, onDone]);
  const sec = Math.ceil(left / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (
    <span className={`font-mono text-xs tabular-nums ${sec <= 60 ? "text-warn" : "text-muted"}`}>
      {m}:{String(s).padStart(2, "0")}
    </span>
  );
}

function QuestionCard({ practice, onJump, onAsk }: Pick<Props, "practice" | "onJump" | "onAsk">) {
  const quiz = practice.quiz!;
  const q = quiz.questions[quiz.index];
  const answer = quiz.answers[q.id];
  const sealed = quiz.sealed;
  const show = Boolean(answer) && !sealed && (answer?.score ?? 0) >= 0;
  const [text, setText] = useState("");
  const total = quiz.questions.length;
  const last = quiz.index + 1 >= total;

  return (
    <section className="animate-enter px-6 py-6">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-muted tabular-nums">
          {quiz.index + 1} / {total}
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-ink transition-[width] duration-500 ease-fluid" style={{ width: `${(quiz.index / total) * 100}%` }} />
        </div>
        {sealed && quiz.limitSec ? <SittingClock startedAt={quiz.startedAt} limitSec={quiz.limitSec} onDone={() => void practice.finish()} /> : null}
        <button onClick={() => (sealed ? void practice.finish() : practice.reset())} className="text-xs text-muted hover:text-ink">
          {sealed ? "Hand in" : "End"}
        </button>
      </div>

      <p className={`${eyebrowClass} mt-5`}>
        {q.kind === "mcq" ? "Multiple choice" : "Short answer"} · {q.topic}
      </p>
      <div className="mt-2 font-serif text-[1.2rem] leading-snug">
        <Markdown content={q.question} className="prose-tutor [&>p]:text-[1.2rem]" />
      </div>

      {q.kind === "mcq" ? (
        <ul className="mt-5 space-y-2">
          {q.options!.map((opt, i) => {
            const chosen = answer?.choice === i;
            const right = show && i === q.correct;
            const wrong = show && chosen && i !== q.correct;
            return (
              <li key={i}>
                <button
                  disabled={show}
                  onClick={() => (sealed ? practice.holdChoice(q, i) : practice.answerChoice(q, i))}
                  className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition duration-200 ease-fluid ${
                    right ? "border-ok bg-ok/5" : wrong ? "border-danger bg-danger/5" : chosen ? "border-ink" : show ? "border-line opacity-60" : "border-ink/30 hover:-translate-y-px hover:border-ink hover:shadow-hard-sm"
                  }`}
                >
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${
                      right ? "border-ok bg-ok text-white" : wrong ? "border-danger bg-danger text-white" : chosen ? "border-ink bg-ink text-white" : "border-ink/40"
                    }`}
                  >
                    {right ? "✓" : wrong ? "✕" : "ABCD"[i]}
                  </span>
                  <span className="pt-0.5">
                    <Markdown content={opt} className="prose-tutor prose-compact" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : !answer || (sealed && answer.score < 0 && !answer.text) ? (
        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            if (sealed) practice.holdText(q, text);
            else void practice.answerText(q, text);
          }}
        >
          <textarea
            autoFocus
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write your answer as you would in the exam…"
            className={`${inputClass} resize-y leading-relaxed`}
          />
          {practice.error && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{practice.error}</p>}
          <button disabled={!text.trim() || practice.marking} className={`${buttonClass} w-full py-2.5`}>
            {practice.marking ? "Marking…" : sealed ? "Save answer" : "Mark my answer"}
          </button>
        </form>
      ) : sealed && answer.text ? (
        <p className="mt-5 text-sm text-muted">Saved. Marks wait until you hand the paper in.</p>
      ) : null}

      {show && answer && (
        <div className="animate-enter mt-5 space-y-3">
          <p
            className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              answer.score === 1 ? "border-ok/50 text-ok" : answer.score > 0 ? "border-warn/50 text-warn" : "border-danger/50 text-danger"
            }`}
          >
            {answer.score === 1 ? "Correct" : answer.score > 0 ? "Partly right" : "Not quite"}
          </p>
          {answer.feedback && <p className="text-sm leading-relaxed">{answer.feedback}</p>}
          {q.kind === "short" && (
            <div className="rounded-lg border border-line bg-paper p-3 text-sm">
              <p className={eyebrowClass}>Model answer</p>
              <Markdown content={q.answer ?? ""} className="prose-tutor prose-compact mt-1" />
            </div>
          )}
          {q.explanation && (
            <div className="border-l-2 border-ink pl-3 text-sm leading-relaxed text-ink/85">
              <Markdown content={q.explanation} className="prose-tutor prose-compact" />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <SourceLink q={q} onJump={onJump} />
            <button
              onClick={() =>
                onAsk(
                  `Help me understand this practice question.\n\nQuestion: ${q.question}\n${q.kind === "mcq" ? `Correct answer: ${q.options![q.correct!]}` : `Model answer: ${q.answer}`}${answer.text ? `\nMy answer: ${answer.text}` : answer.choice !== undefined ? `\nI chose: ${q.options![answer.choice]}` : ""}`,
                )
              }
              className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Ask the tutor about this
            </button>
            <div className="flex-1" />
            <button onClick={practice.next} className={`${buttonClass} py-1.5`}>
              {quiz.index + 1 < total ? "Next question" : "See results"}
            </button>
          </div>
        </div>
      )}

      {sealed && (q.kind === "mcq" ? answer : answer?.text) && (
        <div className="mt-5 flex justify-end">
          <button onClick={() => (last ? void practice.finish() : practice.next())} className={`${buttonClass} py-1.5`}>
            {last ? "Hand in" : "Next question"}
          </button>
        </div>
      )}
    </section>
  );
}

function Summary({ practice, onWeak }: { practice: ExamPractice; onWeak: (topics: string[]) => void }) {
  const quiz = practice.quiz!;
  const answered = quiz.questions.filter((q) => quiz.answers[q.id] && quiz.answers[q.id].score >= 0);
  const score = answered.reduce((s, q) => s + quiz.answers[q.id].score, 0);
  const missed = [...new Set(answered.filter((q) => quiz.answers[q.id].score < 1).map((q) => q.topic))];

  return (
    <section className="animate-enter px-6 py-8 text-center">
      <p className={eyebrowClass}>{quiz.limitSec ? "Paper" : "Results"}</p>
      <p className="mt-2 font-serif text-5xl tabular-nums">
        {score % 1 ? score.toFixed(1) : score}
        <span className="text-2xl text-muted"> / {answered.length}</span>
      </p>
      <p className="mt-2 text-sm text-muted">
        {answered.length && score / answered.length >= 0.8 ? "Strong work. Keep it fresh with another round later." : "Every miss shows you exactly what to revise."}
      </p>
      {missed.length > 0 && (
        <div className="mx-auto mt-5 max-w-sm text-left">
          <p className={eyebrowClass}>Revise</p>
          <ul className="mt-2 space-y-1 text-sm">
            {missed.map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="size-1.5 bg-danger" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
      {quiz.limitSec != null && <ShareSitting practice={practice} score={score} outOf={answered.length} missed={missed} />}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {missed.length > 0 && (
          <button onClick={() => onWeak(missed)} className={`${buttonClass} py-1.5`}>
            Practise what I missed
          </button>
        )}
        <button onClick={() => practice.start({ topics: quiz.focus, sitting: quiz.limitSec != null })} className={`${ghostButtonClass} py-1.5`}>
          Another round
        </button>
        <button onClick={practice.reset} className={`${ghostButtonClass} py-1.5`}>
          Done
        </button>
      </div>
    </section>
  );
}

function ShareSitting({ practice, score, outOf, missed }: { practice: ExamPractice; score: number; outOf: number; missed: string[] }) {
  const quiz = practice.quiz!;
  const [showName, setShowName] = useState(true);
  const [link, setLink] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function share() {
    const minutes = Math.max(0, Math.round(((quiz.finishedAt ?? quiz.startedAt) - quiz.startedAt) / 60000));
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/sitting/share", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sessionId: practice.sessionId, score, outOf: Math.max(1, outOf), minutes, topics: missed, showName }),
      });
      const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !body.token) throw new Error(body.error ?? "Couldn't share it.");
      setLink(`${SITE.url}/sit/${body.token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't share it.");
    } finally {
      setPending(false);
    }
  }

  if (!outOf) return null;
  return (
    <div className="mx-auto mt-5 max-w-sm text-left">
      {link ? (
        <div className="rounded-lg border border-ink bg-yellow-50 p-3">
          <p className="text-xs text-muted">Card link. It shows the score, the time and the misses. Not the questions.</p>
          <code className="mt-2 block truncate rounded-md border border-line bg-panel px-2 py-1 font-mono text-[11px]">{link}</code>
          <button type="button" onClick={() => navigator.clipboard.writeText(link)} className={`${ghostButtonClass} mt-2 py-1 text-xs`}>
            Copy link
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-ink/40 p-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} className="mt-0.5 size-4 accent-[var(--ink)]" />
            <span>Show my first name on the card</span>
          </label>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          <button type="button" disabled={pending} onClick={() => void share()} className={`${ghostButtonClass} mt-3 py-1.5 text-xs`}>
            {pending ? "Sharing…" : "Share a card"}
          </button>
        </div>
      )}
    </div>
  );
}

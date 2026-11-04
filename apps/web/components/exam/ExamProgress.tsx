"use client";

import { buttonClass, eyebrowClass } from "@/components/ui";
import { countdownLabel, daysUntil, type TopicStat } from "@confu/core/exam";
import { useToday } from "@/lib/use-today";
import type { ExamPractice } from "./useExamPractice";

const LEVEL: Record<TopicStat["level"], { label: string; tone: string; bar: string }> = {
  weak: { label: "Weak", tone: "border-danger/50 text-danger", bar: "bg-danger" },
  improving: { label: "Getting there", tone: "border-warn/50 text-warn", bar: "bg-warn" },
  strong: { label: "Strong", tone: "border-ok/50 text-ok", bar: "bg-ok" },
  new: { label: "Too early to tell", tone: "border-line text-muted", bar: "bg-ink/30" },
};

export function ExamProgress({
  practice,
  examDate,
  memorySummary,
  onPractiseWeak,
}: {
  practice: ExamPractice;
  examDate: string | null;
  memorySummary: string;
  onPractiseWeak: (topics: string[]) => void;
}) {
  const { attempts, stats } = practice;
  const accuracy = attempts.length ? attempts.reduce((s, a) => s + a.score, 0) / attempts.length : 0;
  const weak = stats.filter((t) => t.level === "weak" || t.level === "improving");
  const today = useToday();

  return (
    <div className="h-full space-y-6 overflow-y-auto p-6 text-sm">
      <section className="animate-enter">
        <p className={eyebrowClass}>Exam</p>
        <h2 className="mt-1 font-serif text-2xl">{today ? countdownLabel(daysUntil(examDate, today)) : "\u00a0"}</h2>
      </section>

      <section className="animate-enter grid grid-cols-3 gap-2" style={{ animationDelay: "60ms" }}>
        {[
          ["Answered", String(attempts.length)],
          ["Accuracy", attempts.length ? `${Math.round(accuracy * 100)}%` : "—"],
          ["Weak topics", String(stats.filter((t) => t.level === "weak").length)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-ink p-3">
            <p className="font-mono text-[10px] text-muted uppercase">{label}</p>
            <p className="mt-1 font-serif text-2xl tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      {stats.length === 0 ? (
        <p className="text-muted">Answer a few practice questions and your topics will show up here, weakest first.</p>
      ) : (
        <section className="animate-enter" style={{ animationDelay: "120ms" }}>
          <div className="flex items-center justify-between">
            <p className={eyebrowClass}>Topics</p>
            {weak.length > 0 && (
              <button onClick={() => onPractiseWeak(weak.slice(0, 5).map((t) => t.topic))} className={`${buttonClass} py-1 text-xs`}>
                Practise my weak topics
              </button>
            )}
          </div>
          <ul className="mt-3 space-y-2.5">
            {stats.map((t) => (
              <li key={t.topic} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate">{t.topic}</span>
                <span className={`shrink-0 rounded-full border px-2 py-px text-[10px] font-medium ${LEVEL[t.level].tone}`}>{LEVEL[t.level].label}</span>
                <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-line">
                  <span className={`block h-full rounded-full transition-[width] duration-700 ease-fluid ${LEVEL[t.level].bar}`} style={{ width: `${t.accuracy * 100}%` }} />
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-[11px] text-muted tabular-nums">
                  {Math.round(t.accuracy * 100)}% · {t.attempts}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {memorySummary && (
        <section className="animate-enter" style={{ animationDelay: "180ms" }}>
          <p className={eyebrowClass}>Tutor&apos;s notes</p>
          <p className="mt-2 border-l-2 border-ink pl-3 leading-relaxed text-ink/80">{memorySummary}</p>
        </section>
      )}
    </div>
  );
}

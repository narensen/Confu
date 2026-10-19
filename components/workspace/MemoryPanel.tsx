"use client";

import { eyebrowClass } from "@/components/ui";
import type { LearnerMemory, PlanTopic, StudyPlan } from "@/lib/types";

export function MemoryPanel({ memory, plan, topics }: { memory: LearnerMemory; plan: StudyPlan | null; topics: PlanTopic[] }) {
  const empty =
    !memory.summary && !memory.understood.length && !memory.struggling.length && !memory.misconceptions.length && !memory.open_questions.length;

  return (
    <div className="h-full space-y-7 overflow-y-auto p-6 text-sm">
      <section className="animate-enter">
        <p className={eyebrowClass}>Progress</p>
        <h2 className="mt-1 font-serif text-2xl">What your tutor knows about you</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Updated after every exchange, so the tutor builds on what you know instead of repeating it.
        </p>
        {empty ? (
          <p className="mt-5 text-muted">Nothing yet. Ask a few questions or try “Check my understanding”.</p>
        ) : (
          memory.summary && <p className="mt-4 border-l-2 border-ink pl-3 text-sm leading-relaxed text-ink/80">{memory.summary}</p>
        )}
      </section>

      <div className="grid gap-5">
        <List title="Understood" mark="bg-ok" items={memory.understood} delay={60} />
        <List title="Still shaky" mark="bg-warn" items={memory.struggling} delay={120} />
        <List title="Misconceptions being corrected" mark="bg-danger" items={memory.misconceptions} delay={180} />
        <List title="Open questions" mark="bg-ink" items={memory.open_questions} delay={240} />
      </div>

      {plan && topics.length > 0 && (
        <section className="animate-enter rounded-xl border border-ink p-4" style={{ animationDelay: "300ms" }}>
          <p className={eyebrowClass}>Mastery by topic</p>
          <ul className="mt-3 space-y-2.5">
            {topics.map((t) => (
              <li key={t.id} className="flex items-center gap-3">
                <span className="w-5 shrink-0 font-mono text-[11px] text-muted">{t.position + 1}</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                  <span className="block h-full rounded-full bg-ok transition-[width] duration-700 ease-fluid" style={{ width: `${t.mastery * 100}%` }} />
                </span>
                <span className="w-9 text-right font-mono text-xs tabular-nums">{Math.round(t.mastery * 100)}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function List({ title, items, mark, delay }: { title: string; items: string[]; mark: string; delay: number }) {
  if (!items.length) return null;
  return (
    <section className="animate-enter" style={{ animationDelay: `${delay}ms` }}>
      <p className={eyebrowClass}>{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((i) => (
          <li key={i} className="flex items-start gap-2.5 leading-snug">
            <span className={`mt-[0.4em] size-1.5 shrink-0 ${mark}`} />
            {i}
          </li>
        ))}
      </ul>
    </section>
  );
}

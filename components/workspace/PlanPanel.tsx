"use client";

import { useState } from "react";
import { eyebrowClass } from "@/components/ui";
import { formatMinutes, scheduleStatus, toISODate } from "@/lib/schedule";
import type { PlanTopic, Resource, SessionDoc, StudyPlan, TopicStatus } from "@/lib/types";
import { GoalSetup } from "./GoalSetup";
import { Markdown } from "./Markdown";

type Props = {
  sessionId: string;
  docs: SessionDoc[];
  plan: StudyPlan | null;
  topics: PlanTopic[];
  activeTopic: PlanTopic | null;
  busy: boolean;
  onJump: (page: number, docId?: string | null) => void;
  onFocusTopic: (t: PlanTopic) => void;
  onTopicStatus: (t: PlanTopic, s: TopicStatus) => void;
  onTeach: (t: PlanTopic) => void;
  onPlanCreated: () => void;
};

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const RESOURCE_LABEL: Record<Resource["type"], string> = {
  lecture: "Lecture",
  video: "Video",
  reading: "Reading",
  course: "Course",
  practice: "Practice",
};

function resourceHref(r: Resource) {
  const q = encodeURIComponent(r.search);
  return r.type === "lecture" || r.type === "video"
    ? `https://www.youtube.com/results?search_query=${q}`
    : `https://www.google.com/search?q=${q}`;
}

export function PlanPanel(props: Props) {
  const { sessionId, docs, plan, topics, activeTopic, onPlanCreated } = props;
  const [editing, setEditing] = useState(false);
  const [showGoal, setShowGoal] = useState(false);

  if (!plan || editing) {
    return (
      <div className="h-full overflow-y-auto px-6 py-6">
        <GoalSetup
          sessionId={sessionId}
          docTitles={docs.map((d) => d.title)}
          existing={plan}
          onCreated={() => {
            setEditing(false);
            onPlanCreated();
          }}
          onCancel={plan ? () => setEditing(false) : undefined}
        />
      </div>
    );
  }

  const today = toISODate(new Date());
  const status = scheduleStatus(plan, topics, today);
  const pct = status.total ? Math.round((status.completed / status.total) * 100) : 0;
  const phases = plan.phases?.length ? plan.phases : [{ title: "Plan", description: "" }];
  const external = topics.filter((t) => t.source === "external" || !t.document_id).length;

  return (
    <div className="h-full overflow-y-auto">
      {/* Goal */}
      <section className="animate-enter border-b border-ink px-6 pt-6 pb-5">
        <div className="flex items-start justify-between gap-4">
          <p className={eyebrowClass}>Your goal</p>
          <button onClick={() => setEditing(true)} className="text-xs text-muted underline-offset-4 transition hover:text-ink hover:underline">
            Edit goal
          </button>
        </div>
        <h2 className="mt-1.5 font-serif text-[1.65rem] leading-tight tracking-tight">{plan.goal_title || "Study plan"}</h2>
        {plan.goal_summary && <p className="mt-2 text-sm leading-relaxed text-muted">{plan.goal_summary}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full border px-2.5 py-0.5 font-medium ${
              status.onTrack ? "border-ok/50 text-ok" : "border-warn/50 text-warn"
            }`}
          >
            {status.label}
          </span>
          <Meta>Due {formatDate(plan.deadline)}</Meta>
          <Meta>{status.daysLeft >= 0 ? `${status.daysLeft} days left` : "Past deadline"}</Meta>
          <Meta>{formatMinutes(plan.minutes_per_day)}/day</Meta>
          <Meta className="capitalize">{plan.level}</Meta>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full border border-ink bg-panel">
            <div className="h-full bg-ink transition-[width] duration-700 ease-fluid" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-mono text-xs tabular-nums">
            {status.completed}/{status.total}
          </span>
        </div>

        <button
          onClick={() => setShowGoal((v) => !v)}
          aria-expanded={showGoal}
          className="mt-4 flex items-center gap-1.5 text-xs font-medium transition hover:opacity-70"
        >
          <Chevron open={showGoal} />
          {showGoal ? "Hide full goal" : "Read full goal"}
        </button>
        <div className="disclosure" data-open={showGoal}>
          <div>
            <div className="mt-3 rounded-lg border border-line bg-paper p-4">
              <Markdown content={plan.goal} className="prose-tutor prose-compact" />
              {plan.materials && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className={eyebrowClass}>Other materials</p>
                  <p className="mt-1 text-sm whitespace-pre-line">{plan.materials}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {plan.overview && <p className="mt-4 border-l-2 border-ink pl-3 text-sm leading-relaxed text-ink/80">{plan.overview}</p>}
        {external > 0 && (
          <p className="mt-3 text-xs text-muted">
            {topics.length - external} topics use your PDFs · {external} go beyond them with outside resources
          </p>
        )}
      </section>

      {/* Phases */}
      {phases.map((phase, pi) => {
        const phaseTopics = topics.filter((t) => (plan.phases?.length ? t.phase === pi : true));
        if (!phaseTopics.length) return null;
        const done = phaseTopics.filter((t) => t.status === "completed").length;
        return (
          <section key={pi} className="animate-enter border-b border-line" style={{ animationDelay: `${80 + pi * 70}ms` }}>
            <header className="px-6 pt-5 pb-2">
              <div className="flex items-center justify-between">
                <p className={eyebrowClass}>Phase {String(pi + 1).padStart(2, "0")}</p>
                <span className="font-mono text-[11px] text-muted">
                  {done}/{phaseTopics.length}
                </span>
              </div>
              <h3 className="mt-1 font-serif text-lg leading-snug">{phase.title}</h3>
              {phase.description && <p className="mt-1 text-sm leading-relaxed text-muted">{phase.description}</p>}
            </header>
            <ol className="px-3 pb-3">
              {phaseTopics.map((t) => (
                <TopicRow key={t.id} topic={t} active={activeTopic?.id === t.id} today={today} {...props} />
              ))}
            </ol>
          </section>
        );
      })}

      <p className="px-6 py-5 text-[11px] leading-relaxed text-muted">
        Plans and resources are AI-generated and may contain mistakes. Resource links open a search, so check you have the
        right one.
      </p>
    </div>
  );
}

function TopicRow({ topic: t, active, today, docs, busy, onJump, onFocusTopic, onTopicStatus, onTeach }: Props & { topic: PlanTopic; active: boolean; today: string }) {
  const [open, setOpen] = useState(active);
  const overdue = t.status !== "completed" && t.due_date < today;
  const completed = t.status === "completed";
  const doc = docs.find((d) => d.id === t.document_id);
  const inPdf = t.source === "pdf" && t.page_start !== null && Boolean(doc);

  return (
    <li
      className={`group rounded-lg border transition-all duration-300 ease-fluid ${
        active ? "my-1 border-ink bg-panel shadow-hard-sm" : open ? "my-1 border-line" : "border-transparent hover:bg-paper"
      }`}
    >
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start gap-3 px-3 py-3 text-left">
        <span
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] transition-colors duration-300 ${
            completed ? "border-ink bg-ink text-white" : active ? "border-ink text-ink" : "border-ink/30 text-muted"
          }`}
        >
          {completed ? "✓" : t.position + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm leading-snug ${completed ? "text-muted line-through" : "font-medium"}`}>{t.title}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            {inPdf ? (
              <span className="rounded border border-ink/60 px-1.5 py-px font-mono text-ink">
                {docs.length > 1 ? doc!.label : "PDF"} pp. {t.page_start}–{t.page_end}
              </span>
            ) : (
              <span className="rounded border border-dashed border-ink/60 px-1.5 py-px font-mono text-ink">
                {t.source === "pdf" ? "PDF removed" : "Beyond the PDFs"}
              </span>
            )}
            <span className={overdue ? "font-medium text-warn" : ""}>Due {formatDate(t.due_date)}</span>
            <span>·</span>
            <span>~{formatMinutes(t.est_minutes)}</span>
            {active && <span className="font-medium text-ink">· In focus</span>}
          </span>
        </span>
        <span className="mt-1.5 flex shrink-0 flex-col items-end gap-1" title={`Mastery ${Math.round(t.mastery * 100)}%`}>
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full bg-ok transition-[width] duration-700 ease-fluid" style={{ width: `${t.mastery * 100}%` }} />
          </span>
          <Chevron open={open} />
        </span>
      </button>

      <div className="disclosure" data-open={open}>
        <div>
          <div className="space-y-4 px-3 pb-4 pl-12 text-sm">
            <div>
              <p className={eyebrowClass}>You should be able to</p>
              <ul className="mt-2 space-y-1.5">
                {t.objectives.map((o) => (
                  <li key={o} className="flex gap-2 leading-snug">
                    <span className="mt-[0.45em] size-1.5 shrink-0 bg-ink" />
                    {o}
                  </li>
                ))}
              </ul>
            </div>

            {t.key_concepts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.key_concepts.map((c) => (
                  <span key={c} className="rounded-md border border-line bg-paper px-2 py-0.5 text-xs">
                    {c}
                  </span>
                ))}
              </div>
            )}

            {t.resources?.length > 0 && (
              <div>
                <p className={eyebrowClass}>Go deeper</p>
                <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                  {t.resources.map((r) => (
                    <li key={r.title}>
                      <a
                        href={resourceHref(r)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 px-3 py-2 transition hover:bg-paper"
                      >
                        <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted">{RESOURCE_LABEL[r.type]}</span>
                        <span className="min-w-0 flex-1 text-sm leading-snug">{r.title}</span>
                        <span className="text-muted" aria-hidden>
                          ↗
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              <SmallButton primary disabled={busy} onClick={() => onTeach(t)}>
                Teach me
              </SmallButton>
              {inPdf && (
                <SmallButton onClick={() => onJump(t.page_start!, doc!.id)}>
                  Open {docs.length > 1 ? `${doc!.label} ` : ""}p. {t.page_start}
                </SmallButton>
              )}
              {!active && !completed && <SmallButton onClick={() => onFocusTopic(t)}>Focus on this</SmallButton>}
              {completed ? (
                <SmallButton onClick={() => onTopicStatus(t, "in_progress")}>Reopen</SmallButton>
              ) : (
                <SmallButton onClick={() => onTopicStatus(t, "completed")}>{t.mastery >= 0.75 ? "✓ Mark understood" : "Mark done"}</SmallButton>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function Meta({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`rounded-full border border-line px-2.5 py-0.5 text-muted ${className}`}>{children}</span>;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden
      className={`text-muted transition-transform duration-300 ease-fluid ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SmallButton({ primary, children, ...rest }: { primary?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`rounded-md border border-ink px-2.5 py-1 text-xs font-medium transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-hard-sm active:translate-y-0 active:shadow-none disabled:pointer-events-none disabled:opacity-40 ${
        primary ? "bg-ink text-white" : "bg-panel"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

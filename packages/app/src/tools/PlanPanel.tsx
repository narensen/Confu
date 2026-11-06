"use client";

import { useState } from "react";
import { addCoursePaper, sessionPlan, setTopicStatus } from "@confu/client/courses";
import type { CourseSource } from "@confu/core/templates";
import type { PlanTopic } from "@confu/core/types";
import { eyebrowClass, ghostButtonClass } from "@confu/ui/classes";
import { useHost } from "../host";
import { useDevice, useLocal } from "../local";
import { extractPdf } from "../pdf";

// The session's plan: the goal, topics by phase (tick them off, or have the
// tutor teach one), and the course's free sources.

export function PlanPanel({ sessionId, onTeach, onAdded }: { sessionId: string; onTeach: (topic: PlanTopic) => void; onAdded: (docId: string) => void }) {
  const { store, files, changed } = useDevice();
  const { fetchPdf } = useHost();
  const { data: plan } = useLocal((d) => sessionPlan(d.store, sessionId), [sessionId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (plan === undefined) return <div className="h-full bg-panel" />;
  if (!plan) {
    return (
      <div className="flex h-full items-center justify-center bg-panel p-6 text-center">
        <div className="max-w-sm">
          <h2 className="font-serif text-xl">No plan in this session</h2>
          <p className="mt-1.5 text-sm text-muted">Start a course from your library to get a plan of topics, or just study your files with the tutor.</p>
        </div>
      </div>
    );
  }

  const done = plan.topics.filter((t) => t.status === "completed").length;
  const today = new Date().toISOString().slice(0, 10);

  async function addPaper(source: CourseSource) {
    if (!fetchPdf) return;
    setProblem(null);
    setBusy(source.title);
    try {
      const doc = await addCoursePaper(store, files, { sessionId, source, extract: extractPdf, fetchPdf });
      changed();
      onAdded(doc.id);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't add that paper.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-panel">
      <div className="mx-auto max-w-2xl space-y-6 px-5 py-6">
        <header>
          <p className={eyebrowClass}>Plan · until {new Date(`${plan.deadline}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</p>
          <h2 className="mt-1 font-serif text-2xl">{plan.goal_title || "Your goal"}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{plan.goal}</p>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper" role="progressbar" aria-valuenow={done} aria-valuemax={plan.topics.length}>
              <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${(done / Math.max(1, plan.topics.length)) * 100}%` }} />
            </div>
            <span className="font-mono text-[11px] text-muted">
              {done}/{plan.topics.length}
            </span>
          </div>
        </header>

        {plan.phases.map((phase, i) => {
          const topics = plan.topics.filter((t) => t.phase === i);
          if (!topics.length) return null;
          return (
            <section key={i}>
              <h3 className="mb-2 text-sm font-semibold">{phase.title}</h3>
              <ul className="divide-y divide-line rounded-xl border border-ink/20">
                {topics.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={t.status === "completed"}
                      aria-label={`Done: ${t.title}`}
                      onChange={async (e) => {
                        await setTopicStatus(store, t.id, e.target.checked ? "completed" : "not_started");
                        changed();
                      }}
                      className="size-4 shrink-0 accent-[var(--ink)]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${t.status === "completed" ? "text-muted line-through" : ""}`}>{t.title}</p>
                      <p className={`font-mono text-[11px] ${t.status !== "completed" && t.due_date < today ? "text-warn" : "text-muted"}`}>by {t.due_date.slice(5).replace("-", "/")}</p>
                    </div>
                    <button type="button" onClick={() => onTeach(t)} className="shrink-0 rounded-full border border-ink/25 px-2.5 py-1 text-xs transition hover:border-ink">
                      Teach me
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {plan.template && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Sources</h3>
            <ul className="space-y-1.5">
              {plan.template.sources.map((s) => (
                <li key={s.url ?? s.title} className="flex items-center gap-3 rounded-lg px-1 py-1 text-sm">
                  <span className="w-14 shrink-0 font-mono text-[10px] text-muted uppercase">{s.kind === "youtube" ? "video" : s.kind === "paper" ? "paper" : "web"}</span>
                  <span className="min-w-0 flex-1 truncate" title={s.title}>
                    {s.title}
                  </span>
                  {s.pdf_url && fetchPdf ? (
                    <button type="button" disabled={Boolean(busy)} onClick={() => addPaper(s)} className={`${ghostButtonClass} px-2.5 py-1 text-xs`}>
                      {busy === s.title ? "Adding…" : "Add PDF"}
                    </button>
                  ) : null}
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-medium underline underline-offset-2">
                      Open
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {problem && <p className="mt-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{problem}</p>}
          </section>
        )}
      </div>
    </div>
  );
}

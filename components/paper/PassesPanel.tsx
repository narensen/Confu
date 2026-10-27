"use client";

import { useState } from "react";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { openRecommendPapers } from "./RecommendDialog";
import { JSON_HEADERS, notifyAiUsed, readAiError } from "@/lib/ai-errors";
import { passDef, passNotes, PASSES, type PaperReview, type PassNumber } from "@/lib/paper";
import type { SessionDoc, TutorAction } from "@/lib/types";
import type { SendRequest } from "@/components/workspace/Workspace";

export type PaperTool = "compare" | "related" | "bibtex" | "zotero";

type Props = {
  sessionId: string;
  // Inside a study session: only its papers, under the study goal (no research goal or triage).
  inStudy?: boolean;
  docs: SessionDoc[];
  onMarkPaper?: (docId: string) => void;
  onAddPapers?: () => void;
  studyGoal?: string;
  onOpenMap?: () => void; // the literature map of these papers
  onTool?: (tool: PaperTool) => void; // BibTeX, related work, compare, Zotero
  activeDocId: string | null;
  reviews: Record<string, PaperReview>;
  researchGoal: string;
  busy: boolean;
  onSelectDoc: (docId: string) => void;
  onUpdate: (docId: string, patch: Partial<PaperReview>, persist?: boolean) => void;
  onResearchGoal: (goal: string) => void;
  fetching: string | null;
  onSend: (req: SendRequest) => void;
  // One paper's passes open on their own (picked from the list, "Open its
  // passes", the plan); otherwise the tab is just the reading list.
  passesOpen: boolean;
  onPassesOpen: (open: boolean) => void;
};

const PASS_ACTIONS: Record<PassNumber, { action: TutorAction; label: string; primary?: boolean }[]> = {
  1: [{ action: "pass1_check", label: "Check my five Cs", primary: true }],
  2: [
    { action: "pass2_figures", label: "Walk me through the figures" },
    { action: "pass2_check", label: "Check my explanation", primary: true },
  ],
  3: [
    { action: "pass3_rebuild", label: "Re-implement it with me", primary: true },
    { action: "pass3_probe", label: "Probe for weaknesses" },
  ],
};

export function PassesPanel(props: Props) {
  const { docs, activeDocId, reviews, busy, onSelectDoc, inStudy, passesOpen, onPassesOpen } = props;
  // In a study session the viewer may be on a textbook: then no paper is open.
  const active = docs.find((d) => d.id === activeDocId) ?? (inStudy ? undefined : docs[0]);

  // One paper at a time: its passes, with the way back to the list.
  if (passesOpen && active && reviews[active.id]) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-2.5">
          <button type="button" onClick={() => onPassesOpen(false)} className="text-xs font-medium text-muted transition hover:text-ink">
            ← All papers
          </button>
          <span className="min-w-0 truncate text-xs text-muted">
            <span className="mr-1.5 rounded border border-ink/30 px-1 font-mono text-[10px]">{active.label}</span>
            {active.title}
          </span>
        </div>
        <PaperWorkspace key={active.id} doc={active} review={reviews[active.id]} busy={busy} onUpdate={props.onUpdate} onSend={props.onSend} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <ResearchGoal {...props} />

      {/* Reading list */}
      <section className="border-b border-ink px-6 py-5">
        <div className="flex items-baseline justify-between">
          <p className={eyebrowClass}>Reading list</p>
          <p className="font-mono text-[11px] text-muted">target pass</p>
        </div>
        {docs.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Add papers with “+ Add paper” above the viewer, or from Files.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {docs.map((d) => {
              const r = reviews[d.id];
              const selected = d.id === active?.id;
              return (
                <li
                  key={d.id}
                  className={`rounded-lg border transition-all duration-200 ease-fluid ${selected ? "border-ink shadow-hard-sm" : "border-line hover:border-ink/40"}`}
                >
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      onClick={() => {
                        onSelectDoc(d.id);
                        onPassesOpen(true);
                      }}
                      title="Open it beside its passes"
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <span className={`shrink-0 rounded px-1 font-mono text-[10px] ${selected ? "bg-ink text-white" : "border border-ink/30 text-muted"}`}>{d.label}</span>
                      <span className="min-w-0">
                        <span className={`block truncate text-sm ${selected ? "font-medium" : ""}`}>{d.title}</span>
                        <PassPips done={r?.passes_done ?? 0} target={r?.target_pass ?? 1} />
                      </span>
                    </button>
                    <TargetPicker value={r?.target_pass ?? 1} onChange={(t) => props.onUpdate(d.id, { target_pass: t })} />
                  </div>
                  {r?.triage_reason && <p className="px-3 pb-2.5 pl-11 text-xs leading-relaxed text-muted">{r.triage_reason}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {docs.length > 0 && <p className="px-6 py-4 text-xs text-muted">Pick a paper to open it beside its passes.</p>}

    </div>
  );
}

function ResearchGoal(props: Props) {
  const { sessionId, researchGoal, docs, busy, fetching, onResearchGoal, onUpdate, inStudy, studyGoal, onAddPapers, onOpenMap, onTool } = props;
  // In a study session the study goal stands in until they write a research goal.
  const [goal, setGoal] = useState(researchGoal || (inStudy ? (studyGoal ?? "") : ""));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function triage() {
    setPending(true);
    setError(null);
    try {
      onResearchGoal(goal);
      const res = await fetch("/api/paper/triage", {
        method: "POST",
        headers: JSON_HEADERS,
        // A study session's textbooks aren't triaged, only its papers.
        body: JSON.stringify({ sessionId, researchGoal: goal, documentIds: inStudy ? docs.map((d) => d.id) : undefined }),
      });
      if (!res.ok) throw new Error(await readAiError(res));
      const json = (await res.json()) as { results: { documentId: string; pass: PassNumber; reason: string }[] };
      // Already saved by the server.
      for (const r of json.results) onUpdate(r.documentId, { target_pass: r.pass, triage_reason: r.reason }, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't triage the papers.");
    } finally {
      setPending(false);
      notifyAiUsed();
    }
  }

  // Once passes are suggested, the setup is done for good: what's left is the
  // goal on one line and the tools.
  const suggested = docs.some((d) => props.reviews[d.id]?.triage_reason);
  if (suggested) {
    return (
      <section className="animate-enter border-b border-ink px-6 pt-5 pb-4">
        <p className={eyebrowClass}>{inStudy ? "Papers in this study" : "Paper session"} · three-pass method</p>
        {(researchGoal || studyGoal) && <p className="mt-1 truncate text-sm text-muted" title={researchGoal || studyGoal}>{researchGoal || studyGoal}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {onAddPapers && (
            <button type="button" onClick={onAddPapers} disabled={Boolean(fetching)} className={`${ghostButtonClass} py-1 text-xs`}>
              + Add papers
            </button>
          )}
          <button type="button" onClick={() => openRecommendPapers()} disabled={Boolean(fetching)} className={`${ghostButtonClass} py-1 text-xs`}>
            Suggest papers
          </button>
          {onOpenMap && docs.length > 0 && (
            <button type="button" onClick={onOpenMap} className="rounded-md border border-ink bg-ink px-2.5 py-1 text-xs font-medium text-white transition hover:-translate-y-px">
              Literature map
            </button>
          )}
          {onTool &&
            docs.length > 0 &&
            (
              [
                ["compare", "Compare"],
                ["related", "Related work"],
                ["bibtex", "BibTeX"],
                ["zotero", "Zotero"],
              ] as const
            ).map(([tool, label]) => (
              <button key={tool} type="button" onClick={() => onTool(tool)} className={`${ghostButtonClass} py-1 text-xs`}>
                {label}
              </button>
            ))}
        </div>
        {fetching && <p className="mt-2 truncate text-xs text-muted">{fetching}</p>}
      </section>
    );
  }

  return (
    <section className="animate-enter border-b border-ink px-6 pt-6 pb-5">
      <p className={eyebrowClass}>{inStudy ? "Papers in this study" : "Paper session"} · three-pass method</p>
      <h2 className="mt-1 font-serif text-2xl leading-tight">{inStudy ? "Read papers like a researcher" : "What are you researching?"}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        Not every paper deserves a deep read. Your goal decides which ones get one pass, two, or a full re-implementation.
      </p>
      <textarea
        rows={3}
        value={goal}
        maxLength={4000}
        onChange={(e) => setGoal(e.target.value)}
        onBlur={() => goal !== researchGoal && onResearchGoal(goal)}
        placeholder="e.g. Find a gap in RL fine-tuning for LLM reasoning: I'll implement GRPO and compare it with PPO."
        className={`${inputClass} mt-3 resize-y leading-relaxed`}
      />
      {error && <p className="animate-pop mt-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={triage}
          disabled={pending || busy || Boolean(fetching) || goal.trim().length < 5 || !docs.length}
          className={`${buttonClass} py-1.5 text-xs`}
        >
          {(pending || fetching) && <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
          {pending ? "Reading abstracts…" : fetching ? "Waiting for papers…" : "Suggest a pass for each paper"}
        </button>
        <span className="text-xs text-muted">{fetching ? "It runs once every paper is in." : "AI suggestion; change any target yourself."}</span>
      </div>
      {fetching && (
        <div role="status" className="animate-fade mt-3 flex items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2 text-xs">
          <div className="indeterminate h-[3px] w-12 shrink-0 rounded-full bg-line" />
          <span className="min-w-0 truncate text-muted">{fetching}</span>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-dashed border-ink/40 bg-paper px-4 py-3">
        <p className="text-sm leading-snug">
          <span className="font-medium">Not sure what to read?</span>{" "}
          <span className="text-muted">Get a reading path for your goal, from landmark papers to the frontier.</span>
        </p>
        <button
          type="button"
          onClick={() => {
            if (goal !== researchGoal) onResearchGoal(goal);
            openRecommendPapers();
          }}
          disabled={Boolean(fetching)}
          className={`${ghostButtonClass} shrink-0 py-1.5 text-xs`}
        >
          Suggest papers
        </button>
      </div>
      {onAddPapers && (
        <button type="button" onClick={onAddPapers} disabled={Boolean(fetching)} className={`${ghostButtonClass} mt-2 w-full justify-center py-1.5 text-xs`}>
          + Add papers by arXiv ID, DOI, link or title
        </button>
      )}
      {docs.length > 0 && (onOpenMap || onTool) && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {onOpenMap && (
            <button
              type="button"
              onClick={onOpenMap}
              className="col-span-2 flex items-center justify-between gap-3 rounded-lg border border-ink bg-ink px-4 py-2.5 text-left text-white transition hover:-translate-y-px hover:shadow-[3px_3px_0_0_#facc15]"
            >
              <span>
                <span className="block text-sm font-medium">Literature map</span>
                <span className="block text-xs text-white/60">How these papers connect: shared foundations and newer work</span>
              </span>
              <span aria-hidden>→</span>
            </button>
          )}
          {onTool &&
            (
              [
                ["compare", "Compare papers"],
                ["related", "Draft related work"],
                ["bibtex", "Export BibTeX"],
                ["zotero", "Send notes to Zotero"],
              ] as const
            ).map(([tool, label]) => (
              <button key={tool} type="button" onClick={() => onTool(tool)} className={`${ghostButtonClass} justify-center py-1.5 text-xs`}>
                {label}
              </button>
            ))}
        </div>
      )}
    </section>
  );
}

function PaperWorkspace({
  doc,
  review,
  busy,
  onUpdate,
  onSend,
}: {
  doc: SessionDoc;
  review: PaperReview;
  busy: boolean;
  onUpdate: Props["onUpdate"];
  onSend: Props["onSend"];
}) {
  const [pass, setPass] = useState<PassNumber>(Math.min(3, review.passes_done + 1) as PassNumber);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const def = passDef(pass);
  const notes = passNotes(review, pass);
  const done = review.passes_done >= pass;
  const beyondTarget = pass > review.target_pass;
  const notesKey = `pass${pass}` as "pass1" | "pass2" | "pass3";

  const setNote = (key: string, value: string) => onUpdate(doc.id, { [notesKey]: { ...notes, [key]: value } });

  async function draftPass1() {
    setDrafting(true);
    setError(null);
    try {
      const res = await fetch("/api/paper/pass1", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ documentId: doc.id }) });
      if (!res.ok) throw new Error(await readAiError(res));
      const { draft } = (await res.json()) as { draft: Record<string, string> };
      // Fill only empty fields; never overwrite what the reader wrote.
      const merged = { ...review.pass1 };
      for (const [k, v] of Object.entries(draft)) if (!merged[k]?.trim() && v) merged[k] = v;
      onUpdate(doc.id, { pass1: merged });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't draft the first pass.");
    } finally {
      setDrafting(false);
      notifyAiUsed();
    }
  }

  return (
    <section className="animate-enter px-6 py-5">
      <p className={eyebrowClass}>Reading {doc.label}</p>
      <h3 className="mt-1 line-clamp-2 font-serif text-xl leading-snug">{doc.title}</h3>

      {/* Pass stepper */}
      <div className="mt-4 grid grid-cols-3 gap-1.5" role="tablist">
        {PASSES.map((p) => {
          const isDone = review.passes_done >= p.n;
          const selected = pass === p.n;
          const optional = p.n > review.target_pass;
          return (
            <button
              key={p.n}
              role="tab"
              aria-selected={selected}
              onClick={() => setPass(p.n)}
              className={`rounded-lg border px-2.5 py-2 text-left transition-all duration-200 ease-fluid ${
                selected ? "border-ink bg-ink text-white" : optional ? "border-dashed border-ink/30 text-muted hover:border-ink/60" : "border-ink/40 hover:border-ink"
              }`}
            >
              <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
                Pass {p.n}
                {isDone && <span aria-label="done">✓</span>}
              </span>
              <span className="mt-0.5 block truncate text-xs font-medium">{p.name}</span>
            </button>
          );
        })}
      </div>

      <div key={pass} className="animate-enter mt-5 space-y-5">
        <div>
          <p className="text-sm leading-relaxed">
            <span className="font-medium">{def.goal}</span> <span className="font-mono text-xs text-muted">· {def.time}</span>
          </p>
          {beyondTarget && (
            <p className="mt-2 rounded-lg border border-dashed border-ink/40 bg-paper px-3 py-2 text-xs text-muted">
              Beyond this paper&apos;s target (pass {review.target_pass}).{" "}
              <button onClick={() => onUpdate(doc.id, { target_pass: pass })} className="font-medium text-ink underline underline-offset-2">
                Promote to pass {pass}
              </button>
            </p>
          )}
        </div>

        {/* Checklist (persisted with the pass notes) */}
        <ul className="space-y-1.5">
          {def.checklist.map((item, i) => {
            const key = `check_${i}`;
            const checked = notes[key] === "1";
            return (
              <li key={key}>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setNote(key, checked ? "" : "1")}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
                  />
                  <span className={checked ? "text-muted line-through" : ""}>{item}</span>
                </label>
              </li>
            );
          })}
        </ul>

        {/* Notes */}
        <div className="space-y-4">
          {pass === 1 && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-paper px-3 py-2">
              <p className="text-xs text-muted">Short on time? Get an AI first draft, then check it against the paper.</p>
              <button
                onClick={draftPass1}
                disabled={drafting || busy}
                className="shrink-0 rounded-md border border-ink bg-panel px-2.5 py-1 text-xs font-medium transition hover:bg-ink hover:text-white disabled:opacity-40"
              >
                {drafting ? "Drafting…" : "Draft with AI"}
              </button>
            </div>
          )}
          {error && <p className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
          {def.fields.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1 block text-sm font-medium">{f.label}</span>
              <textarea
                rows={f.rows ?? 2}
                value={notes[f.key] ?? ""}
                onChange={(e) => setNote(f.key, e.target.value)}
                placeholder={f.hint}
                className={`${inputClass} resize-y leading-relaxed`}
              />
            </label>
          ))}
        </div>

        {/* Coach */}
        <div className="flex flex-wrap gap-1.5">
          {PASS_ACTIONS[pass].map((a) => (
            <button
              key={a.action}
              disabled={busy}
              onClick={() => onSend({ action: a.action })}
              className={`rounded-md border border-ink px-3 py-1.5 text-xs font-medium transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-hard-sm active:translate-y-0 disabled:pointer-events-none disabled:opacity-40 ${
                a.primary ? "bg-ink text-white" : "bg-panel"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* Completion */}
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          {done ? (
            <>
              <p className="text-xs leading-relaxed text-muted">✓ Pass {pass} done. {def.stopHere}</p>
              <button onClick={() => onUpdate(doc.id, { passes_done: (pass - 1) as 0 | 1 | 2 })} className="shrink-0 text-xs text-muted underline-offset-2 hover:underline">
                Undo
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                onUpdate(doc.id, { passes_done: Math.max(review.passes_done, pass) as 1 | 2 | 3 });
                if (pass < 3 && pass < review.target_pass) setPass((pass + 1) as PassNumber);
              }}
              className={`${buttonClass} py-1.5 text-xs`}
            >
              Mark pass {pass} done
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function TargetPicker({ value, onChange }: { value: PassNumber; onChange: (v: PassNumber) => void }) {
  return (
    <div className="relative grid shrink-0 grid-cols-3 rounded-md border border-ink p-0.5" role="radiogroup" aria-label="Target pass">
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 w-6 rounded bg-ink transition-transform duration-300 ease-fluid"
        style={{ transform: `translateX(${(value - 1) * 100}%)` }}
      />
      {([1, 2, 3] as const).map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(n)}
          className={`relative z-10 w-6 py-0.5 font-mono text-[11px] transition-colors duration-300 ${value === n ? "text-white" : "text-muted hover:text-ink"}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function PassPips({ done, target }: { done: number; target: number }) {
  return (
    <span className="mt-1 flex items-center gap-1" aria-label={`${done} of ${target} passes done`}>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={`h-1 w-5 rounded-full transition-colors duration-300 ${n <= done ? "bg-ink" : n <= target ? "bg-ink/20" : "border border-dashed border-ink/20"}`}
        />
      ))}
      <span className="ml-1 font-mono text-[10px] text-muted">{done >= target ? "done" : `${done}/${target}`}</span>
    </span>
  );
}

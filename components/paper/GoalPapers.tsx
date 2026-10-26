"use client";

import { useState } from "react";
import { buttonClass, eyebrowClass } from "@/components/ui";
import type { PaperMeta } from "@/lib/pdf/add-paper";

// "Your goal mentions 3 papers. Add them?" Shown in a study session after the
// goal is set, with every paper ticked; one click adds them as papers.
export function GoalPapers({
  papers,
  unresolved,
  busy,
  onAdd,
  onDismiss,
}: {
  papers: PaperMeta[];
  unresolved: string[];
  busy: boolean;
  onAdd: (papers: PaperMeta[]) => void;
  onDismiss: () => void;
}) {
  const [picked, setPicked] = useState(() => new Set(papers.map((_, i) => i)));
  const chosen = papers.filter((_, i) => picked.has(i));

  return (
    <section className="animate-enter shrink-0 border-b border-ink bg-yellow-50 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={eyebrowClass}>From your goal</p>
          <p className="mt-0.5 font-serif text-lg leading-snug">
            {papers.length ? `Your goal mentions ${papers.length === 1 ? "a paper" : `${papers.length} papers`}. Add ${papers.length === 1 ? "it" : "them"}?` : "Your goal mentions papers we couldn't find"}
          </p>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-mt-1 -mr-1 rounded-md px-1.5 text-muted transition hover:bg-paper hover:text-ink">
          ✕
        </button>
      </div>

      {papers.length > 0 && (
        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
          {papers.map((p, i) => (
            <li key={`${p.title}-${i}`}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-panel">
                <input
                  type="checkbox"
                  checked={picked.has(i)}
                  onChange={() =>
                    setPicked((s) => {
                      const next = new Set(s);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                  className="mt-1 size-4 shrink-0 accent-[var(--ink)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm leading-snug font-medium">{p.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {[p.authors?.slice(0, 2).join(", ") + (p.authors && p.authors.length > 2 ? " et al." : ""), p.year, p.pdf_url ? "PDF" : "abstract only"].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {unresolved.length > 0 && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Couldn&apos;t find {unresolved.map((t) => `“${t}”`).join(", ")}. Add {unresolved.length === 1 ? "it" : "them"} with “+ Add material” → Adding a research paper.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        {papers.length > 0 && (
          <button type="button" disabled={busy || !chosen.length} onClick={() => onAdd(chosen)} className={`${buttonClass} py-1.5 text-xs`}>
            Add {chosen.length} {chosen.length === 1 ? "paper" : "papers"}
          </button>
        )}
        <button type="button" onClick={onDismiss} className="rounded-md px-2.5 py-1.5 text-xs text-muted transition hover:text-ink">
          {papers.length ? "Not now" : "OK"}
        </button>
      </div>
    </section>
  );
}

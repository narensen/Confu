"use client";

import { useEffect, useMemo, useState } from "react";
import { colorOf } from "@/lib/highlights";
import { createClient } from "@/lib/supabase/client";
import type { Highlight } from "@confu/core/types";

// "Where it got hard": per page, the time spent, questions asked and passages
// marked as confusing, so the student can see where they slowed down.

type PageStat = { page: number; seconds: number; visits: number; questions: number; confusing: number };

const mins = (s: number) => (s < 60 ? `${Math.max(1, Math.round(s))}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`);

export function ReadingMap({
  documentId,
  numPages,
  current,
  highlights,
  onPick,
  onClose,
}: {
  documentId?: string;
  numPages: number;
  current: number;
  highlights: Highlight[];
  onPick: (page: number) => void;
  onClose: () => void;
}) {
  const [time, setTime] = useState<Map<number, { seconds: number; visits: number }> | null>(null);
  const [questions, setQuestions] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    if (!documentId) return;
    const supabase = createClient();
    let live = true;
    void Promise.all([
      supabase.from("page_time").select("page_number, seconds, visits").eq("document_id", documentId),
      supabase.from("messages").select("page_number").eq("document_id", documentId).eq("role", "user").not("page_number", "is", null).limit(3000),
    ]).then(([t, q]) => {
      if (!live) return;
      setTime(new Map(((t.data ?? []) as { page_number: number; seconds: number; visits: number }[]).map((r) => [r.page_number, { seconds: r.seconds, visits: r.visits }])));
      const counts = new Map<number, number>();
      for (const r of (q.data ?? []) as { page_number: number }[]) counts.set(r.page_number, (counts.get(r.page_number) ?? 0) + 1);
      setQuestions(counts);
    });
    return () => {
      live = false;
    };
  }, [documentId]);

  const stats = useMemo(() => {
    const confusing = new Map<number, number>();
    for (const h of highlights) if (h.kind === "text" && colorOf(h.color) === "red") confusing.set(h.page_number, (confusing.get(h.page_number) ?? 0) + 1);
    const out: PageStat[] = [];
    for (let p = 1; p <= numPages; p++) {
      const t = time?.get(p);
      out.push({ page: p, seconds: t?.seconds ?? 0, visits: t?.visits ?? 0, questions: questions.get(p) ?? 0, confusing: confusing.get(p) ?? 0 });
    }
    return out;
  }, [time, questions, highlights, numPages]);

  const total = stats.reduce((s, p) => s + p.seconds, 0);
  const visited = stats.filter((p) => p.seconds > 0).length;
  const maxSeconds = Math.max(1, ...stats.map((p) => p.seconds));
  const median = (() => {
    const v = stats.filter((p) => p.seconds > 0).map((p) => p.seconds).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  })();
  // Hard = well above your usual time on a page, plus questions and confusing marks.
  const hardest = stats
    .map((p) => ({ ...p, score: (median ? p.seconds / median : 0) + p.questions * 1.5 + p.confusing * 1.5 + Math.max(0, p.visits - 2) * 0.5 }))
    .filter((p) => p.score >= 2 || p.questions >= 2 || p.confusing > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  return (
    <aside aria-label="Where it got hard" className="animate-slide-in absolute inset-y-0 left-0 z-20 flex w-80 max-w-[90%] flex-col border-r border-ink bg-panel shadow-[6px_0_0_0_rgba(13,13,12,0.08)]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-1.5 pl-3">
        <p className="font-mono text-[11px] font-medium tracking-[0.12em] text-muted uppercase">Where it got hard</p>
        <button type="button" aria-label="Close" onClick={onClose} className="flex size-7 items-center justify-center rounded-md text-sm hover:bg-paper">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!documentId ? (
          <p className="text-sm text-muted">Reading time is tracked for the files in your sessions.</p>
        ) : time === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <p className="text-sm">
              <span className="text-2xl font-semibold tracking-tight">{total ? mins(total) : "No time yet"}</span>
              {total > 0 && <span className="ml-2 text-xs text-muted">on {visited} {visited === 1 ? "page" : "pages"}</span>}
            </p>

            {/* One bar per page: time spent (ink), current page in yellow. */}
            <div className="mt-4" role="img" aria-label="Time spent on each page">
              <div className="flex h-16 items-end gap-px">
                {stats.slice(0, 400).map((p) => (
                  <button
                    key={p.page}
                    type="button"
                    title={`p. ${p.page}: ${p.seconds ? mins(p.seconds) : "not read"}${p.questions ? ` · ${p.questions} question${p.questions > 1 ? "s" : ""}` : ""}${p.confusing ? ` · ${p.confusing} confusing` : ""}`}
                    onClick={() => onPick(p.page)}
                    className="flex h-full min-w-0 flex-1 items-end"
                  >
                    <span
                      className={`block w-full rounded-t-[2px] ${p.page === current ? "bg-yellow-400" : p.confusing || p.questions ? "bg-danger/80" : "bg-ink"}`}
                      style={{ height: `${Math.max(p.seconds ? 6 : 1, (p.seconds / maxSeconds) * 100)}%`, opacity: p.seconds || p.page === current ? 1 : 0.18 }}
                    />
                  </button>
                ))}
              </div>
              <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
                <span>p. 1</span>
                <span>p. {numPages}</span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                Bar height is time on the page. Red pages are where you asked questions or marked something as confusing.
              </p>
            </div>

            <p className="mt-5 font-mono text-[11px] font-medium tracking-[0.12em] text-muted uppercase">Hardest pages</p>
            {hardest.length === 0 ? (
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Nothing stands out yet. Keep reading: Confu notes where you slow down, ask questions or mark things as confusing (red highlighter).
              </p>
            ) : (
              <ol className="mt-2 space-y-1">
                {hardest.map((p) => (
                  <li key={p.page}>
                    <button type="button" onClick={() => onPick(p.page)} className="flex w-full items-baseline gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-paper">
                      <span className="w-12 shrink-0 font-mono text-xs font-medium">p. {p.page}</span>
                      <span className="text-xs leading-relaxed text-muted">
                        {[
                          p.seconds ? mins(p.seconds) : "",
                          p.questions ? `${p.questions} question${p.questions > 1 ? "s" : ""}` : "",
                          p.confusing ? `${p.confusing} marked confusing` : "",
                          p.visits > 2 ? `came back ${p.visits}×` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

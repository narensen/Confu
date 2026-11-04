export type AnswerNote = {
  id: number;
  rating: "up" | "down" | null;
  comment: string | null;
  correction: string | null;
  answer: string;
  path: string | null;
  created_at: string;
  email: string | null;
};

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function AnswerFeedback({ notes, missing }: { notes: AnswerNote[]; missing?: boolean }) {
  if (missing) {
    return (
      <p className="rounded-lg border border-dashed border-ink/30 px-4 py-6 text-center text-sm text-muted">
        A new project runs <code className="font-mono">supabase/schema.sql</code> once to start collecting these.
      </p>
    );
  }
  if (notes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-ink/30 px-4 py-6 text-center text-sm text-muted">
        None yet. A thumb under a tutor answer can include a correction and a comment.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {notes.map((n) => (
        <li key={n.id} className="py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-ink/30 px-2 py-0.5 font-mono text-[11px] font-medium">{n.rating === "down" ? "Not quite" : n.rating === "up" ? "Helpful" : "Note"}</span>
            <span className="ml-auto text-[11px] text-muted">{ago(n.created_at)}</span>
          </div>
          {n.correction && (
            <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
              <span className="mb-1 block font-mono text-[10px] tracking-wider text-muted uppercase">Correction</span>
              {n.correction}
            </p>
          )}
          {n.comment && <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{n.comment}</p>}
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted">{n.answer}</p>
          <p className="mt-1.5 truncate text-[11px] text-muted">
            {n.email ?? "deleted account"}
            {n.path ? ` · ${n.path}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

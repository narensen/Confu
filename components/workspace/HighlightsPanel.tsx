"use client";

import { eyebrowClass } from "@/components/ui";
import type { Highlight, SessionDoc } from "@/lib/types";
import { Markdown } from "./Markdown";
import type { SendRequest } from "./Workspace";

type Props = {
  highlights: Highlight[];
  docs: SessionDoc[];
  busy: boolean;
  onJump: (page: number, docId?: string | null) => void;
  onDelete: (h: Highlight) => void;
  onSend: (req: SendRequest) => void;
};

export function HighlightsPanel({ highlights, docs, busy, onJump, onDelete, onSend }: Props) {
  const order = new Map(docs.map((d, i) => [d.id, i]));
  const labelOf = (id: string) => docs.find((d) => d.id === id)?.label;
  if (!highlights.length) {
    return (
      <div className="animate-enter p-6">
        <p className={eyebrowClass}>Highlights</p>
        <h3 className="mt-1 font-serif text-2xl">Nothing marked yet</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Select text in the PDF and choose <span className="font-medium text-ink">Highlight</span>, or use{" "}
          <span className="font-medium text-ink">Capture region</span> on a figure, table or equation.
        </p>
      </div>
    );
  }

  const sorted = [...highlights].sort(
    (a, b) =>
      (order.get(a.document_id) ?? 0) - (order.get(b.document_id) ?? 0) ||
      a.page_number - b.page_number ||
      a.created_at.localeCompare(b.created_at),
  );

  return (
    <ul className="h-full space-y-3 overflow-y-auto p-5">
      {sorted.map((h, i) => (
        <li
          key={h.id}
          className="group animate-enter rounded-xl border border-ink bg-panel p-4 transition duration-200 ease-fluid hover:shadow-hard-sm"
          style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
        >
          <div className="mb-2.5 flex items-center gap-2 text-xs">
            <span className={`size-3 rounded-sm ${h.kind === "region" ? "border border-dashed border-ink" : "bg-yellow-300"}`} />
            <button onClick={() => onJump(h.page_number, h.document_id)} className="font-mono font-medium underline-offset-4 hover:underline">
              {docs.length > 1 ? `${labelOf(h.document_id) ?? ""} ` : ""}p. {h.page_number}
            </button>
            <span className="text-muted">{h.kind === "region" ? "Figure / region" : "Text"}</span>
            <div className="flex-1" />
            <button
              onClick={() => onDelete(h)}
              className="text-muted opacity-0 transition group-hover:opacity-100 hover:text-danger focus:opacity-100"
              aria-label="Delete highlight"
            >
              Delete
            </button>
          </div>
          {h.kind === "text" ? (
            <p className="border-l-2 border-yellow-400 pl-3 text-sm leading-relaxed">{h.selected_text}</p>
          ) : (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted transition hover:text-ink">What the vision model saw</summary>
              <Markdown content={h.vlm_description ?? ""} className="prose-tutor prose-compact mt-2" />
            </details>
          )}
          <div className="mt-3 flex gap-1.5">
            {h.kind === "text" ? (
              <>
                <Chip disabled={busy} onClick={() => onSend({ action: "context", selection: { text: h.selected_text ?? "", page: h.page_number, documentId: h.document_id } })}>
                  Context
                </Chip>
                <Chip disabled={busy} onClick={() => onSend({ action: "simplify", selection: { text: h.selected_text ?? "", page: h.page_number, documentId: h.document_id } })}>
                  Simplify
                </Chip>
              </>
            ) : (
              <Chip disabled={busy} onClick={() => onSend({ action: "figure", highlightId: h.id, figure: { page: h.page_number, documentId: h.document_id } })}>
                Explain again
              </Chip>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Chip(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="rounded-full border border-ink px-3 py-0.5 text-xs transition duration-200 hover:bg-ink hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-40"
      {...props}
    />
  );
}

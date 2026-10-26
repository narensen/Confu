"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/components/dialogs";
import { eyebrowClass } from "@/components/ui";
import { COLOR_ORDER, colorOf, HIGHLIGHT_COLORS, type HighlightColor } from "@/lib/highlights";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";
import type { Highlight, SessionDoc } from "@/lib/types";
import { Markdown } from "./Markdown";
import type { SendRequest } from "./Workspace";

// Your marks, by meaning: important, definitions, confusing, examples, notes,
// and a gallery of captured figures.

type Filter = "all" | HighlightColor | "notes" | "figures";

type Props = {
  sessionId: string;
  highlights: Highlight[];
  docs: SessionDoc[];
  busy: boolean;
  onJump: (page: number, docId?: string | null) => void;
  onDelete: (h: Highlight) => void;
  onUpdate: (h: Highlight, patch: { color?: HighlightColor; note?: string | null }) => void;
  onSend: (req: SendRequest) => void;
};

// Download the whole session: Markdown (Obsidian, Notion, any editor) or Anki cards.
function ExportLinks({ sessionId }: { sessionId: string }) {
  const link = "underline-offset-4 transition hover:text-ink hover:underline";
  return (
    <p className="text-[11px] text-muted">
      Take it with you:{" "}
      <a href={`/api/export/session?id=${sessionId}&format=md`} download onClick={() => track("export.markdown")} className={link}>
        whole session (Markdown)
      </a>
      {" · "}
      <a href={`/api/export/session?id=${sessionId}&format=anki`} download onClick={() => track("export.anki")} className={link} title="In Anki: File → Import">
        review cards (Anki)
      </a>
    </p>
  );
}

export function HighlightsPanel({ sessionId, highlights, docs, busy, onJump, onDelete, onUpdate, onSend }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const order = useMemo(() => new Map(docs.map((d, i) => [d.id, i])), [docs]);
  const labelOf = (id: string) => docs.find((d) => d.id === id)?.label;
  const sorted = useMemo(
    () =>
      [...highlights].sort(
        (a, b) => (order.get(a.document_id) ?? 0) - (order.get(b.document_id) ?? 0) || a.page_number - b.page_number || a.created_at.localeCompare(b.created_at),
      ),
    [highlights, order],
  );

  const texts = sorted.filter((h) => h.kind === "text");
  const figures = sorted.filter((h) => h.kind === "region");
  const counts: Record<Filter, number> = {
    all: sorted.length,
    yellow: texts.filter((h) => colorOf(h.color) === "yellow").length,
    blue: texts.filter((h) => colorOf(h.color) === "blue").length,
    red: texts.filter((h) => colorOf(h.color) === "red").length,
    green: texts.filter((h) => colorOf(h.color) === "green").length,
    notes: texts.filter((h) => h.note).length,
    figures: figures.length,
  };
  const shown =
    filter === "all" ? sorted : filter === "figures" ? figures : filter === "notes" ? texts.filter((h) => h.note) : texts.filter((h) => colorOf(h.color) === filter);

  if (!highlights.length) {
    return (
      <div className="animate-enter p-6">
        <p className={eyebrowClass}>Highlights</p>
        <h3 className="mt-1 font-serif text-2xl">Nothing marked yet</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">Select text in the PDF and pick a highlighter:</p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {COLOR_ORDER.map((c) => (
            <li key={c} className="flex items-center gap-2">
              <span className="size-3 rounded-full" style={{ background: HIGHLIGHT_COLORS[c].swatch }} />
              <b className="font-medium">{HIGHLIGHT_COLORS[c].label}</b>
              <span className="text-muted">· {HIGHLIGHT_COLORS[c].hint}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Add a <b className="font-medium text-ink">Note</b> to any passage, or use <b className="font-medium text-ink">Capture region</b> on a figure, table or equation.
        </p>
        <div className="mt-5 border-t border-line pt-3">
          <ExportLinks sessionId={sessionId} />
        </div>
      </div>
    );
  }

  function copyNotes() {
    const by = (c: HighlightColor) => texts.filter((h) => colorOf(h.color) === c);
    const ref = (h: Highlight) => `${docs.length > 1 ? `${labelOf(h.document_id) ?? ""} ` : ""}p. ${h.page_number}`;
    const lines: string[] = [];
    for (const c of COLOR_ORDER) {
      const list = by(c);
      if (!list.length) continue;
      lines.push(`## ${HIGHLIGHT_COLORS[c].label}`, "");
      for (const h of list) {
        lines.push(`- ${h.selected_text?.replace(/\s+/g, " ").trim()} (${ref(h)})`);
        if (h.note) lines.push(`  - Note: ${h.note.replace(/\s+/g, " ")}`);
      }
      lines.push("");
    }
    if (figures.length) {
      lines.push("## Figures", "");
      for (const f of figures) lines.push(`- ${ref(f)}: ${(f.vlm_description ?? "").split("\n")[0].slice(0, 200)}`);
    }
    void navigator.clipboard.writeText(lines.join("\n").trim()).then(
      () => toast("Copied your highlights and notes as Markdown."),
      () => toast("Couldn't copy. Your browser blocked the clipboard.", "error"),
    );
    track("highlights.copy");
  }

  const chips: { id: Filter; label: string; swatch?: string }[] = [
    { id: "all", label: "All" },
    ...COLOR_ORDER.map((c) => ({ id: c as Filter, label: c === "blue" ? "Definitions" : c === "green" ? "Examples" : HIGHLIGHT_COLORS[c].label, swatch: HIGHLIGHT_COLORS[c].swatch })),
    { id: "notes", label: "Notes" },
    { id: "figures", label: "Figures" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line px-4 pt-3 pb-2.5">
        <div className="flex flex-wrap gap-1.5">
          {chips
            .filter((c) => c.id === "all" || counts[c.id] > 0)
            .map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setFilter(c.id)}
                aria-pressed={filter === c.id}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${filter === c.id ? "border-ink bg-ink text-white" : "border-ink/25 hover:border-ink"}`}
              >
                {c.swatch && <span className="size-2 rounded-full" style={{ background: c.swatch }} />}
                {c.label}
                <span className={filter === c.id ? "text-white/60" : "text-muted"}>{counts[c.id]}</span>
              </button>
            ))}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <button type="button" onClick={copyNotes} className="text-[11px] text-muted underline-offset-4 transition hover:text-ink hover:underline">
            Copy highlights (Markdown)
          </button>
          <ExportLinks sessionId={sessionId} />
        </div>
      </div>

      {filter === "figures" ? (
        <FigureGallery figures={figures} docs={docs} busy={busy} onJump={onJump} onSend={onSend} />
      ) : (
        <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {shown.map((h, i) =>
            h.kind === "text" ? (
              <TextCard key={h.id} h={h} i={i} label={docs.length > 1 ? labelOf(h.document_id) : undefined} busy={busy} onJump={onJump} onDelete={onDelete} onUpdate={onUpdate} onSend={onSend} />
            ) : (
              <li key={h.id} className="animate-enter rounded-xl border border-ink bg-panel p-4" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <span className="size-3 rounded-sm border border-dashed border-ink" />
                  <button onClick={() => onJump(h.page_number, h.document_id)} className="font-mono font-medium underline-offset-4 hover:underline">
                    {docs.length > 1 ? `${labelOf(h.document_id) ?? ""} ` : ""}p. {h.page_number}
                  </button>
                  <span className="text-muted">Figure / region</span>
                  <span className="flex-1" />
                  <button onClick={() => onDelete(h)} className="text-muted hover:text-danger">
                    Delete
                  </button>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted transition hover:text-ink">What the vision model saw</summary>
                  <Markdown content={h.vlm_description ?? ""} className="prose-tutor prose-compact mt-2" />
                </details>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function TextCard({
  h,
  i,
  label,
  busy,
  onJump,
  onDelete,
  onUpdate,
  onSend,
}: {
  h: Highlight;
  i: number;
  label?: string;
  busy: boolean;
  onJump: Props["onJump"];
  onDelete: Props["onDelete"];
  onUpdate: Props["onUpdate"];
  onSend: Props["onSend"];
}) {
  const color = colorOf(h.color);
  const meta = HIGHLIGHT_COLORS[color];
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(h.note ?? "");
  const selection = { text: h.selected_text ?? "", page: h.page_number, documentId: h.document_id };

  return (
    <li className="group animate-enter rounded-xl border border-ink bg-panel p-4 transition duration-200 ease-fluid hover:shadow-hard-sm" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
      <div className="mb-2.5 flex items-center gap-2 text-xs">
        <span className="size-3 rounded-full" style={{ background: meta.swatch }} />
        <button onClick={() => onJump(h.page_number, h.document_id)} className="font-mono font-medium underline-offset-4 hover:underline">
          {label ? `${label} ` : ""}p. {h.page_number}
        </button>
        <span className="text-muted">{meta.label}</span>
        <span className="flex-1" />
        {/* Recolour */}
        <span className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          {COLOR_ORDER.filter((c) => c !== color).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onUpdate(h, { color: c })}
              title={`Mark as ${HIGHLIGHT_COLORS[c].label}`}
              aria-label={`Mark as ${HIGHLIGHT_COLORS[c].label}`}
              className="flex size-5 items-center justify-center rounded hover:bg-paper"
            >
              <span className="size-2.5 rounded-full" style={{ background: HIGHLIGHT_COLORS[c].swatch }} />
            </button>
          ))}
        </span>
        <button onClick={() => onDelete(h)} className="text-muted opacity-0 transition group-hover:opacity-100 hover:text-danger focus:opacity-100" aria-label="Delete highlight">
          Delete
        </button>
      </div>
      <p className="border-l-[3px] pl-3 text-sm leading-relaxed" style={{ borderColor: meta.swatch }}>
        {h.selected_text}
      </p>

      {noting ? (
        <div className="mt-3 space-y-2">
          <textarea
            autoFocus
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Your note…"
            className="w-full resize-y rounded-lg border border-ink/30 p-2 text-sm outline-none focus:border-ink"
          />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setNoting(false)} className="rounded-md px-2.5 py-1 text-xs text-muted hover:text-ink">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdate(h, { note: note.trim() || null });
                setNoting(false);
              }}
              className="rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-white"
            >
              Save note
            </button>
          </div>
        </div>
      ) : h.note ? (
        <button type="button" onClick={() => setNoting(true)} className="mt-3 block w-full rounded-lg bg-paper px-3 py-2 text-left text-sm leading-relaxed whitespace-pre-wrap transition hover:bg-line/60">
          <span className="mr-1 font-mono text-[10px] tracking-wider text-muted uppercase">Note</span>
          {h.note}
        </button>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {color === "red" && (
          <Chip primary disabled={busy} onClick={() => onSend({ action: "ask", message: "I marked this as confusing. What's going on here?", selection })}>
            Ask about this
          </Chip>
        )}
        <Chip disabled={busy} onClick={() => onSend({ action: "context", selection })}>
          Context
        </Chip>
        <Chip disabled={busy} onClick={() => onSend({ action: "simplify", selection })}>
          Simplify
        </Chip>
        {!h.note && !noting && <Chip onClick={() => setNoting(true)}>+ Note</Chip>}
      </div>
    </li>
  );
}

// Every captured figure, table and equation as a grid; click to enlarge.
function FigureGallery({
  figures,
  docs,
  busy,
  onJump,
  onSend,
}: {
  figures: Highlight[];
  docs: SessionDoc[];
  busy: boolean;
  onJump: Props["onJump"];
  onSend: Props["onSend"];
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Highlight | null>(null);
  const paths = useMemo(() => figures.flatMap((f) => (f.image_path ? [f.image_path] : [])), [figures]);

  useEffect(() => {
    if (!paths.length) return;
    let live = true;
    void createClient()
      .storage.from("documents")
      .createSignedUrls(paths, 3600)
      .then(({ data }) => {
        if (!live || !data) return;
        setUrls(Object.fromEntries(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl]] : []))));
      });
    return () => {
      live = false;
    };
  }, [paths]);

  const label = (f: Highlight) => `${docs.length > 1 ? `${docs.find((d) => d.id === f.document_id)?.label ?? ""} ` : ""}p. ${f.page_number}`;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-2 gap-3">
        {figures.map((f) => (
          <button key={f.id} type="button" onClick={() => setOpen(f)} className="group overflow-hidden rounded-xl border border-ink bg-panel text-left transition hover:shadow-hard-sm">
            <div className="flex aspect-[4/3] items-center justify-center bg-paper">
              {f.image_path && urls[f.image_path] ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                <img src={urls[f.image_path]} alt={`Figure on ${label(f)}`} className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-xs text-muted">{f.image_path ? "Loading…" : "No image saved"}</span>
              )}
            </div>
            <p className="truncate border-t border-line px-2.5 py-1.5 text-xs">
              <span className="font-mono font-medium">{label(f)}</span>{" "}
              <span className="text-muted">{(f.vlm_description ?? "").replace(/[#*_`>]/g, "").slice(0, 60)}</span>
            </p>
          </button>
        ))}
      </div>

      {open && (
        <div className="animate-fade fixed inset-0 z-[70] flex items-center justify-center bg-ink/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <div role="dialog" aria-modal="true" className="animate-pop flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <p className="font-mono text-xs font-medium">{label(open)}</p>
              <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="rounded px-2 text-muted hover:text-ink">
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {open.image_path && urls[open.image_path] && (
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                <img src={urls[open.image_path]} alt={`Figure on ${label(open)}`} className="mx-auto max-h-[50vh] rounded-lg border border-line object-contain" />
              )}
              <Markdown content={open.vlm_description ?? ""} className="prose-tutor prose-compact mt-4" />
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <Chip
                onClick={() => {
                  onJump(open.page_number, open.document_id);
                  setOpen(null);
                }}
              >
                Open the page
              </Chip>
              <Chip
                primary
                disabled={busy}
                onClick={() => {
                  onSend({ action: "figure", highlightId: open.id, figure: { page: open.page_number, documentId: open.document_id } });
                  setOpen(null);
                }}
              >
                Explain again
              </Chip>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ primary, ...props }: { primary?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`rounded-full border border-ink px-3 py-0.5 text-xs transition duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-40 ${
        primary ? "bg-ink text-white hover:opacity-85" : "hover:bg-ink hover:text-white"
      }`}
      {...props}
    />
  );
}

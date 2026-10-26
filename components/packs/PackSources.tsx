"use client";

import { useEffect, useRef, useState } from "react";
import { ask, toast } from "@/components/dialogs";
import { eyebrowClass, ghostButtonClass } from "@/components/ui";
import { JSON_HEADERS } from "@/lib/ai-errors";
import { buildPdfFile } from "@/lib/import/build-pdf";
import { coursePdf, lecturePdf, webPagePdf } from "@/lib/import/fetch-client";
import { SAMPLE } from "@/lib/import/sample";
import { SOURCE_LABEL, type PackSource } from "@/lib/packs";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";
import type { SessionDoc } from "@/lib/types";

// A session copied from a study pack or a template starts with its sources
// as placeholders. This fetches them into real PDFs (papers, web pages,
// courses, lectures) and asks for the student's own copy of files the author
// uploaded. Also shows where the session came from, and lets the student stop
// sharing progress with a class.

export const pendingSource = (d: SessionDoc): PackSource | null => (!d.hasPdf ? ((d.meta as { pack_source?: PackSource }).pack_source ?? null) : null);
const fetchable = (s: PackSource) => (s.kind === "paper" ? Boolean(s.pdf_url) : s.kind !== "file");

export async function fetchSourceFile(s: PackSource, onStatus: (s: string) => void): Promise<File> {
  switch (s.kind) {
    case "paper": {
      onStatus(`Fetching PDF: ${s.title}`);
      const res = await fetch("/api/paper/pdf", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ url: s.pdf_url }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't fetch the PDF.");
      return new File([await res.blob()], `${(s.arxiv_id ?? s.title).replace(/[^\w.-]+/g, "_").slice(0, 60)}.pdf`, { type: "application/pdf" });
    }
    case "web":
      return (await webPagePdf(s.url!, onStatus)).file;
    case "web_course":
      return (await coursePdf({ url: s.url!, title: s.title, pages: s.links }, onStatus)).file;
    case "youtube":
      return (await lecturePdf({ url: s.url! }, onStatus)).file;
    case "sample":
      return buildPdfFile(SAMPLE);
    default:
      throw new Error("Add your own copy of this file.");
  }
}

type Origin = { slug: string; title: string; author_name: string | null; class_mode: boolean; share_progress: boolean };

export function PackSources({
  sessionId,
  docs,
  busy,
  onAttach,
  onSelect,
}: {
  sessionId: string;
  docs: SessionDoc[];
  busy: boolean;
  onAttach: (docId: string, file: File) => Promise<boolean>;
  onSelect: (docId: string) => void;
}) {
  const pending = docs.filter((d) => pendingSource(d));
  const auto = pending.filter((d) => fetchable(pendingSource(d)!));
  const yours = pending.filter((d) => !fetchable(pendingSource(d)!));
  const [state, setState] = useState<Record<string, string>>({}); // docId → "working" or an error
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    void createClient()
      .rpc("my_pack_copy", { p_session: sessionId })
      .then(({ data }) => {
        if (live) setOrigin(((data ?? []) as Origin[])[0] ?? null);
      });
    return () => {
      live = false;
    };
  }, [sessionId]);

  async function fetchOne(d: SessionDoc) {
    setState((s) => ({ ...s, [d.id]: "working" }));
    try {
      const file = await fetchSourceFile(pendingSource(d)!, setLine);
      if (!(await onAttach(d.id, file))) throw new Error("Couldn't add it. Try again.");
      setState((s) => {
        const next = { ...s };
        delete next[d.id];
        return next;
      });
    } catch (err) {
      setState((s) => ({ ...s, [d.id]: err instanceof Error ? err.message : "Couldn't fetch it." }));
    }
  }

  async function fetchAll() {
    setRunning(true);
    track("pack.fetch_sources", { count: auto.length });
    for (const d of auto) await fetchOne(d);
    setRunning(false);
    setLine(null);
  }

  if (!pending.length && !origin?.class_mode) return null;

  return (
    <div className="shrink-0 border-b border-ink bg-yellow-50">
      {origin?.class_mode && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink/15 px-4 py-2 text-xs">
          <span className="text-muted">
            From the pack <span className="font-medium text-ink">{origin.title}</span>
            {origin.author_name ? ` by ${origin.author_name}` : ""}.
          </span>
          {origin.share_progress ? (
            <>
              <span>Sharing your progress (topics done, days active) with {origin.author_name ?? "its author"}.</span>
              <button
                type="button"
                onClick={async () => {
                  if (!(await ask({ title: "Stop sharing your progress?", body: "The pack's author won't see your progress any more. Your session stays as it is.", confirm: "Stop sharing" }))) return;
                  const { error } = await createClient().from("pack_copies").update({ share_progress: false }).eq("session_id", sessionId);
                  if (error) return toast("Couldn't change that. Try again.", "error");
                  setOrigin({ ...origin, share_progress: false });
                }}
                className="underline underline-offset-2 hover:text-ink"
              >
                Stop sharing
              </button>
            </>
          ) : (
            <span className="text-muted">Your progress isn&apos;t shared.</span>
          )}
        </div>
      )}
      {pending.length > 0 && (
        <div className="px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-medium">
                {auto.length ? `${auto.length} ${auto.length === 1 ? "source" : "sources"} to fetch` : ""}
                {auto.length && yours.length ? " · " : ""}
                {yours.length ? `${yours.length} to add yourself` : ""}
              </span>
              {running && line ? <span className="ml-2 truncate text-xs text-muted">{line}</span> : null}
            </p>
            {auto.length > 0 && (
              <button
                type="button"
                onClick={fetchAll}
                disabled={running || busy}
                className="rounded-md border border-ink bg-ink px-3 py-1 text-xs font-medium text-white transition hover:-translate-y-px hover:shadow-[2px_2px_0_0_#facc15] disabled:opacity-50"
              >
                {running ? "Fetching…" : "Fetch all"}
              </button>
            )}
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
              {open ? "Hide list" : "Show list"}
            </button>
          </div>
          {open && (
            <ul className="animate-enter mt-2.5 max-h-60 space-y-1 overflow-y-auto">
              {pending.map((d) => {
                const s = pendingSource(d)!;
                const st = state[d.id];
                return (
                  <li key={d.id} className="flex items-center gap-2.5 rounded-lg bg-panel px-2.5 py-1.5 text-sm">
                    <span className={`${eyebrowClass} w-16 shrink-0`}>{SOURCE_LABEL[s.kind]}</span>
                    <button type="button" onClick={() => onSelect(d.id)} className="min-w-0 flex-1 truncate text-left hover:underline">
                      {d.title}
                    </button>
                    {st === "working" ? (
                      <span className="shrink-0 text-xs text-muted">Fetching…</span>
                    ) : fetchable(s) ? (
                      <button type="button" disabled={running || busy} onClick={() => fetchOne(d)} className={`${ghostButtonClass} shrink-0 px-2 py-0.5 text-xs`}>
                        {st ? "Retry" : "Fetch"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          uploadFor.current = d.id;
                          upload.current?.click();
                        }}
                        className={`${ghostButtonClass} shrink-0 px-2 py-0.5 text-xs`}
                      >
                        Add your copy
                      </button>
                    )}
                    {st && st !== "working" && (
                      <span className="max-w-48 shrink-0 truncate text-xs text-danger" title={st}>
                        {st}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <input
            ref={upload}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file && uploadFor.current) await onAttach(uploadFor.current, file);
            }}
          />
        </div>
      )}
    </div>
  );
}

// In place of the viewer, for a source that hasn't been fetched yet.
export function PendingSourceCard({ doc, busy, onAttach }: { doc: SessionDoc; busy: boolean; onAttach: (docId: string, file: File) => Promise<boolean> }) {
  const s = pendingSource(doc)!;
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="h-full overflow-y-auto bg-viewer px-6 py-8">
      <article className="animate-enter mx-auto max-w-xl rounded-xl border border-ink bg-panel p-8 shadow-hard">
        <p className={eyebrowClass}>
          {doc.label} · {SOURCE_LABEL[s.kind]}
        </p>
        <h1 className="mt-2 font-serif text-3xl leading-tight tracking-tight">{doc.title}</h1>
        {s.url && (
          <a href={s.url} target="_blank" rel="noreferrer" className="mt-3 inline-block max-w-full truncate font-mono text-xs text-muted underline-offset-2 hover:underline">
            {s.url.replace(/^https?:\/\//, "")} ↗
          </a>
        )}
        <p className="mt-5 text-sm leading-relaxed text-muted">
          {fetchable(s)
            ? "This came with the pack. Fetch it and it becomes a PDF you can read, highlight and ask about, like anything you upload."
            : "The pack's author used their own copy of this. Add yours (a PDF) and it slots into the plan."}
        </p>
        {error && <p className="animate-pop mt-3 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex items-center gap-3">
          {fetchable(s) ? (
            <button
              type="button"
              disabled={busy || Boolean(status)}
              onClick={async () => {
                setError(null);
                try {
                  const file = await fetchSourceFile(s, setStatus);
                  if (!(await onAttach(doc.id, file))) throw new Error("Couldn't add it. Try again.");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Couldn't fetch it.");
                } finally {
                  setStatus(null);
                }
              }}
              className="rounded-lg border border-ink bg-ink px-4 py-2 text-sm font-medium text-white transition hover:-translate-y-px hover:shadow-hard-sm disabled:opacity-50"
            >
              {status ? "Fetching…" : "Fetch it now"}
            </button>
          ) : (
            <>
              <input
                ref={input}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) await onAttach(doc.id, file);
                }}
              />
              <button type="button" disabled={busy} onClick={() => input.current?.click()} className={`${ghostButtonClass} py-2`}>
                Add your copy (PDF)
              </button>
            </>
          )}
          {status && <span className="truncate text-xs text-muted">{status}</span>}
        </div>
      </article>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { JSON_HEADERS } from "@/lib/ai-errors";
import type { PaperMeta } from "@/lib/pdf/add-paper";

type Result = { input: string; paper: PaperMeta | null };

export function AddPaperDialog({
  onClose,
  onAdd,
  onUpload,
  onMoreSources,
}: {
  onClose: () => void;
  onAdd: (papers: PaperMeta[]) => void;
  onUpload: (files: File[]) => void;
  onMoreSources?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [mode, setMode] = useState<"single" | "batch" | "search">("single");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function find() {
    if (query.trim().length < 2) return;
    setPending(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/paper/resolve", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ query }) });
      const json = (await res.json()) as { mode?: "single" | "batch" | "search"; results?: Result[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Lookup failed.");
      const list = json.results ?? [];
      setMode(json.mode ?? "single");
      setResults(list);
      // Exact identifiers are pre-selected; search results are picked by hand.
      setPicked(new Set(json.mode === "search" ? [] : list.flatMap((r, i) => (r.paper ? [i] : []))));
      if (!list.some((r) => r.paper)) setError("Nothing found. Check the ID, or try the title.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setPending(false);
    }
  }

  const chosen = (results ?? []).filter((r, i) => r.paper && picked.has(i)).map((r) => r.paper!);

  return (
    <div className="animate-fade fixed inset-0 z-60 flex items-center justify-center bg-ink/40 p-3 backdrop-blur-[2px] sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="add-paper-title" className="animate-pop flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard">
        <div className="flex items-start justify-between gap-4 border-b border-ink px-6 pt-5 pb-4">
          <div>
            <p className={eyebrowClass}>Add papers</p>
            <h2 id="add-paper-title" className="mt-1 font-serif text-2xl">No PDF needed</h2>
            <p className="mt-1 text-sm text-muted">Paste an arXiv ID or link, a DOI, a PDF link, or a title. Several? One per line.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-paper">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void find();
            }}
            className="space-y-3"
          >
            <textarea
              autoFocus
              rows={3}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void find();
                }
              }}
              placeholder={"2402.03300\nhttps://arxiv.org/abs/1707.06347\n10.1038/nature14236\nLet's Verify Step by Step"}
              className={`${inputClass} resize-y font-mono text-[13px] leading-relaxed`}
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted">Open-access PDFs are fetched and indexed; otherwise the abstract is kept.</span>
              <button className={`${buttonClass} py-1.5`} disabled={pending || query.trim().length < 2}>
                {pending ? "Looking up…" : "Find"}
              </button>
            </div>
          </form>

          {error && <p className="animate-pop mt-4 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}

          {results && results.length > 0 && (
            <ul className="mt-5 space-y-2">
              {mode === "search" && <p className={`${eyebrowClass} mb-1`}>Search results: pick the ones you want</p>}
              {results.map((r, i) =>
                r.paper ? (
                  <li key={i} className="animate-enter" style={{ animationDelay: `${i * 40}ms` }}>
                    <label
                      className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition duration-200 ${picked.has(i) ? "border-ink shadow-hard-sm" : "border-line hover:border-ink/40"}`}
                    >
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
                      <span className="min-w-0 flex-1">
                        <span className="block font-serif text-[1.02rem] leading-snug">{r.paper.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {[r.paper.authors.slice(0, 4).join(", ") + (r.paper.authors.length > 4 ? " et al." : ""), r.paper.venue, r.paper.year]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5 font-mono text-[10px]">
                          {r.paper.arxiv_id && <Tag>arXiv {r.paper.arxiv_id}</Tag>}
                          {!r.paper.arxiv_id && r.paper.doi && <Tag>DOI {r.paper.doi}</Tag>}
                          {r.paper.pdf_url ? <Tag dark>PDF available</Tag> : <Tag dashed>Abstract only</Tag>}
                          {r.paper.cited_by ? <Tag>{r.paper.cited_by.toLocaleString()} citations</Tag> : null}
                        </span>
                      </span>
                    </label>
                  </li>
                ) : (
                  <li key={i} className="rounded-lg border border-dashed border-danger/40 px-3 py-2 text-sm text-danger">
                    Not found: <span className="font-mono">{r.input}</span>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ink px-6 py-4">
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) {
                onUpload(files);
                onClose();
              }
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => fileInput.current?.click()} className={`${ghostButtonClass} py-1.5 text-xs`}>
              Upload PDFs instead
            </button>
            {onMoreSources && (
              <button type="button" onClick={onMoreSources} className={`${ghostButtonClass} py-1.5 text-xs`}>
                Zotero, web, YouTube…
              </button>
            )}
          </div>
          <button
            disabled={!chosen.length}
            onClick={() => {
              onAdd(chosen);
              onClose();
            }}
            className={`${buttonClass} py-1.5`}
          >
            {chosen.length ? `Add ${chosen.length} paper${chosen.length > 1 ? "s" : ""}` : "Add papers"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tag({ children, dark, dashed }: { children: React.ReactNode; dark?: boolean; dashed?: boolean }) {
  return (
    <span className={`rounded border px-1.5 py-px ${dark ? "border-ink bg-ink text-white" : dashed ? "border-dashed border-ink/50" : "border-ink/30 text-muted"}`}>
      {children}
    </span>
  );
}

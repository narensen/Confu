"use client";

import { eyebrowClass, ghostButtonClass } from "@/components/ui";
import type { GoalLink, Later } from "@/lib/goal-later";

export type ToAddProps = {
  later: Later;
  busy: boolean;
  onFind: (name?: string) => void; // the paper search, with these papers listed under it (and one looked up)
  onAddPapers: () => void;
  onAddMaterial: () => void;
  onRemovePaper: (name: string) => void;
  onImport: (links: GoalLink[]) => void;
  onRemoveLink: (url: string) => void;
};

// "To add": what the goal names that isn't in the session yet. Papers Confu
// found were added on their own; these are the ones it couldn't pin down, and
// links to bring in. Here until they're added or removed.
// A playlist can't be imported as one: its lectures are added one by one.
const isPlaylist = (url: string) => /youtube\.com\/playlist/i.test(url);

export function ToAddPanel({ later, busy, onFind, onRemovePaper, onImport, onRemoveLink, onAddPapers, onAddMaterial }: ToAddProps) {
  const { papers, links } = later;
  const importable = links.filter((l) => !isPlaylist(l.url));
  // Adding anything, any time: not only what the goal names.
  const addButtons = (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={onAddPapers} disabled={busy} className="rounded-md border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-white transition hover:-translate-y-px disabled:opacity-40">
        + Add papers
      </button>
      <button type="button" onClick={onAddMaterial} disabled={busy} className={`${ghostButtonClass} py-1.5 text-xs`}>
        + Add material
      </button>
    </div>
  );
  if (!papers.length && !links.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-serif text-xl">Nothing waiting</p>
        <p className="max-w-xs text-sm text-muted">
          Everything your goal names is in this session. Add more papers (by title, arXiv ID or DOI), PDFs, lectures or pages any time.
        </p>
        {addButtons}
      </div>
    );
  }
  return (
    <div className="h-full space-y-6 overflow-y-auto px-6 py-6">
      <header>
        <p className={eyebrowClass}>To add</p>
        <h2 className="mt-1 font-serif text-2xl leading-tight">From your goal, for when you&apos;re ready</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Papers Confu found were added already. These it couldn&apos;t pin down, or haven&apos;t been brought in yet.
        </p>
        <div className="mt-3">{addButtons}</div>
      </header>

      {papers.length > 0 && (
        <section>
          <div className="flex items-center justify-between gap-3">
            <p className={eyebrowClass}>
              Papers to find <span className="font-mono">{papers.length}</span>
            </p>
            <button type="button" onClick={() => onFind()} disabled={busy} className={`${ghostButtonClass} py-1 text-xs`}>
              Search for them
            </button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {papers.map((p) => (
              <li key={p.name} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{p.name}</span>
                  {(p.title || p.arxiv || p.doi) && (
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {[p.title && p.title !== p.name ? p.title : "", p.arxiv ? `arXiv ${p.arxiv}` : "", p.doi ? `DOI ${p.doi}` : ""].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => onFind(p.name)}
                  disabled={busy}
                  title="Look it up and add it"
                  className="shrink-0 rounded-md border border-ink px-2 py-0.5 text-xs font-medium transition hover:bg-ink hover:text-white disabled:opacity-40"
                >
                  Add
                </button>
                <button type="button" onClick={() => onRemovePaper(p.name)} aria-label={`Remove ${p.name}`} className="shrink-0 rounded px-1 text-muted hover:text-danger">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {links.length > 0 && (
        <section>
          <div className="flex items-center justify-between gap-3">
            <p className={eyebrowClass}>
              Lectures and pages <span className="font-mono">{links.length}</span>
            </p>
            {importable.length > 1 && (
              <button type="button" onClick={() => onImport(importable)} disabled={busy} className={`${ghostButtonClass} py-1 text-xs`}>
                Import all
              </button>
            )}
          </div>
          <ul className="mt-2 space-y-1.5">
            {links.map((l) => (
              <li key={l.url} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                <span className="min-w-0 flex-1">
                  <a href={l.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">
                    {l.url.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                  <span className="block text-xs text-muted">
                    {isPlaylist(l.url)
                      ? "YouTube playlist: open it and add the lectures you'll watch from + Add material → YouTube"
                      : l.kind === "youtube"
                        ? "Lecture: its transcript, with the video's timestamps"
                        : "Web page: its text, as a clean PDF"}
                  </span>
                </span>
                {isPlaylist(l.url) ? (
                  <a href={l.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-ink px-2 py-0.5 text-xs font-medium transition hover:bg-ink hover:text-white">
                    Open ↗
                  </a>
                ) : (
                  <button type="button" onClick={() => onImport([l])} disabled={busy} className="shrink-0 rounded-md border border-ink px-2 py-0.5 text-xs font-medium transition hover:bg-ink hover:text-white disabled:opacity-40">
                    Import
                  </button>
                )}
                <button type="button" onClick={() => onRemoveLink(l.url)} aria-label="Remove link" className="shrink-0 rounded px-1 text-muted hover:text-danger">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

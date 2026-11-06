"use client";

import { eyebrowClass, ghostButtonClass } from "@/components/ui";
import type { GoalLink, Later } from "@/lib/goal-later";

export type ToAddProps = {
  later: Later;
  busy: boolean;
  onFind: (name?: string) => void; // the paper search, with these papers listed under it (and one looked up)
  onRemovePaper: (name: string) => void;
  onImport: (links: GoalLink[]) => void;
  onPlaylist: (url: string) => void; // pick a playlist's lectures to import
  onRemoveLink: (url: string) => void;
};

const isPlaylist = (url: string) => /[?&]list=/.test(url) && /youtube\.com|youtu\.be/i.test(url) && !/[?&]v=/.test(url);

// In Files: what the goal names that isn't in the session yet. Papers Confu
// found were added on their own; these it couldn't pin down, plus links to
// bring in. Here until they're added or removed.
export function ToAddSection({ later, busy, onFind, onRemovePaper, onImport, onPlaylist, onRemoveLink }: ToAddProps) {
  const { papers, links } = later;
  const importable = links.filter((l) => !isPlaylist(l.url));
  if (!papers.length && !links.length) return null;
  return (
    <section className="rounded-xl border border-ink bg-yellow-50 p-4">
      <p className={eyebrowClass}>From your goal, not added yet</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">Papers Confu found were added already. These it couldn&apos;t pin down, or haven&apos;t been brought in yet.</p>

      {papers.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium">
              Papers to find <span className="font-mono text-muted">{papers.length}</span>
            </p>
            {papers.length > 1 && (
              <button type="button" onClick={() => onFind()} disabled={busy} className={`${ghostButtonClass} py-0.5 text-xs`}>
                Search for them
              </button>
            )}
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {papers.map((p) => (
              <li key={p.name} className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{p.name}</span>
                  {(p.title || p.authors || p.arxiv || p.doi) && (
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {[p.title && p.title !== p.name ? p.title : "", p.authors ?? "", p.arxiv ? `arXiv ${p.arxiv}` : "", p.doi ? `DOI ${p.doi}` : ""].filter(Boolean).join(" · ")}
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
        </div>
      )}

      {links.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium">
              Lectures and pages <span className="font-mono text-muted">{links.length}</span>
            </p>
            {importable.length > 1 && (
              <button type="button" onClick={() => onImport(importable)} disabled={busy} className={`${ghostButtonClass} py-0.5 text-xs`}>
                Import all
              </button>
            )}
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {links.map((l) => {
              const playlist = isPlaylist(l.url);
              return (
                <li key={l.url} className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <a href={l.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">
                      {l.url.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                    <span className="block text-xs text-muted">
                      {playlist
                        ? "YouTube playlist: pick the lectures you'll watch"
                        : l.kind === "youtube"
                          ? "Lecture: its transcript, with the video's timestamps"
                          : "Web page: its text, as a clean PDF"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => (playlist ? onPlaylist(l.url) : onImport([l]))}
                    disabled={busy}
                    className="shrink-0 rounded-md border border-ink px-2 py-0.5 text-xs font-medium transition hover:bg-ink hover:text-white disabled:opacity-40"
                  >
                    {playlist ? "Choose" : "Import"}
                  </button>
                  <button type="button" onClick={() => onRemoveLink(l.url)} aria-label="Remove link" className="shrink-0 rounded px-1 text-muted hover:text-danger">
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

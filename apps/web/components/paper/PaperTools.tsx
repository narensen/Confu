"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/dialogs";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { Markdown } from "@confu/ui/Markdown";
import { JSON_HEADERS, notifyAiUsed, readAiError } from "@/lib/ai-errors";
import { bibKeys, toBibtex, type BibPaper } from "@/lib/bibtex";
import { connectZotero, sendNotesToZotero, type ZoteroAccount } from "@/lib/import/zotero";
import { PASSES, passNotes, type PaperReview } from "@confu/core/paper";
import { track } from "@/lib/telemetry";
import type { SessionDoc } from "@confu/core/types";
import type { PaperTool } from "./PassesPanel";

// The paper tools behind the Papers panel's buttons: BibTeX export, sending
// pass notes to Zotero, a related-work draft and a side-by-side comparison.

const bibOf = (d: SessionDoc): BibPaper => ({
  title: d.title,
  authors: d.meta.authors ?? [],
  year: d.meta.year ?? null,
  venue: d.meta.venue ?? null,
  doi: d.meta.doi ?? null,
  arxiv_id: d.meta.arxiv_id ?? null,
  url: d.sourceUrl,
});

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportBibtex(papers: SessionDoc[], title: string) {
  if (!papers.length) return toast("Add a paper first.");
  download(`${title.replace(/[^\w-]+/g, "-").slice(0, 60) || "confu"}.bib`, toBibtex(papers.map(bibOf)) + "\n", "application/x-bibtex");
  track("paper.bibtex", { count: papers.length });
  toast(`Downloaded ${papers.length} ${papers.length === 1 ? "reference" : "references"} as BibTeX.`);
}

const hasNotes = (r: PaperReview | undefined) => Boolean(r && (r.triage_reason || PASSES.some((p) => Object.values(passNotes(r, p.n)).some((v) => v && v !== "1" && v.trim()))));

function notesHtml(r: PaperReview) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts: string[] = [`<p><b>Read with Confu</b>: ${r.passes_done} of ${r.target_pass} passes done.${r.triage_reason ? ` ${esc(r.triage_reason)}` : ""}</p>`];
  for (const p of PASSES) {
    const notes = passNotes(r, p.n);
    const filled = p.fields.filter((f) => notes[f.key]?.trim());
    if (!filled.length) continue;
    parts.push(`<h2>Pass ${p.n}: ${esc(p.name)}</h2>`);
    for (const f of filled) parts.push(`<p><b>${esc(f.label)}</b><br>${esc(notes[f.key].trim()).replace(/\n/g, "<br>")}</p>`);
  }
  return parts.join("\n");
}

export function PaperTools({
  tool,
  sessionId,
  papers,
  reviews,
  goal,
  onClose,
}: {
  tool: Exclude<PaperTool, "bibtex">;
  sessionId: string;
  papers: SessionDoc[];
  reviews: Record<string, PaperReview>;
  goal: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const titles: Record<typeof tool, string> = { zotero: "Send notes to Zotero", related: "Draft related work", compare: "Compare papers" };
  return createPortal(
    <div className="animate-fade fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-3 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="tool-title" className={`animate-pop flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard ${tool === "compare" ? "max-w-6xl" : "max-w-2xl"}`}>
        <div className="flex items-start justify-between gap-4 border-b border-ink px-6 py-4">
          <div>
            <p className={eyebrowClass}>Papers</p>
            <h2 id="tool-title" className="mt-0.5 font-serif text-2xl">
              {titles[tool]}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-paper">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {tool === "zotero" && <ZoteroSend papers={papers} reviews={reviews} />}
          {tool === "related" && <RelatedWork sessionId={sessionId} papers={papers} reviews={reviews} goal={goal} />}
          {tool === "compare" && <Compare sessionId={sessionId} papers={papers} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PaperPicker({ papers, picked, setPicked, max, note }: { papers: SessionDoc[]; picked: Set<string>; setPicked: (s: Set<string>) => void; max: number; note?: (d: SessionDoc) => string | null }) {
  return (
    <ul className="space-y-1">
      {papers.map((d) => (
        <li key={d.id}>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-paper">
            <input
              type="checkbox"
              checked={picked.has(d.id)}
              onChange={() => {
                const next = new Set(picked);
                if (next.has(d.id)) next.delete(d.id);
                else if (next.size < max) next.add(d.id);
                setPicked(next);
              }}
              className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
            />
            <span className="min-w-0">
              <span className="block leading-snug">
                <span className="mr-1.5 font-mono text-[10px] text-muted">{d.label}</span>
                {d.title}
              </span>
              {note?.(d) && <span className="block text-xs text-muted">{note(d)}</span>}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

const ZOTERO_KEY = "confu:zotero-key";

function ZoteroSend({ papers, reviews }: { papers: SessionDoc[]; reviews: Record<string, PaperReview> }) {
  const withNotes = papers.filter((d) => hasNotes(reviews[d.id]));
  const [key, setKey] = useState(() => {
    try {
      return localStorage.getItem(ZOTERO_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [picked, setPicked] = useState(() => new Set(withNotes.map((d) => d.id)));
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: string[]; failed: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    setResult(null);
    setStatus("Connecting to Zotero…");
    try {
      const acc: ZoteroAccount = await connectZotero(key);
      try {
        localStorage.setItem(ZOTERO_KEY, key.trim());
      } catch {}
      const list = withNotes
        .filter((d) => picked.has(d.id))
        .map((d) => ({
          paper: { title: d.title, authors: d.meta.authors ?? [], year: d.meta.year ?? null, venue: d.meta.venue ?? null, abstract: d.meta.abstract ?? null, doi: d.meta.doi ?? null, arxiv_id: d.meta.arxiv_id ?? null, url: d.sourceUrl ?? "", pdf_url: null },
          html: notesHtml(reviews[d.id]),
        }));
      const r = await sendNotesToZotero(acc, list, setStatus);
      setResult(r);
      track("paper.zotero_send", { sent: r.sent.length, failed: r.failed.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach Zotero.");
    } finally {
      setStatus(null);
    }
  }

  if (!withNotes.length) return <p className="text-sm text-muted">No pass notes yet. Write some in a paper&apos;s passes, then send them here.</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        Each paper&apos;s pass notes go to its item in your Zotero library (found by title, or created) as a note tagged “Confu”. Sending again adds a new note.
        Your key goes straight from your browser to Zotero.
      </p>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Zotero API key, with write access</span>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="24 letters and numbers" className={`${inputClass} font-mono`} autoComplete="off" />
        <span className="mt-1 block text-xs text-muted">
          Make one at{" "}
          <a href="https://www.zotero.org/settings/keys/new" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            zotero.org/settings/keys
          </a>{" "}
          and tick “Allow library access” and “Allow write access”.
        </span>
      </label>
      <PaperPicker papers={withNotes} picked={picked} setPicked={setPicked} max={50} />
      {error && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      {result && (
        <p className="rounded-lg border border-ink bg-yellow-50 px-3 py-2 text-sm whitespace-pre-line">
          {result.sent.length ? `Sent notes for ${result.sent.length} ${result.sent.length === 1 ? "paper" : "papers"}.` : ""}
          {result.failed.length ? `\nCouldn't send:\n${result.failed.join("\n")}` : ""}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="button" onClick={send} disabled={Boolean(status) || key.trim().length < 20 || !picked.size} className={`${buttonClass} py-1.5`}>
          {status ? "Sending…" : `Send ${picked.size} to Zotero`}
        </button>
        {status && <span className="truncate text-xs text-muted">{status}</span>}
      </div>
    </div>
  );
}

function RelatedWork({ sessionId, papers, reviews, goal }: { sessionId: string; papers: SessionDoc[]; reviews: Record<string, PaperReview>; goal: string }) {
  const [picked, setPicked] = useState(() => new Set(papers.slice(0, 15).map((d) => d.id)));
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = papers.filter((d) => picked.has(d.id));
  const keys = bibKeys(chosen.map(bibOf));

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/paper/related-work", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ sessionId, docIds: chosen.map((d) => d.id), keys, goal }) });
      if (!res.ok) throw new Error(await readAiError(res));
      const j = (await res.json()) as { markdown: string };
      setDraft(j.markdown);
      track("paper.related_work", { papers: chosen.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't draft it.");
    } finally {
      setPending(false);
      notifyAiUsed();
    }
  }

  // [@a][@b] → \cite{a,b}
  const latex = (md: string) =>
    md
      .replace(/(?:\[@[^\]]+\]\s*)+/g, (m) => `\\cite{${[...m.matchAll(/\[@([^\]]+)\]/g)].map((x) => x[1]).join(",")}} `)
      .replace(/\*\*(.+?)\*\*/g, "\\textbf{$1}")
      .replace(/\*(.+?)\*/g, "\\emph{$1}")
      .replace(/ +([.,;])/g, "$1");

  if (draft !== null) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-line bg-paper px-3 py-2 text-xs leading-relaxed text-muted">
          A starting point built from your notes and the abstracts. Check every claim against the papers, and rewrite it in your own voice.
        </p>
        <div className="rounded-xl border border-ink bg-panel p-5 text-sm leading-relaxed">
          <Markdown content={draft} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigator.clipboard.writeText(draft).then(() => toast("Copied as Markdown."))} className={`${buttonClass} py-1.5 text-xs`}>
            Copy Markdown
          </button>
          <button type="button" onClick={() => navigator.clipboard.writeText(latex(draft)).then(() => toast("Copied as LaTeX, citing with \\cite."))} className={`${ghostButtonClass} py-1.5 text-xs`}>
            Copy LaTeX
          </button>
          <button type="button" onClick={() => download("references.bib", toBibtex(chosen.map(bibOf)) + "\n", "application/x-bibtex")} className={`${ghostButtonClass} py-1.5 text-xs`}>
            Download .bib
          </button>
          <button type="button" onClick={() => setDraft(null)} className="px-2 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
            Start again
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        Confu groups the papers by theme and links them to your goal, citing them by their BibTeX keys. It works from your pass notes where you have them, so
        it&apos;s better after you&apos;ve read.
      </p>
      <PaperPicker papers={papers} picked={picked} setPicked={setPicked} max={15} note={(d) => (hasNotes(reviews[d.id]) ? "Has your notes" : "Abstract only")} />
      {error && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="button" onClick={run} disabled={pending || chosen.length < 2} className={`${buttonClass} py-1.5`}>
        {pending ? "Drafting…" : chosen.length < 2 ? "Pick at least two papers" : `Draft from ${chosen.length} papers`}
      </button>
    </div>
  );
}

type Row = { id: string; title: string; year: number | null; cells: Record<string, string> };
const FIELDS = [
  ["problem", "Problem"],
  ["approach", "Approach"],
  ["data", "Data and setup"],
  ["results", "Key results"],
  ["limitations", "Limitations"],
] as const;

function Compare({ sessionId, papers }: { sessionId: string; papers: SessionDoc[] }) {
  const [picked, setPicked] = useState(() => new Set(papers.slice(0, 6).map((d) => d.id)));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/paper/compare", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ sessionId, docIds: [...picked] }) });
      if (!res.ok) throw new Error(await readAiError(res));
      setRows(((await res.json()) as { rows: Row[] }).rows);
      track("paper.compare", { papers: picked.size });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't compare them.");
    } finally {
      setPending(false);
      notifyAiUsed();
    }
  }

  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const markdown = (r: Row[]) =>
    [`| Paper | ${FIELDS.map((f) => f[1]).join(" | ")} |`, `|${"---|".repeat(FIELDS.length + 1)}`, ...r.map((x) => `| ${cell(x.title)}${x.year ? ` (${x.year})` : ""} | ${FIELDS.map((f) => cell(x.cells[f[0]])).join(" | ")} |`)].join("\n");
  const csv = (r: Row[]) => {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return [["Paper", "Year", ...FIELDS.map((f) => f[1])].map(q).join(","), ...r.map((x) => [x.title, String(x.year ?? ""), ...FIELDS.map((f) => x.cells[f[0]])].map(q).join(","))].join("\n");
  };

  if (rows) {
    return (
      <div className="space-y-4">
        <div className="overflow-x-auto rounded-xl border border-ink">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b border-ink bg-paper text-left font-mono text-[10px] tracking-wider text-muted uppercase">
                <th className="w-48 px-3 py-2.5 font-medium">Paper</th>
                {FIELDS.map((f) => (
                  <th key={f[0]} className="px-3 py-2.5 font-medium">
                    {f[1]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-3 font-medium leading-snug">
                    {r.title}
                    {r.year && <span className="block font-mono text-[11px] font-normal text-muted">{r.year}</span>}
                  </td>
                  {FIELDS.map((f) => (
                    <td key={f[0]} className={`px-3 py-3 leading-relaxed ${r.cells[f[0]] === "Not stated" ? "text-muted" : ""}`}>
                      {r.cells[f[0]]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">From the abstracts, opening pages and your notes. Check the details against the papers.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigator.clipboard.writeText(markdown(rows)).then(() => toast("Copied as a Markdown table."))} className={`${buttonClass} py-1.5 text-xs`}>
            Copy as Markdown
          </button>
          <button type="button" onClick={() => download("paper-comparison.csv", csv(rows), "text/csv")} className={`${ghostButtonClass} py-1.5 text-xs`}>
            Download CSV
          </button>
          <button type="button" onClick={() => setRows(null)} className="px-2 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
            Compare others
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Pick two to eight papers. Confu lines up their problem, approach, data, results and limitations.</p>
      <PaperPicker papers={papers} picked={picked} setPicked={setPicked} max={8} />
      {error && <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="button" onClick={run} disabled={pending || picked.size < 2} className={`${buttonClass} py-1.5`}>
        {pending ? "Comparing…" : `Compare ${picked.size}`}
      </button>
    </div>
  );
}

"use client";

import { useRef } from "react";
import { eyebrowClass, ghostButtonClass } from "@/components/ui";
import type { SessionDoc } from "@/lib/types";

// Shown in place of the PDF viewer for papers added without a PDF.
export function PaperCard({ doc, busy, onAttach }: { doc: SessionDoc; busy: boolean; onAttach: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const m = doc.meta;
  const links = [
    m.arxiv_id && { label: `arXiv ${m.arxiv_id}`, href: `https://arxiv.org/abs/${m.arxiv_id}` },
    m.doi && { label: `DOI ${m.doi}`, href: `https://doi.org/${m.doi}` },
    !m.arxiv_id && !m.doi && doc.sourceUrl && { label: "Source", href: doc.sourceUrl },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <div className="h-full overflow-y-auto bg-viewer px-6 py-8">
      <article className="animate-enter mx-auto max-w-2xl rounded-xl border border-ink bg-panel p-8 shadow-hard">
        <p className={eyebrowClass}>
          {doc.label} · {[m.venue, m.year].filter(Boolean).join(" · ") || "Paper"}
        </p>
        <h1 className="mt-2 font-serif text-3xl leading-tight tracking-tight">{doc.title}</h1>
        {m.authors?.length ? <p className="mt-3 text-sm leading-relaxed text-muted">{m.authors.join(", ")}</p> : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {links.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="rounded border border-ink/40 px-2 py-0.5 font-mono text-xs transition hover:border-ink hover:bg-paper">
              {l.label} ↗
            </a>
          ))}
        </div>

        <h2 className="mt-8 font-serif text-xl">Abstract</h2>
        <p className="mt-2 text-[0.95rem] leading-relaxed">{m.abstract || "No abstract is available for this paper."}</p>

        <div className="mt-8 rounded-lg border border-dashed border-ink/40 bg-paper p-4 text-sm">
          <p className="font-medium">No PDF stored for this paper</p>
          <p className="mt-1 leading-relaxed text-muted">
            It was added from its metadata, which is enough for a first pass, and the tutor can still look it up. For a second
            or third pass, attach the PDF (for example, one you downloaded through your library).
          </p>
          <input
            ref={input}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onAttach(file);
            }}
          />
          <button onClick={() => input.current?.click()} disabled={busy} className={`${ghostButtonClass} mt-3 py-1.5 text-xs`}>
            Attach PDF
          </button>
        </div>
      </article>
    </div>
  );
}

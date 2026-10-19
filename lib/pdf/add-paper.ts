"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { JSON_HEADERS } from "@/lib/ai-errors";
import { uploadPdfToSession } from "@/lib/pdf/upload";
import type { PaperMeta } from "@/lib/scholar";

export type { PaperMeta };

export const metaFor = (p: PaperMeta) => ({
  authors: p.authors,
  year: p.year,
  venue: p.venue,
  doi: p.doi,
  arxiv_id: p.arxiv_id,
  abstract: p.abstract,
  pdf_url: p.pdf_url,
});

// Add a paper found by arXiv ID / DOI / title. Fetches and indexes the
// open-access PDF when there is one; otherwise keeps the paper as metadata +
// abstract, which is enough for a first pass and for the tutor's tools.
export async function addPaperFromMeta(
  supabase: SupabaseClient,
  opts: { userId: string; sessionId: string; position: number; paper: PaperMeta; onStatus: (s: string) => void },
): Promise<{ id: string; hasPdf: boolean; note?: string }> {
  const { userId, sessionId, position, paper, onStatus } = opts;
  const short = paper.title.length > 40 ? `${paper.title.slice(0, 38)}…` : paper.title;

  let note: string | undefined;
  if (paper.pdf_url) {
    onStatus(`Fetching PDF: ${short}`);
    try {
      const res = await fetch("/api/paper/pdf", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ url: paper.pdf_url }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't fetch the PDF.");
      const blob = await res.blob();
      const name = `${(paper.arxiv_id ?? paper.title).replace(/[^\w.-]+/g, "_").slice(0, 60)}.pdf`;
      const file = new File([blob], name, { type: "application/pdf" });
      const { id } = await uploadPdfToSession(supabase, {
        userId,
        sessionId,
        file,
        position,
        onStatus,
        title: paper.title,
        meta: metaFor(paper),
        sourceUrl: paper.url,
      });
      return { id, hasPdf: true };
    } catch (err) {
      note = err instanceof Error ? err.message : "Couldn't fetch the PDF.";
    }
  }

  // No open-access PDF: keep the metadata and abstract.
  onStatus(`Adding ${short}`);
  const id = crypto.randomUUID();
  const doc = await supabase.from("documents").insert({
    id,
    session_id: sessionId,
    position,
    title: paper.title.slice(0, 300),
    storage_path: null,
    page_count: 1,
    outline: [],
    status: "ready",
    source_url: paper.url,
    meta: metaFor(paper),
  });
  if (doc.error) throw doc.error;
  const byline = [paper.authors.slice(0, 8).join(", "), [paper.venue, paper.year].filter(Boolean).join(" ")].filter(Boolean).join("\n");
  const page = await supabase.from("document_pages").insert({
    document_id: id,
    page_number: 1,
    content: `${paper.title}\n${byline}\n\nAbstract\n${paper.abstract ?? "(No abstract available.)"}`,
  });
  if (page.error) throw page.error;
  return { id, hasPdf: false, note: note ?? (paper.pdf_url ? undefined : "No open-access PDF found; added the abstract.") };
}

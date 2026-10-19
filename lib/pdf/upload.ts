"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_BYTES = 50 * 1024 * 1024;
const BATCH = 50;

export function validatePdf(file: File): string | null {
  if (file.type !== "application/pdf") return `“${file.name}” isn't a PDF.`;
  if (file.size > MAX_BYTES) return `“${file.name}” is over 50 MB.`;
  return null;
}

export function titleFromFile(file: File) {
  return file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled";
}

// Extract text in the browser, upload the file, and index its pages into a
// session. Returns the new document id.
export async function uploadPdfToSession(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    sessionId: string;
    file: File;
    position: number;
    onStatus: (s: string) => void;
    // When the PDF came from an arXiv ID / DOI lookup.
    title?: string;
    meta?: Record<string, unknown>;
    sourceUrl?: string | null;
  },
): Promise<{ id: string; lowText: boolean }> {
  const { userId, sessionId, file, position, onStatus } = opts;
  const invalid = validatePdf(file);
  if (invalid) throw new Error(invalid);

  const id = crypto.randomUUID();
  const short = file.name.length > 28 ? `${file.name.slice(0, 26)}…` : file.name;
  try {
    onStatus(`Reading ${short}…`);
    const { extractPdf } = await import("@/lib/pdf/extract");
    const { pageCount, pages, outline } = await extractPdf(file, (done, total) => onStatus(`Reading ${short}: page ${done}/${total}`));

    onStatus(`Uploading ${short}…`);
    const path = `${userId}/${id}.pdf`;
    const up = await supabase.storage.from("documents").upload(path, file, { contentType: "application/pdf" });
    if (up.error) throw up.error;

    const doc = await supabase.from("documents").insert({
      id,
      session_id: sessionId,
      position,
      title: opts.title?.slice(0, 300) || titleFromFile(file),
      meta: opts.meta ?? {},
      source_url: opts.sourceUrl ?? null,
      storage_path: path,
      page_count: pageCount,
      outline,
      status: "processing",
    });
    if (doc.error) throw doc.error;

    for (let i = 0; i < pages.length; i += BATCH) {
      onStatus(`Indexing ${short}: pages ${i + 1}–${Math.min(i + BATCH, pages.length)}`);
      const rows = pages.slice(i, i + BATCH).map((content, j) => ({ document_id: id, page_number: i + j + 1, content }));
      const res = await supabase.from("document_pages").insert(rows);
      if (res.error) throw res.error;
    }
    await supabase.from("documents").update({ status: "ready" }).eq("id", id);

    const textChars = pages.reduce((n, p) => n + p.length, 0);
    return { id, lowText: textChars < pageCount * 40 };
  } catch (err) {
    await supabase.from("documents").update({ status: "failed" }).eq("id", id);
    throw err;
  }
}

// Attach a PDF to a paper that was added without one (e.g. a paywalled DOI the
// reader downloaded themselves). Keeps the paper's id, so pass notes,
// highlights and plan links stay attached.
export async function attachPdfToDocument(
  supabase: SupabaseClient,
  opts: { userId: string; documentId: string; file: File; onStatus: (s: string) => void },
) {
  const { userId, documentId, file, onStatus } = opts;
  const invalid = validatePdf(file);
  if (invalid) throw new Error(invalid);

  onStatus("Reading PDF…");
  const { extractPdf } = await import("@/lib/pdf/extract");
  const { pageCount, pages, outline } = await extractPdf(file, (done, total) => onStatus(`Reading page ${done}/${total}`));

  onStatus("Uploading…");
  const path = `${userId}/${documentId}.pdf`;
  const up = await supabase.storage.from("documents").upload(path, file, { contentType: "application/pdf", upsert: true });
  if (up.error) throw up.error;

  const del = await supabase.from("document_pages").delete().eq("document_id", documentId);
  if (del.error) throw del.error;
  for (let i = 0; i < pages.length; i += BATCH) {
    onStatus(`Indexing pages ${i + 1}–${Math.min(i + BATCH, pages.length)}`);
    const rows = pages.slice(i, i + BATCH).map((content, j) => ({ document_id: documentId, page_number: i + j + 1, content }));
    const res = await supabase.from("document_pages").insert(rows);
    if (res.error) throw res.error;
  }
  const upd = await supabase
    .from("documents")
    .update({ storage_path: path, page_count: pageCount, outline, status: "ready", last_page: 1 })
    .eq("id", documentId);
  if (upd.error) throw upd.error;
}

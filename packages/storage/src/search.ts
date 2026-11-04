import type { Store } from "./store";

// Page search for the tutor, on the device. It matches the server's
// (search_session_pages in supabase/schema.sql): any of the question's words,
// best pages first, at most 12.

const STOPWORDS = new Set(
  "a an and are as at be but by can could did do does for from had has have how i if in into is it its me my no not of on or our so than that the their them then there these they this to was we were what when where which who why will with would you your about also any just more most other some such only very".split(
    " ",
  ),
);

// An FTS5 query from free text: each word quoted (so nothing in a question
// is read as query syntax), joined with OR. Null when no word is left.
export function ftsQuery(text: string): string | null {
  const words = [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOPWORDS.has(w)))].slice(0, 32);
  return words.length ? words.map((w) => `"${w}"`).join(" OR ") : null;
}

export type PageHit = { document_id: string; page_number: number; content: string; rank: number };

const clampLimit = (n: number) => Math.max(1, Math.min(Math.floor(n) || 1, 12));

export async function searchSessionPages(store: Store, sessionId: string, text: string, limit = 5): Promise<PageHit[]> {
  const q = ftsQuery(text);
  if (!q) return [];
  return store.query<PageHit>(
    `SELECT p.document_id, p.page_number, p.content, -bm25(page_fts) AS rank
     FROM page_fts JOIN document_pages p ON p.rowid = page_fts.rowid
     JOIN documents d ON d.id = p.document_id
     WHERE page_fts MATCH ? AND d.session_id = ?
     ORDER BY bm25(page_fts) LIMIT ?`,
    [q, sessionId, clampLimit(limit)],
  );
}

export async function searchPages(store: Store, documentId: string, text: string, limit = 5): Promise<PageHit[]> {
  const q = ftsQuery(text);
  if (!q) return [];
  return store.query<PageHit>(
    `SELECT p.document_id, p.page_number, p.content, -bm25(page_fts) AS rank
     FROM page_fts JOIN document_pages p ON p.rowid = page_fts.rowid
     WHERE page_fts MATCH ? AND p.document_id = ?
     ORDER BY bm25(page_fts) LIMIT ?`,
    [q, documentId, clampLimit(limit)],
  );
}

// The start of every page of a document, whitespace collapsed (for plans).
export async function pageSnippets(store: Store, documentId: string, chars = 160): Promise<{ page_number: number; snippet: string }[]> {
  const n = Math.max(20, Math.min(chars, 600));
  const rows = await store.query<{ page_number: number; content: string }>(`SELECT page_number, content FROM document_pages WHERE document_id = ? ORDER BY page_number`, [documentId]);
  return rows.map((r) => ({ page_number: r.page_number, snippet: r.content.replace(/\s+/g, " ").slice(0, n) }));
}

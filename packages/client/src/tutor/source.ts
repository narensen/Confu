import type { FigureRow, PageHit, PageSource } from "@confu/core/tutor/retrieve";
import { searchPages, searchSessionPages } from "@confu/storage/search";
import type { Store } from "@confu/storage/store";

// The tutor's pages, from the on-device database.
export function storePageSource(store: Store): PageSource {
  const pageRows = (sql: string, params: (string | number)[]) => store.query<PageHit>(sql, params);
  return {
    async pages(docId, pages) {
      if (!pages.length) return [];
      return pageRows(`SELECT document_id, page_number, content FROM document_pages WHERE document_id = ? AND page_number IN (${pages.map(() => "?").join(", ")})`, [
        docId,
        ...pages,
      ]);
    },
    searchDoc: (docId, query, limit) => searchPages(store, docId, query, limit),
    searchSession: (sessionId, query, limit) => searchSessionPages(store, sessionId, query, limit),
    after: (docId, page, limit) =>
      pageRows(`SELECT document_id, page_number, content FROM document_pages WHERE document_id = ? AND page_number > ? ORDER BY page_number LIMIT ?`, [docId, page, limit]),
    before: (docId, page, limit) =>
      pageRows(`SELECT document_id, page_number, content FROM document_pages WHERE document_id = ? AND page_number < ? ORDER BY page_number DESC LIMIT ?`, [docId, page, limit]),
    async figures(docIds, limit) {
      if (!docIds.length) return [];
      return store.query<FigureRow>(
        `SELECT id, document_id, page_number, vlm_description FROM highlights
         WHERE kind = 'region' AND vlm_description IS NOT NULL AND document_id IN (${docIds.map(() => "?").join(", ")})
         ORDER BY created_at DESC LIMIT ?`,
        [...docIds, limit],
      );
    },
  };
}

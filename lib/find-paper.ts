"use client";

import type { Resource } from "@/lib/types";

// Open the session's paper search (OpenAlex / Semantic Scholar) on a query,
// from anywhere: the plan, "Start here". The workspace listens.
export const FIND_PAPER_EVENT = "confu:find-paper";

export function findPaper(query: string) {
  window.dispatchEvent(new CustomEvent(FIND_PAPER_EVENT, { detail: { query } }));
}

// A plan resource that's a research paper: found in Confu's paper search, not
// on Google. Plans made before the "paper" type say "reading", so a reading
// that names a paper (arXiv, a DOI, "paper", "et al.") counts too.
export function isPaperResource(r: Resource) {
  return r.type === "paper" || (r.type === "reading" && /\barxiv\b|\bdoi\b|\b10\.\d{4,9}\/|\bpapers?\b|\bet al\b/i.test(`${r.title} ${r.search}`));
}

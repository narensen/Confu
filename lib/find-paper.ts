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

// Titles compared loosely: case, punctuation, "paper" and bracketed notes
// ("DeepSeekMath paper (GRPO)") don't count.
const squash = (t: string) =>
  t
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\bpapers?\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");

// The session file a plan resource refers to, if it's already there: same
// title (or one contains the other), or the arXiv id the resource names.
export function docForResource<D extends { title: string; meta?: { arxiv_id?: unknown } | null }>(r: Resource, docs: D[]): D | null {
  const wants = [r.title, r.search].map(squash).filter((w) => w.length >= 8);
  const arxiv = `${r.title} ${r.search}`.match(/\b(\d{4}\.\d{4,5})\b/)?.[1];
  return (
    docs.find((d) => {
      if (arxiv && d.meta?.arxiv_id === arxiv) return true;
      const t = squash(d.title);
      return t.length >= 8 && wants.some((w) => w === t || (w.length >= 15 && t.includes(w)) || (t.length >= 15 && w.includes(t)));
    }) ?? null
  );
}

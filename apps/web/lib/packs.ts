// Study packs (migration 0024): a session published as a page others can
// copy. Shared by the server (publishing, copying) and the browser (fetching
// a copied pack's sources). A pack never contains files: each source is a
// link or a paper identifier the copier's Confu fetches again, or, for files
// the author uploaded, a placeholder for the copier's own copy.

import type { Level, PlanPhase, Resource, SessionKind } from "@confu/core/types";

export type PackSourceKind = "paper" | "web" | "web_course" | "youtube" | "sample" | "file";

export type PackSource = {
  kind: PackSourceKind;
  title: string;
  url: string | null; // where it lives: a web page, a video, a paper's landing page
  pages?: number; // pages in the author's copy
  // Papers
  pdf_url?: string | null;
  doi?: string | null;
  arxiv_id?: string | null;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  abstract?: string | null;
};

export type PackTopic = {
  phase: number;
  title: string;
  objectives: string[];
  key_concepts: string[];
  resources: Resource[];
  source: "pdf" | "external";
  doc: number | null; // index into sources
  page_start: number | null;
  page_end: number | null;
  est_minutes: number;
  day: number; // due this many days after the start
};

export type PackPlan = {
  goal: string;
  goal_title: string;
  goal_summary: string;
  materials: string;
  phases: PlanPhase[];
  level: Level;
  days: number; // from start to deadline
  minutes_per_day: number;
  overview: string;
};

export type PackHighlight = { doc: number; page: number; text: string | null; note: string | null; color: string; rects: unknown };

export type PackContent = {
  v: 1;
  sources: PackSource[];
  plan: PackPlan | null;
  topics: PackTopic[];
  highlights: PackHighlight[];
  passes: { doc: number; target: 1 | 2 | 3 }[]; // papers: how deep the author read each
  goal?: string; // templates: the goal to start from (no plan yet)
  roadmap?: boolean; // this pack is a session shared as a path others can follow
};

export type Pack = {
  id: string;
  slug: string;
  kind: SessionKind;
  title: string;
  description: string;
  author_name: string | null;
  visibility: "public" | "unlisted";
  class_mode: boolean;
  content: PackContent;
  views: number;
  copies: number;
  published_at: string;
  updated_at: string;
  mine: boolean;
};

// What a document is, from the metadata its import left behind.
export function sourceOf(doc: { title: string; page_count: number; source_url: string | null; meta: Record<string, unknown> | null }): PackSource {
  const m = (doc.meta ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const base = { title: doc.title, url: doc.source_url, pages: doc.page_count || undefined };
  if (m.doi || m.arxiv_id || (m.pdf_url && m.source !== "web")) {
    return {
      ...base,
      kind: "paper",
      pdf_url: str(m.pdf_url) ?? (str(m.arxiv_id) ? `https://arxiv.org/pdf/${m.arxiv_id}` : null),
      doi: str(m.doi),
      arxiv_id: str(m.arxiv_id),
      authors: Array.isArray(m.authors) ? (m.authors as string[]).slice(0, 12) : [],
      year: typeof m.year === "number" ? m.year : null,
      venue: str(m.venue),
      abstract: str(m.abstract)?.slice(0, 3000) ?? null,
    };
  }
  switch (m.source) {
    case "web":
    case "web_course": // whole-course imports are retired: shared as their first page
      return doc.source_url ? { ...base, kind: "web" } : { ...base, kind: "file" };
    case "youtube":
      return doc.source_url ? { ...base, kind: "youtube" } : { ...base, kind: "file" };
    case "sample":
      return { ...base, kind: "sample" };
    default:
      return { ...base, kind: "file", url: null }; // uploads, Drive, pasted pages: the copier brings their own
  }
}

export const SOURCE_LABEL: Record<PackSourceKind, string> = {
  paper: "Paper",
  web: "Web page",
  web_course: "Course",
  youtube: "Lecture",
  sample: "Guide",
  file: "Your copy",
};

// Readable, unique-enough link: "learn-reinforcement-learning-k3x9m2".
export function packSlug(title: string) {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/, "") || "pack";
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${base}-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}

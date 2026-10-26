import "server-only";
import { norm, s2, sameTitle } from "@/lib/scholar";

// The literature around a set of papers: what they cite (above all, what
// several of them cite: their shared foundations), and newer work that cites
// several of them (the frontier). OpenAlex first (generous limits, citing
// works); Semantic Scholar for papers OpenAlex can't place. Every match is
// checked by title, since a DOI can point at a mis-merged record.

export type GraphNode = {
  key: string; // normalised title: how papers from either source are matched
  title: string;
  year: number | null;
  authors: string[];
  citations: number;
  doi: string | null;
  arxiv: string | null;
  url: string | null;
  kind: "session" | "foundation" | "frontier";
  docId?: string; // session papers
  oa?: string; // OpenAlex id, for its abstract
  citedByYours?: number; // foundations: how many of your papers cite it
  citesYours?: number; // frontier: how many of your papers it cites
};
export type GraphEdge = { from: string; to: string }; // from cites to
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[]; built: string; missing: string[] };

export type SessionPaper = { docId: string; title: string; doi: string | null; arxiv: string | null; openalex?: string | null; year?: number | null };

type OAWork = {
  id: string;
  display_name: string | null;
  publication_year: number | null;
  publication_date?: string | null;
  cited_by_count: number | null;
  doi: string | null;
  authorships?: { author: { display_name: string } }[];
  referenced_works?: string[];
  primary_location?: { landing_page_url?: string | null } | null;
  locations?: { landing_page_url?: string | null }[];
  counts_by_year?: { year: number; cited_by_count: number }[];
};

const FIELDS = "id,display_name,publication_year,publication_date,cited_by_count,doi,authorships,referenced_works,primary_location,locations,counts_by_year";
const shortId = (id: string) => id.replace(/^https?:\/\/openalex\.org\//, "");

function oaUrl(path: string, params: Record<string, string> = {}, select = FIELDS) {
  const u = new URL(`https://api.openalex.org/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("select", select);
  if (process.env.OPENALEX_MAILTO) u.searchParams.set("mailto", process.env.OPENALEX_MAILTO);
  if (process.env.OPENALEX_API_KEY) u.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
  return u.toString();
}

async function oa<T>(path: string, params: Record<string, string> = {}, select = FIELDS): Promise<T | null> {
  try {
    const res = await fetch(oaUrl(path, params, select), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// Run tasks a few at a time.
async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const arxivOf = (w: OAWork) => {
  const loc = w.locations?.find((l) => l.landing_page_url?.includes("arxiv.org"))?.landing_page_url;
  return loc?.match(/(\d{4}\.\d{4,5})/)?.[1] ?? null;
};

// OpenAlex sometimes re-dates a record (a 2015 paper filed under 2024) or
// merges two papers into one (an old paper's citations under a new title).
// A paper can't be published years after it was first cited: re-dated ones get
// the year citations began; merged ones (whose arXiv id is newer than their
// first citations) are left out. Returns the year to show, or false to drop.
function checkedYear(w: OAWork): number | null | false {
  const firstCited = Math.min(...(w.counts_by_year ?? []).filter((c) => c.cited_by_count > 0).map((c) => c.year));
  // A year or three of slack: preprints get cited before their official year.
  if (!Number.isFinite(firstCited) || !w.publication_year || w.publication_year <= firstCited + 3) return w.publication_year;
  const arxiv = arxivOf(w);
  if (arxiv && 2000 + Number(arxiv.slice(0, 2)) > firstCited + 3) return false;
  return firstCited;
}

function nodeFromOA(w: OAWork, kind: GraphNode["kind"]): GraphNode {
  const doi = w.doi?.replace(/^https?:\/\/doi\.org\//, "") ?? null;
  const arxiv = arxivOf(w);
  const year = checkedYear(w);
  return {
    key: norm(w.display_name ?? ""),
    title: w.display_name ?? "Untitled",
    year: year === false ? null : year,
    authors: (w.authorships ?? []).slice(0, 4).map((a) => a.author.display_name),
    citations: w.cited_by_count ?? 0,
    doi,
    arxiv,
    url: arxiv ? `https://arxiv.org/abs/${arxiv}` : doi ? `https://doi.org/${doi}` : (w.primary_location?.landing_page_url ?? null),
    kind,
    oa: shortId(w.id),
  };
}

// A paper's OpenAlex record, checked by title: by DOI, then arXiv's DOI, then title.
export async function resolveWork(p: { title: string; doi: string | null; arxiv: string | null; openalex?: string | null }): Promise<OAWork | null> {
  const ok = (w: OAWork | null) => (w?.display_name && sameTitle(w.display_name, p.title) ? w : null);
  if (p.openalex) {
    const w = ok(await oa<OAWork>(`works/${p.openalex}`));
    if (w) return w;
  }
  if (p.doi) {
    const w = ok(await oa<OAWork>(`works/doi:${p.doi}`));
    if (w) return w;
  }
  if (p.arxiv) {
    const w = ok(await oa<OAWork>(`works/doi:10.48550/arxiv.${p.arxiv}`));
    if (w) return w;
  }
  const words = norm(p.title).split(" ").filter((t) => t.length > 2).slice(0, 10).join(" ");
  if (!words) return null;
  const found = await oa<{ results: OAWork[] }>("works", { filter: `title.search:${words}`, sort: "cited_by_count:desc", per_page: "5" });
  return (found?.results ?? []).map(ok).find(Boolean) ?? null;
}

// OpenAlex details for many works, 50 at a time.
async function worksByIds(ids: string[]): Promise<OAWork[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const pages = await pool(chunks, 3, (c) => oa<{ results: OAWork[] }>("works", { filter: `openalex_id:${c.join("|")}`, per_page: "50" }));
  return pages.flatMap((p) => p?.results ?? []);
}

type S2Ref = { title: string | null; year: number | null; citationCount: number | null; externalIds?: { DOI?: string; ArXiv?: string } | null; authors?: { name: string }[] };

// For a paper OpenAlex can't place: its references from Semantic Scholar.
async function s2References(p: SessionPaper): Promise<{ year: number | null; citations: number; refs: GraphNode[] } | null> {
  const id = p.arxiv ? `arXiv:${p.arxiv}` : p.doi ? `DOI:${p.doi}` : null;
  if (!id) return null;
  const d = await s2<{ title: string | null; year: number | null; citationCount: number | null; references?: S2Ref[] }>(
    `paper/${encodeURIComponent(id)}?fields=title,year,citationCount,references.title,references.year,references.citationCount,references.externalIds,references.authors`,
  );
  if (!d?.title || !sameTitle(d.title, p.title)) return null;
  const refs = (d.references ?? [])
    .filter((r): r is S2Ref & { title: string } => Boolean(r.title))
    .map((r) => {
      const doi = r.externalIds?.DOI ?? null;
      const arxiv = r.externalIds?.ArXiv ?? null;
      return {
        key: norm(r.title),
        title: r.title,
        year: r.year,
        authors: (r.authors ?? []).slice(0, 4).map((a) => a.name),
        citations: r.citationCount ?? 0,
        doi,
        arxiv,
        url: arxiv ? `https://arxiv.org/abs/${arxiv}` : doi ? `https://doi.org/${doi}` : null,
        kind: "foundation" as const,
      };
    });
  return { year: d.year, citations: d.citationCount ?? 0, refs };
}

const MAX_FOUNDATIONS = 26;
const MAX_FRONTIER = 16;

export async function buildGraph(papers: SessionPaper[]): Promise<{ graph: Graph; resolved: Record<string, string> }> {
  const list = papers.slice(0, 15);
  const works = await pool(list, 4, (p) => resolveWork(p));
  const nodes = new Map<string, GraphNode>();
  const edges = new Set<string>();
  const missing: string[] = [];
  const resolved: Record<string, string> = {}; // docId → OpenAlex id, to remember
  const refsOf = new Map<string, string[]>(); // session key → reference keys
  const oaRefs = new Map<string, string[]>(); // session key → OpenAlex reference ids

  // Your papers.
  for (const [i, p] of list.entries()) {
    const w = works[i];
    if (w) {
      // Your own copy's year beats OpenAlex's (which can be a later re-issue).
      const n = { ...nodeFromOA(w, "session"), docId: p.docId, title: p.title, ...(p.year ? { year: p.year } : {}) };
      n.key = norm(p.title);
      nodes.set(n.key, n);
      resolved[p.docId] = shortId(w.id);
      oaRefs.set(n.key, (w.referenced_works ?? []).map(shortId));
    } else {
      const s = await s2References(p);
      if (!s) {
        missing.push(p.title);
        continue;
      }
      const key = norm(p.title);
      nodes.set(key, { key, title: p.title, year: p.year ?? s.year, authors: [], citations: s.citations, doi: p.doi, arxiv: p.arxiv, url: p.arxiv ? `https://arxiv.org/abs/${p.arxiv}` : p.doi ? `https://doi.org/${p.doi}` : null, kind: "session", docId: p.docId });
      refsOf.set(key, s.refs.map((r) => r.key));
      for (const r of s.refs) if (!nodes.has(r.key)) nodes.set(r.key, r);
    }
  }
  const session = [...nodes.values()].filter((n) => n.kind === "session");

  // What they cite: details for every OpenAlex reference, keyed by title.
  const allRefIds = [...new Set([...oaRefs.values()].flat())];
  const refWorks = await worksByIds(allRefIds.slice(0, 600));
  const keyOfOA = new Map<string, string>();
  for (const w of refWorks) {
    if (!w.display_name || checkedYear(w) === false) continue;
    const n = nodeFromOA(w, "foundation");
    keyOfOA.set(n.oa!, n.key);
    if (!nodes.has(n.key)) nodes.set(n.key, n);
  }
  for (const [key, ids] of oaRefs) refsOf.set(key, ids.map((id) => keyOfOA.get(id)).filter((k): k is string => Boolean(k)));

  // Foundations: cited by several of your papers first, then the most cited.
  const sessionKeys = new Set(session.map((n) => n.key));
  const cited = new Map<string, number>();
  for (const [from, refs] of refsOf) {
    for (const to of new Set(refs)) {
      if (sessionKeys.has(to)) edges.add(`${from}\u0000${to}`);
      else cited.set(to, (cited.get(to) ?? 0) + 1);
    }
  }
  const foundations = [...cited.entries()]
    .map(([key, count]) => ({ key, count, citations: nodes.get(key)?.citations ?? 0 }))
    .sort((a, b) => b.count - a.count || b.citations - a.citations)
    .filter((f, i) => f.count >= 2 || i < Math.max(8, session.length * 3))
    .slice(0, MAX_FOUNDATIONS);
  const keep = new Set([...sessionKeys, ...foundations.map((f) => f.key)]);
  for (const f of foundations) nodes.get(f.key)!.citedByYours = f.count;
  for (const [from, refs] of refsOf) for (const to of new Set(refs)) if (keep.has(to) && from !== to) edges.add(`${from}\u0000${to}`);

  // Links among foundations (what they cite of each other).
  for (const w of refWorks) {
    const from = keyOfOA.get(shortId(w.id));
    if (!from || !keep.has(from) || sessionKeys.has(from)) continue;
    for (const id of w.referenced_works ?? []) {
      const to = keyOfOA.get(shortId(id));
      if (to && keep.has(to) && to !== from) edges.add(`${from}\u0000${to}`);
    }
  }

  // The frontier: newer work citing your papers (several of them, ideally).
  const sessionOA = session.filter((n) => n.oa).map((n) => n.oa!);
  const frontier: GraphNode[] = [];
  if (sessionOA.length) {
    const since = `${new Date().getFullYear() - 4}-01-01`;
    const filter = `cites:${sessionOA.slice(0, 40).join("|")},from_publication_date:${since}`;
    const [top, recent] = await Promise.all([
      oa<{ results: OAWork[] }>("works", { filter, sort: "cited_by_count:desc", per_page: "50" }),
      oa<{ results: OAWork[] }>("works", { filter, sort: "publication_date:desc", per_page: "25" }),
    ]);
    const oaKey = new Map(session.filter((n) => n.oa).map((n) => [n.oa!, n.key]));
    const seen = new Set<string>();
    const candidates = [...(top?.results ?? []), ...(recent?.results ?? [])]
      // New work with citations from years before it existed is a merged record: leave it out.
      .filter((w) => w.display_name && checkedYear(w) === w.publication_year && !seen.has(w.id) && seen.add(w.id))
      .map((w) => {
        const cites = (w.referenced_works ?? []).map((id) => oaKey.get(shortId(id))).filter((k): k is string => Boolean(k));
        return { w, cites: [...new Set(cites)] };
      })
      .filter((c) => c.cites.length && !nodes.has(norm(c.w.display_name!)))
      .sort((a, b) => b.cites.length - a.cites.length || (b.w.cited_by_count ?? 0) - (a.w.cited_by_count ?? 0));
    const minOverlap = sessionOA.length >= 3 ? 2 : 1;
    const picked = [...candidates.filter((c) => c.cites.length >= minOverlap), ...candidates.filter((c) => c.cites.length < minOverlap)].slice(0, MAX_FRONTIER);
    for (const c of picked) {
      const n = { ...nodeFromOA(c.w, "frontier"), citesYours: c.cites.length };
      frontier.push(n);
      for (const to of c.cites) edges.add(`${n.key}\u0000${to}`);
    }
  }

  const finalNodes = [...session, ...foundations.map((f) => nodes.get(f.key)!), ...frontier];
  const present = new Set(finalNodes.map((n) => n.key));
  const graph: Graph = {
    nodes: finalNodes,
    edges: [...edges].map((e) => e.split("\u0000")).filter(([a, b]) => present.has(a) && present.has(b)).map(([from, to]) => ({ from, to })),
    built: new Date().toISOString(),
    missing,
  };
  return { graph, resolved };
}

// New work citing any of these papers since a date: for the weekly email.
export async function citingSince(openalexIds: string[], since: string, limit = 3) {
  if (!openalexIds.length) return [];
  const d = await oa<{ results: OAWork[] }>("works", {
    filter: `cites:${openalexIds.slice(0, 40).join("|")},from_publication_date:${since}`,
    sort: "cited_by_count:desc",
    per_page: String(Math.max(limit * 3, 10)),
  });
  return (d?.results ?? [])
    .filter((w) => w.display_name)
    .slice(0, limit)
    .map((w) => nodeFromOA(w, "frontier"));
}

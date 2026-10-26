import "server-only";
import { lookup } from "node:dns/promises";
import { createClient as createSupabase, type SupabaseClient } from "@supabase/supabase-js";
import net from "node:net";

// Scholarly lookups for paper sessions.
//   arXiv IDs -> arXiv API (authoritative)
//   DOIs      -> Crossref (authoritative); open-access PDFs from Semantic Scholar / OpenAlex
//   search, citations -> Semantic Scholar when reachable (set SEMANTIC_SCHOLAR_API_KEY:
//                        the shared anonymous pool is often rate-limited), else arXiv + OpenAlex
//                        (set OPENALEX_API_KEY: keyless requests share a tiny per-IP daily budget).
// OpenAlex sometimes merges records wrongly (a famous paper's record can carry
// another paper's title), so its metadata is only trusted when the title matches.

export type PaperMeta = {
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
  doi: string | null;
  arxiv_id: string | null;
  url: string; // landing page
  pdf_url: string | null; // open-access PDF, if known
  cited_by?: number | null;
};

const UA = `Confu/1.0 (research reading assistant${process.env.OPENALEX_MAILTO ? `; mailto:${process.env.OPENALEX_MAILTO}` : ""})`;
const TIMEOUT = 15_000;

/* ------------------------------------------------------------- identifiers */

export type Identifier = { kind: "arxiv"; id: string } | { kind: "doi"; doi: string } | { kind: "pdf"; url: string } | { kind: "query"; q: string };

const ARXIV_NEW = /(\d{4}\.\d{4,5})(v\d+)?/;
const ARXIV_OLD = /([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i;
const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;

export function parseIdentifier(raw: string): Identifier {
  const input = raw.trim().replace(/[.,;]+$/, "");
  const arxivDoi = input.match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i);
  if (arxivDoi) return { kind: "arxiv", id: arxivDoi[1] };

  if (/arxiv\.org\/(abs|pdf|html)\//i.test(input) || /^arxiv:/i.test(input)) {
    const m = input.match(ARXIV_NEW) ?? input.match(ARXIV_OLD);
    if (m) return { kind: "arxiv", id: m[1] };
  }
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(input)) return { kind: "arxiv", id: input.replace(/v\d+$/, "") };

  const doi = input.match(DOI);
  if (doi) return { kind: "doi", doi: decodeURIComponent(doi[1]).replace(/[)\].]+$/, "") };

  if (/^https?:\/\//i.test(input)) {
    if (/\.pdf($|[?#])/i.test(input)) return { kind: "pdf", url: input };
    return { kind: "query", q: input }; // unknown page; try it as a search
  }
  return { kind: "query", q: input };
}

/* ------------------------------------------------------------------ fetch */

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const decodeXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1]) : null;
};

/* ------------------------------------------------------------------ arXiv */

function parseArxivEntry(entry: string): PaperMeta | null {
  const idUrl = tag(entry, "id");
  const title = tag(entry, "title");
  if (!idUrl || !title || /^Error$/i.test(title)) return null;
  const id = (idUrl.match(ARXIV_NEW) ?? idUrl.match(ARXIV_OLD))?.[1] ?? null;
  if (!id) return null;
  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => decodeXml(m[1]));
  const published = tag(entry, "published");
  return {
    title,
    authors,
    year: published ? Number(published.slice(0, 4)) : null,
    venue: tag(entry, "arxiv:journal_ref") ?? "arXiv",
    abstract: tag(entry, "summary"),
    doi: tag(entry, "arxiv:doi"),
    arxiv_id: id,
    url: `https://arxiv.org/abs/${id}`,
    pdf_url: `https://arxiv.org/pdf/${id}`,
  };
}

async function arxivQuery(params: string, retry = true): Promise<PaperMeta[]> {
  try {
    const res = await fetch(`https://export.arxiv.org/api/query?${params}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT) });
    // arXiv asks for one request every few seconds; wait once and retry.
    if (res.status === 429 && retry) {
      await new Promise((r) => setTimeout(r, 3500));
      return arxivQuery(params, false);
    }
    if (!res.ok) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => parseArxivEntry(m[1])).filter((p): p is PaperMeta => Boolean(p));
  } catch {
    return [];
  }
}

export async function arxivById(id: string) {
  return (await arxivQuery(`id_list=${encodeURIComponent(id)}`))[0] ?? null;
}

/* --------------------------------------------------------------- OpenAlex */

type OAWork = {
  id: string;
  display_name: string | null;
  publication_year: number | null;
  cited_by_count: number | null;
  doi: string | null;
  authorships?: { author: { display_name: string } }[];
  primary_location?: { source?: { display_name?: string } | null; landing_page_url?: string | null } | null;
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null;
  locations?: { landing_page_url?: string | null }[];
  abstract_inverted_index?: Record<string, number[]> | null;
};

const OA_FIELDS = "id,display_name,publication_year,cited_by_count,doi,authorships,primary_location,best_oa_location,locations,abstract_inverted_index";
const oaUrl = (path: string, params: Record<string, string> = {}) => {
  const u = new URL(`https://api.openalex.org/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("select", OA_FIELDS);
  if (process.env.OPENALEX_MAILTO) u.searchParams.set("mailto", process.env.OPENALEX_MAILTO);
  // Without a key, every app on the same IP shares one small daily budget.
  if (process.env.OPENALEX_API_KEY) u.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
  return u.toString();
};

function abstractFrom(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
  return words.join(" ").trim() || null;
}

function fromOpenAlex(w: OAWork): PaperMeta {
  const arxivLoc = w.locations?.find((l) => l.landing_page_url?.includes("arxiv.org"))?.landing_page_url;
  const arxiv_id = arxivLoc ? ((arxivLoc.match(ARXIV_NEW) ?? arxivLoc.match(ARXIV_OLD))?.[1] ?? null) : null;
  const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//, "") : null;
  return {
    title: w.display_name ?? "Untitled",
    authors: (w.authorships ?? []).map((a) => a.author.display_name),
    year: w.publication_year,
    venue: w.primary_location?.source?.display_name ?? null,
    abstract: abstractFrom(w.abstract_inverted_index),
    doi,
    arxiv_id,
    url: arxiv_id ? `https://arxiv.org/abs/${arxiv_id}` : doi ? `https://doi.org/${doi}` : (w.primary_location?.landing_page_url ?? w.id),
    pdf_url: w.best_oa_location?.pdf_url ?? (arxiv_id ? `https://arxiv.org/pdf/${arxiv_id}` : null),
    cited_by: w.cited_by_count,
  };
}

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Every word of a (shortened or partial) title appears in the full one.
export function titleWithin(part: string, full: string) {
  const words = norm(part).split(" ").filter(Boolean);
  const all = new Set(norm(full).split(" "));
  return words.length >= 2 && words.every((w) => all.has(w));
}

export function sameTitle(a: string, b: string) {
  const x = new Set(norm(a).split(" "));
  const y = new Set(norm(b).split(" "));
  const inter = [...x].filter((t) => y.has(t)).length;
  return inter / Math.max(x.size, y.size, 1) >= 0.8;
}

// The OpenAlex record for a known paper, verified by title.
async function openAlexWorkFor(meta: { title: string; doi?: string | null }): Promise<OAWork | null> {
  if (meta.doi) {
    const w = await getJson<OAWork>(oaUrl(`works/doi:${meta.doi}`));
    if (w?.display_name && sameTitle(w.display_name, meta.title)) return w;
  }
  const found = await getJson<{ results: OAWork[] }>(oaUrl("works", { search: meta.title, per_page: "5" }));
  return (
    (found?.results ?? [])
      .filter((w) => w.display_name && sameTitle(w.display_name, meta.title))
      .sort((a, b) => (b.cited_by_count ?? 0) - (a.cited_by_count ?? 0))[0] ?? null
  );
}

/* -------------------------------------------------------- Semantic Scholar */

type S2Paper = {
  paperId: string;
  title: string | null;
  year: number | null;
  venue?: string | null;
  abstract?: string | null;
  citationCount?: number | null;
  authors?: { name: string }[];
  externalIds?: { ArXiv?: string; DOI?: string } | null;
  openAccessPdf?: { url?: string | null } | null;
};

const S2_FIELDS = "title,year,venue,abstract,citationCount,authors,externalIds,openAccessPdf";

// A Semantic Scholar key allows one request per second across all of
// Confu's servers. Each request reserves a slot in a queue shared through the
// database (take_s2_slot, migration 0016) and waits its turn, so concurrent
// users are served ~1.1 s apart instead of being refused. Without that
// migration, requests are spaced per server instance instead. Without a key
// the shared anonymous pool is used as-is, and a 429 just means "fall back".
let queue: SupabaseClient | null = null;
let localNext = 0;

// Milliseconds to wait for our slot, or null to skip Semantic Scholar now
// (queue over 15 s long: another source is faster than making someone wait).
async function s2Slot(): Promise<number | null> {
  queue ??= createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await queue.rpc("take_s2_slot");
  if (!error && typeof data === "number") return data < 0 ? null : data;
  const wait = Math.max(0, localNext - Date.now());
  localNext = Math.max(Date.now(), localNext) + 1100;
  return wait;
}

async function s2Fetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY?.trim();
  for (let attempt = 0; attempt < (key ? 2 : 1); attempt++) {
    if (key) {
      const wait = await s2Slot().catch(() => 0);
      if (wait === null) return null; // long queue: use the fallback sources
      if (wait) await new Promise((r) => setTimeout(r, wait));
    }
    try {
      const res = await fetch(`https://api.semanticscholar.org/graph/v1/${path}`, {
        ...init,
        headers: { "User-Agent": UA, ...(key ? { "x-api-key": key } : {}), ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (res.status !== 429) return res;
    } catch {
      return null;
    }
  }
  return null;
}

// Semantic Scholar GET through the shared request queue (null when unavailable).
export async function s2<T>(path: string): Promise<T | null> {
  const res = await s2Fetch(path);
  return res?.ok ? ((await res.json()) as T) : null; // still limited -> callers fall back
}

function fromS2(p: S2Paper): PaperMeta {
  const arxiv_id = p.externalIds?.ArXiv ?? null;
  const doi = p.externalIds?.DOI ?? null;
  return {
    title: p.title ?? "Untitled",
    authors: (p.authors ?? []).map((a) => a.name),
    year: p.year,
    venue: p.venue || null,
    abstract: p.abstract ?? null,
    doi,
    arxiv_id,
    url: arxiv_id ? `https://arxiv.org/abs/${arxiv_id}` : doi ? `https://doi.org/${doi}` : `https://www.semanticscholar.org/paper/${p.paperId}`,
    pdf_url: p.openAccessPdf?.url || (arxiv_id ? `https://arxiv.org/pdf/${arxiv_id}` : null),
    cited_by: p.citationCount ?? null,
  };
}

const s2IdFor = (p: { arxiv_id?: string | null; doi?: string | null }) => (p.arxiv_id ? `arXiv:${p.arxiv_id}` : p.doi ? `DOI:${p.doi}` : null);

/* ---------------------------------------------------------------- Crossref */

async function crossrefByDoi(doi: string): Promise<PaperMeta | null> {
  type CR = {
    message: {
      title?: string[];
      author?: { given?: string; family?: string; name?: string }[];
      issued?: { "date-parts"?: number[][] };
      "container-title"?: string[];
      abstract?: string;
      URL?: string;
    };
  };
  const data = await getJson<CR>(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  const m = data?.message;
  if (!m?.title?.[0]) return null;
  return {
    title: decodeXml(m.title[0]),
    authors: (m.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")),
    year: m.issued?.["date-parts"]?.[0]?.[0] ?? null,
    venue: m["container-title"]?.[0] ?? null,
    abstract: m.abstract ? decodeXml(m.abstract.replace(/<[^>]+>/g, " ")).replace(/^abstract\s*/i, "") : null,
    doi,
    arxiv_id: null,
    url: `https://doi.org/${doi}`,
    pdf_url: null,
  };
}

/* ----------------------------------------------------------------- public */

// Resolve an identifier to one verified paper, or search for candidates.
export async function resolvePaper(input: string): Promise<PaperMeta[]> {
  const id = parseIdentifier(input);
  if (id.kind === "arxiv") {
    const p = await arxivById(id.id);
    return p ? [p] : [];
  }
  if (id.kind === "doi") {
    const p = (await crossrefByDoi(id.doi)) ?? null;
    if (!p) {
      const w = await getJson<OAWork>(oaUrl(`works/doi:${id.doi}`));
      return w?.display_name ? [fromOpenAlex(w)] : [];
    }
    // Open-access PDF and a missing abstract: Semantic Scholar, else a title-verified OpenAlex record.
    const sp = await s2<S2Paper>(`paper/DOI:${encodeURIComponent(id.doi)}?fields=${S2_FIELDS}`);
    if (sp?.title && sameTitle(sp.title, p.title)) {
      const m = fromS2(sp);
      p.pdf_url = m.pdf_url;
      p.abstract ??= m.abstract;
      p.arxiv_id = m.arxiv_id;
      p.cited_by = m.cited_by;
      if (p.arxiv_id && !p.pdf_url) p.pdf_url = `https://arxiv.org/pdf/${p.arxiv_id}`;
      return [p];
    }
    const w = await openAlexWorkFor(p);
    if (w) {
      const oa = fromOpenAlex(w);
      p.pdf_url = oa.pdf_url;
      p.abstract ??= oa.abstract;
      p.arxiv_id = oa.arxiv_id;
      p.cited_by = oa.cited_by;
    }
    return [p];
  }
  if (id.kind === "pdf") {
    const name = decodeURIComponent(new URL(id.url).pathname.split("/").pop() ?? "paper.pdf").replace(/\.pdf$/i, "");
    return [{ title: name || "Paper", authors: [], year: null, venue: null, abstract: null, doi: null, arxiv_id: null, url: id.url, pdf_url: id.url }];
  }
  return searchPapers(id.q, 6);
}

// opts.arxiv = false skips arXiv, which allows only one request every few
// seconds: callers that search many times at once use OpenAlex instead.
export async function searchPapers(query: string, limit = 6, fromYear?: number, opts: { arxiv?: boolean } = {}): Promise<PaperMeta[]> {
  const n = Math.min(10, Math.max(1, limit));
  const q = query.slice(0, 300);

  const viaS2 = await s2<{ data?: S2Paper[] }>(
    `paper/search?query=${encodeURIComponent(q)}&limit=${n}&fields=${S2_FIELDS}${fromYear ? `&year=${fromYear}-` : ""}`,
  );
  if (viaS2?.data?.length) return viaS2.data.filter((p) => p.title).map(fromS2);

  // Fallback: arXiv (authoritative for preprints) + OpenAlex (broad), deduplicated by title.
  const terms = norm(q).split(" ").filter((t) => t.length > 2).slice(0, 8);
  const [arxiv, oa] = await Promise.all([
    terms.length && opts.arxiv !== false
      ? arxivQuery(`search_query=${encodeURIComponent(terms.map((t) => `all:${t}`).join(" AND "))}&max_results=${n}&sortBy=relevance`)
      : [],
    getJson<{ results: OAWork[] }>(oaUrl("works", { search: q, per_page: String(n), ...(fromYear ? { filter: `from_publication_date:${fromYear}-01-01` } : {}) })),
  ]);
  const merged: PaperMeta[] = [];
  for (const p of [...arxiv.filter((p) => !fromYear || (p.year ?? 0) >= fromYear), ...(oa?.results ?? []).filter((w) => w.display_name).map(fromOpenAlex)]) {
    if (!merged.some((m) => sameTitle(m.title, p.title))) merged.push(p);
  }
  return merged.slice(0, n);
}

// Look up several arXiv papers in one request: Semantic Scholar's batch
// endpoint, else arXiv itself (one id_list call). Returns what exists.
export async function papersByArxivIds(ids: string[]): Promise<PaperMeta[]> {
  const clean = [...new Set(ids.map((i) => i.trim().replace(/^arxiv:/i, "").replace(/v\d+$/, "")).filter((i) => ARXIV_NEW.test(i) || ARXIV_OLD.test(i)))].slice(0, 20);
  if (!clean.length) return [];
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    try {
      const res = await s2Fetch(`paper/batch?fields=${S2_FIELDS}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: clean.map((i) => `ARXIV:${i}`) }),
      });
      if (res?.ok) {
        const found = ((await res.json()) as (S2Paper | null)[]).filter((p): p is S2Paper => Boolean(p?.title)).map(fromS2);
        if (found.length) return found;
      }
    } catch {}
  }
  return arxivQuery(`id_list=${clean.join(",")}&max_results=${clean.length}`);
}

// Find one specific paper by its exact title (null if nothing matches).
// General search first; then arXiv's title field and OpenAlex's title filter,
// which find exact titles that relevance ranking buries under newer work.
export async function findByTitle(title: string, opts: { arxiv?: boolean } = {}): Promise<PaperMeta | null> {
  const hit = (list: PaperMeta[]) => list.find((p) => sameTitle(p.title, title)) ?? null;
  const first = hit(await searchPapers(title, 4, undefined, opts).catch(() => []));
  if (first) return first;
  const words = norm(title).split(" ").filter((t) => t.length > 2).slice(0, 10);
  const [arxiv, oa] = await Promise.all([
    words.length && opts.arxiv !== false
      ? arxivQuery(`search_query=${encodeURIComponent(words.map((w) => `ti:${w}`).join(" AND "))}&max_results=5`).catch(() => [])
      : [],
    getJson<{ results: OAWork[] }>(oaUrl("works", { filter: `title.search:${title.replace(/[,:]/g, " ")}`, per_page: "5" })),
  ]);
  return hit([...arxiv, ...(oa?.results ?? []).filter((w) => w.display_name).map(fromOpenAlex)]);
}

export async function findCitingPapers(
  paper: { title: string; doi?: string | null; arxiv_id?: string | null },
  query?: string,
  limit = 6,
): Promise<{ source: string; total: number | null; citing: PaperMeta[]; note?: string }> {
  const n = Math.min(10, Math.max(1, limit));
  const terms = query ? norm(query).split(" ").filter((t) => t.length > 2) : [];
  const matches = (p: PaperMeta) => !terms.length || terms.some((t) => norm(`${p.title} ${p.abstract ?? ""}`).includes(t));

  // Semantic Scholar: find the paper, then its citations.
  let s2Id = s2IdFor(paper);
  if (!s2Id) {
    const m = await s2<{ data?: S2Paper[] }>(`paper/search/match?query=${encodeURIComponent(paper.title)}&fields=title`);
    const hit = m?.data?.[0];
    if (hit?.title && sameTitle(hit.title, paper.title)) s2Id = hit.paperId;
  }
  if (s2Id) {
    const [info, cites] = await Promise.all([
      s2<S2Paper>(`paper/${encodeURIComponent(s2Id)}?fields=citationCount`),
      s2<{ data?: { citingPaper: S2Paper }[] }>(`paper/${encodeURIComponent(s2Id)}/citations?limit=100&fields=${S2_FIELDS}`),
    ]);
    if (cites?.data) {
      const citing = cites.data.map((c) => c.citingPaper).filter((p) => p.title).map(fromS2).filter(matches);
      citing.sort((a, b) => (b.cited_by ?? 0) - (a.cited_by ?? 0));
      return { source: "Semantic Scholar", total: info?.citationCount ?? null, citing: citing.slice(0, n) };
    }
  }

  // Fallback: OpenAlex's citation graph, located by DOI (arXiv DOI for preprints).
  const doi = paper.doi ?? (paper.arxiv_id ? `10.48550/arxiv.${paper.arxiv_id}` : null);
  const w = doi ? await getJson<OAWork>(oaUrl(`works/doi:${doi}`)) : await openAlexWorkFor(paper);
  if (!w) return { source: "none", total: null, citing: [], note: "Couldn't find this paper's citation record." };
  const params: Record<string, string> = {
    filter: `cites:${w.id.replace("https://openalex.org/", "")}`,
    per_page: String(n),
    sort: "cited_by_count:desc",
  };
  if (query) params.search = query.slice(0, 200);
  const found = await getJson<{ results: OAWork[] }>(oaUrl("works", params));
  return {
    source: "OpenAlex",
    total: w.cited_by_count,
    citing: (found?.results ?? []).filter((x) => x.display_name).map(fromOpenAlex),
    note: "Citation data from OpenAlex can be incomplete or noisy; verify important claims.",
  };
}

/* --------------------------------------------- safe fetching of PDF links */

const MAX_PDF_BYTES = 50 * 1024 * 1024;

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb");
}

async function assertPublic(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) links are supported.");
  if (url.username || url.password) throw new Error("Links with credentials aren't supported.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Unsupported port.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error("That address isn't allowed.");
}

// Fetch a PDF from a public URL: http(s) only, public addresses only (checked
// on every redirect), size-capped, and verified to really be a PDF.
export async function fetchPublicPdf(raw: string): Promise<Uint8Array> {
  let url = new URL(raw);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA, Accept: "application/pdf" }, signal: AbortSignal.timeout(30_000) });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) break;
      url = new URL(next, url);
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`The PDF link returned ${res.status}.`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_PDF_BYTES) throw new Error("The PDF is larger than 50 MB.");

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PDF_BYTES) {
        await reader.cancel();
        throw new Error("The PDF is larger than 50 MB.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("That link didn't return a PDF (it may be behind a paywall).");
    return bytes;
  }
  throw new Error("Too many redirects.");
}

// Compact form for the model's tool results.
export function forModel(p: PaperMeta) {
  return {
    title: p.title,
    authors: p.authors.slice(0, 4).join(", ") + (p.authors.length > 4 ? " et al." : ""),
    year: p.year,
    venue: p.venue,
    citations: p.cited_by ?? undefined,
    arxiv: p.arxiv_id ?? undefined,
    doi: p.doi ?? undefined,
    url: p.url,
    abstract: p.abstract ? p.abstract.slice(0, 500) + (p.abstract.length > 500 ? "…" : "") : undefined,
  };
}

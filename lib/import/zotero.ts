// Zotero: read a library with a read-only API key (zotero.org/settings/keys),
// straight from the browser (Zotero allows it), so the key never reaches
// Confu's server. Or read an exported .bib / .ris file (Zotero, Mendeley,
// EndNote). Items become papers; PDFs stored in Zotero are downloaded when the
// key allows file access.

import type { PaperMeta } from "@/lib/scholar";

const API = "https://api.zotero.org";

export type ZoteroItem = {
  key: string;
  paper: PaperMeta;
  type: string;
  pdf: { href: string; size: number | null } | null; // a PDF stored in Zotero
};
export type ZoteroCollection = { key: string; name: string; depth: number };
export type ZoteroAccount = { apiKey: string; userId: number; username: string; files: boolean };

type Creator = { creatorType?: string; firstName?: string; lastName?: string; name?: string };
type ItemData = {
  key: string;
  itemType: string;
  title?: string;
  creators?: Creator[];
  date?: string;
  publicationTitle?: string;
  proceedingsTitle?: string;
  conferenceName?: string;
  bookTitle?: string;
  publisher?: string;
  DOI?: string;
  url?: string;
  abstractNote?: string;
  extra?: string;
};

const headers = (apiKey: string) => ({ "Zotero-API-Key": apiKey, "Zotero-API-Version": "3" });

async function get<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: headers(apiKey) });
  if (res.status === 403) throw new Error("Zotero refused that key. Check it allows reading your library.");
  if (!res.ok) throw new Error(`Zotero answered with an error (${res.status}).`);
  return (await res.json()) as T;
}

export async function connectZotero(apiKey: string): Promise<ZoteroAccount> {
  const key = apiKey.trim();
  if (!/^[A-Za-z0-9]{24}$/.test(key)) throw new Error("A Zotero API key is 24 letters and numbers. Create one at zotero.org/settings/keys.");
  const res = await fetch(`${API}/keys/${key}`, { headers: { "Zotero-API-Version": "3" } });
  if (!res.ok) throw new Error("Zotero didn't recognise that key.");
  const j = (await res.json()) as { userID: number; username: string; access?: { user?: { library?: boolean; files?: boolean } } };
  if (!j.access?.user?.library) throw new Error("That key can't read your library. Edit it on zotero.org and tick 'Allow library access'.");
  return { apiKey: key, userId: j.userID, username: j.username, files: Boolean(j.access.user.files) };
}

export async function zoteroCollections(acc: ZoteroAccount): Promise<ZoteroCollection[]> {
  const list = await get<{ key: string; data: { name: string; parentCollection: string | false } }[]>(acc.apiKey, `/users/${acc.userId}/collections?limit=100&sort=title`);
  // Order as a tree: parents, each followed by its children.
  const byParent = new Map<string, typeof list>();
  for (const c of list) {
    const p = c.data.parentCollection || "";
    byParent.set(p, [...(byParent.get(p) ?? []), c]);
  }
  const out: ZoteroCollection[] = [];
  const walk = (parent: string, depth: number) => {
    for (const c of byParent.get(parent) ?? []) {
      out.push({ key: c.key, name: c.data.name, depth });
      walk(c.key, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

export async function zoteroItems(acc: ZoteroAccount, opts: { collection?: string; q?: string } = {}): Promise<ZoteroItem[]> {
  const base = opts.collection ? `/users/${acc.userId}/collections/${opts.collection}/items/top` : `/users/${acc.userId}/items/top`;
  const q = opts.q?.trim() ? `&q=${encodeURIComponent(opts.q.trim())}&qmode=titleCreatorYear` : "";
  const list = await get<{ key: string; data: ItemData; links?: { attachment?: { href: string; attachmentType?: string; attachmentSize?: number } } }[]>(
    acc.apiKey,
    `${base}?limit=100&sort=dateModified&direction=desc&itemType=-note%20||%20attachment&include=data${q}`,
  );
  return list.map((it) => {
    const att = it.links?.attachment;
    return {
      key: it.key,
      type: it.data.itemType,
      paper: paperFromZotero(it.data),
      pdf: att?.attachmentType === "application/pdf" ? { href: att.href, size: att.attachmentSize ?? null } : null,
    };
  });
}

// A PDF stored in Zotero; null when it isn't downloadable (linked files,
// a key without file access, or storage that blocks browsers).
export async function zoteroPdf(acc: ZoteroAccount, item: ZoteroItem): Promise<File | null> {
  if (!item.pdf || !acc.files) return null;
  try {
    const res = await fetch(`${item.pdf.href}/file`, { headers: headers(acc.apiKey) });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size < 1000) return null;
    return new File([blob], `${item.paper.title.slice(0, 80).replace(/[\\/:*?"<>|]+/g, " ")}.pdf`, { type: "application/pdf" });
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------- metadata */

const ARXIV = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv[:\s]+|10\.48550\/arxiv\.)(\d{4}\.\d{4,5})(?:v\d+)?/i;

function paperFromZotero(d: ItemData): PaperMeta {
  const authors = (d.creators ?? [])
    .filter((c) => !c.creatorType || c.creatorType === "author")
    .map((c) => c.name || [c.firstName, c.lastName].filter(Boolean).join(" "))
    .filter(Boolean);
  const doi = (d.DOI || /DOI:\s*(\S+)/i.exec(d.extra ?? "")?.[1] || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") || null;
  const arxiv = ARXIV.exec(`${d.url ?? ""} ${d.extra ?? ""} ${doi ?? ""}`)?.[1] ?? null;
  return finish({
    title: d.title || "Untitled",
    authors,
    year: Number(/(\d{4})/.exec(d.date ?? "")?.[1]) || null,
    venue: d.publicationTitle || d.proceedingsTitle || d.conferenceName || d.bookTitle || d.publisher || null,
    abstract: d.abstractNote || null,
    doi,
    arxiv_id: arxiv,
    url: d.url ?? "",
  });
}

function finish(p: Omit<PaperMeta, "pdf_url">): PaperMeta {
  const url = p.url || (p.arxiv_id ? `https://arxiv.org/abs/${p.arxiv_id}` : p.doi ? `https://doi.org/${p.doi}` : "");
  return { ...p, url, pdf_url: p.arxiv_id ? `https://arxiv.org/pdf/${p.arxiv_id}` : null };
}

// LaTeX-ish BibTeX values -> plain text.
const unTex = (s: string) =>
  s
    .replace(/\\[`'^"~=.uvHtcdbk]\{?([A-Za-z])\}?/g, "$1")
    .replace(/\\(?:emph|textit|textbf|mathrm|text)\{([^}]*)\}/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\\&/g, "&")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function parseBibtex(text: string): PaperMeta[] {
  const out: PaperMeta[] = [];
  for (const entry of text.split(/\n\s*@/).map((e, i) => (i === 0 ? e.replace(/^[\s\S]*?@/, "") : e))) {
    if (!/^\s*\w+\s*\{/.test(entry) || /^\s*(comment|string|preamble)\b/i.test(entry)) continue;
    const fields: Record<string, string> = {};
    // field = {value with {nested} braces} | "value" | number
    const re = /(\w+)\s*=\s*(?:\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}|"([^"]*)"|(\d+))/g;
    for (const m of entry.matchAll(re)) fields[m[1].toLowerCase()] = unTex(m[2] ?? m[3] ?? m[4] ?? "");
    if (!fields.title) continue;
    const authors = (fields.author ?? "")
      .split(/\s+and\s+/i)
      .map((a) => (a.includes(",") ? a.split(",").map((s) => s.trim()).reverse().join(" ") : a.trim()))
      .filter(Boolean);
    const eprint = /arxiv/i.test(fields.archiveprefix ?? fields.eprinttype ?? "") ? fields.eprint : undefined;
    const arxiv = (eprint && /^\d{4}\.\d{4,5}/.exec(eprint)?.[0]) || ARXIV.exec(`${fields.url ?? ""} ${fields.doi ?? ""} ${fields.journal ?? ""}`)?.[1] || null;
    out.push(
      finish({
        title: fields.title,
        authors,
        year: Number(fields.year) || null,
        venue: fields.journal || fields.booktitle || fields.publisher || null,
        abstract: fields.abstract || null,
        doi: fields.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") || null,
        arxiv_id: arxiv,
        url: fields.url ?? "",
      }),
    );
  }
  return out;
}

export function parseRis(text: string): PaperMeta[] {
  const out: PaperMeta[] = [];
  let cur: Record<string, string[]> = {};
  const flush = () => {
    const f = (k: string) => cur[k]?.[0];
    const title = f("TI") || f("T1") || f("CT");
    if (title) {
      const doi = f("DO")?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") || null;
      const url = f("UR") || "";
      out.push(
        finish({
          title,
          authors: [...(cur.AU ?? []), ...(cur.A1 ?? [])].map((a) => (a.includes(",") ? a.split(",").map((s) => s.trim()).reverse().join(" ") : a)),
          year: Number(/(\d{4})/.exec(f("PY") || f("Y1") || f("DA") || "")?.[1]) || null,
          venue: f("JO") || f("JF") || f("T2") || f("BT") || f("PB") || null,
          abstract: f("AB") || f("N2") || null,
          doi,
          arxiv_id: ARXIV.exec(`${url} ${doi ?? ""}`)?.[1] ?? null,
          url,
        }),
      );
    }
    cur = {};
  };
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/.exec(line);
    if (!m) continue;
    if (m[1] === "ER") flush();
    else (cur[m[1]] ??= []).push(m[2].trim());
  }
  flush();
  return out;
}

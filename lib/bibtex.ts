// BibTeX for a session's papers, from what Confu knows about them (authors,
// year, venue, DOI, arXiv ID). Keys look like vaswani2017attention and are
// unique within the file; related-work drafts cite with the same keys.

export type BibPaper = { title: string; authors?: string[]; year?: number | null; venue?: string | null; doi?: string | null; arxiv_id?: string | null; url?: string | null };

const STOP = new Set(["a", "an", "the", "on", "of", "for", "in", "to", "and", "with", "from", "is", "are", "via", "towards", "toward"]);

const ascii = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();

function lastName(author: string) {
  const parts = author.trim().split(/\s+/);
  return parts[parts.length - 1] ?? "anon";
}

export function bibKeys(papers: BibPaper[]): string[] {
  const used = new Map<string, number>();
  return papers.map((p) => {
    const who = ascii(lastName(p.authors?.[0] ?? "anon")) || "anon";
    const word = p.title.split(/\s+/).map(ascii).find((w) => w && !STOP.has(w)) ?? "paper";
    const base = `${who}${p.year ?? ""}${word}`;
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n ? `${base}${String.fromCharCode(97 + n)}` : base;
  });
}

// Braces keep capitalisation (BERT, GPT) as written.
const field = (v: string) => `{${v.replace(/[{}\\]/g, "").replace(/([&%$#_])/g, "\\$1")}}`;

export function toBibtex(papers: BibPaper[]): string {
  const keys = bibKeys(papers);
  return papers
    .map((p, i) => {
      const arxiv = p.arxiv_id && (!p.venue || /arxiv/i.test(p.venue));
      const lines: [string, string][] = [["title", `{${field(p.title)}}`]];
      if (p.authors?.length) lines.push(["author", field(p.authors.join(" and "))]);
      if (p.year) lines.push(["year", `{${p.year}}`]);
      if (arxiv) {
        lines.push(["journal", field(`arXiv preprint arXiv:${p.arxiv_id}`)], ["eprint", field(p.arxiv_id!)], ["archivePrefix", "{arXiv}"]);
      } else if (p.venue) {
        lines.push(["journal", field(p.venue)]);
      }
      if (p.doi) lines.push(["doi", field(p.doi)]);
      const url = p.arxiv_id ? `https://arxiv.org/abs/${p.arxiv_id}` : p.doi ? `https://doi.org/${p.doi}` : p.url;
      if (url) lines.push(["url", `{${url}}`]);
      return `@article{${keys[i]},\n${lines.map(([k, v]) => `  ${k} = ${v}`).join(",\n")}\n}`;
    })
    .join("\n\n");
}

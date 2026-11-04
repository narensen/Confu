// Citations the tutor was allowed to make: a page the prompt actually sent.
// Same shapes cite() emits and linkPages already links.
// One PDF: "p. 12", "pp. 4–6". Several: "D2 p. 12", "D2, p. 12".
//
// Nothing is dropped and nothing moves. A page number the prompt never sent
// stops being a citation. Then the answer says once what isn't cited: the
// whole answer (one note at the end), or, when only some of it is, the
// paragraphs marked † and one footnote. Headings, diagrams, tables, formulas
// and the closing question to the student are not claims, so they are never
// marked.

const CITE_SRC = "\\b(?:(D\\d{1,2})[,\\s·]*)?(pp?\\.)\\s?(\\d{1,4})(?:\\s?[–-]\\s?\\d{1,4})?";

export const NOT_CITED = "Not cited from a page in this session.";
const MARK = "†";

// The note as the tutor sometimes writes it itself: in brackets, italics,
// after a dash, with or without the full stop.
// Within one line: the blank lines around it are what separate paragraphs.
const SELF_NOTE = /(?:[—–-][ \t]*)?[([]?[ \t]*[*_]{0,2}[ \t]*not cited from a page in this session\.?[ \t]*[*_]{0,2}[ \t]*[)\]]?\.?/gi;

export function retrievedKeys(multi: boolean, pages: { label: string; page: number }[]): Set<string> {
  const keys = new Set<string>();
  for (const e of pages) {
    keys.add(multi && e.label ? `${e.label.toUpperCase()} p. ${e.page}` : `p. ${e.page}`);
  }
  return keys;
}

function citeKey(multi: boolean, label: string | undefined, page: string): string {
  return multi && label ? `${label.toUpperCase()} p. ${page}` : `p. ${page}`;
}

const FENCE = /\u0000F(\d+)\u0000/;

// A paragraph that states something, and so should have a page behind it.
function isClaim(text: string): boolean {
  if (FENCE.test(text)) return false; // code or a diagram
  if (/^#{1,6}\s/.test(text)) return false; // a heading
  if (/^\s*\|/m.test(text) && /^\s*\|?\s*:?-{3,}/m.test(text)) return false; // a table
  if (/^\s*\$\$[\s\S]*\$\$\s*$/.test(text)) return false; // a formula on its own
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(text)) return false; // a rule
  if (/\?\s*[*_]*\s*$/.test(text)) return false; // a question to the student
  const words = text
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, " x ")
    .replace(/[#>*_`|[\]()]/g, " ")
    .split(/\s+/)
    .filter((w) => /[A-Za-z]{2,}/.test(w));
  return words.length >= 8;
}

export function keepCited(text: string, retrieved: Set<string>, multi: boolean): string {
  // Code and diagrams stay whole and in place: a blank line inside a fence
  // is not a new paragraph. Each becomes its own block while this runs.
  const fences: string[] = [];
  const body = text.replace(/```[\s\S]*?(?:```|$)/g, (block) => {
    fences.push(block.trim());
    return `\n\n\u0000F${fences.length - 1}\u0000\n\n`;
  });
  const restore = (s: string) => s.replace(/\u0000F(\d+)\u0000/g, (_, i: string) => fences[Number(i)] ?? "");
  const known = (label: string | undefined, page: string) => retrieved.has(citeKey(multi, label, page));

  type Part = { text: string; kind: "cited" | "uncited" | "free" };
  const parts: Part[] = [];
  for (const para of body.split(/\n\s*\n/)) {
    let trimmed = FENCE.test(para) ? para.trim() : para.replace(SELF_NOTE, "").trim();
    if (!trimmed) continue;
    // A page number the prompt never sent must not become a link.
    const cites = [...trimmed.matchAll(new RegExp(CITE_SRC, "gi"))];
    if (cites.some((m) => !known(m[1], m[3]))) {
      trimmed = trimmed
        .replace(new RegExp(CITE_SRC, "gi"), (match, label: string | undefined, _dot: string, page: string) => (known(label, page) ? match : ""))
        .replace(/\(\s*\)/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([.,;:])/g, "$1")
        .trim();
      if (!trimmed) continue;
    }
    const cited = cites.some((m) => known(m[1], m[3]));
    parts.push({ text: trimmed, kind: cited ? "cited" : isClaim(trimmed) ? "uncited" : "free" });
  }
  if (!parts.length) return "";

  const claims = parts.filter((p) => p.kind !== "free").length;
  const uncited = parts.filter((p) => p.kind === "uncited").length;
  const plain = parts.map((p) => p.text).join("\n\n");
  if (!uncited) return restore(plain);
  // None of it is cited: say so once, under the answer.
  if (uncited === claims) return restore(`${plain}\n\n_${NOT_CITED}_`);
  // Some of it: mark those paragraphs, and explain the mark once.
  const marked = parts.map((p) => (p.kind === "uncited" ? `${p.text} ${MARK}` : p.text)).join("\n\n");
  return restore(`${marked}\n\n_${MARK} ${NOT_CITED}_`);
}

/**
 * Answers saved before the note was given once: the note after every
 * paragraph. Shown with a single note at the end instead.
 */
export function oneCiteNote(text: string): string {
  const notes = text.match(SELF_NOTE)?.length ?? 0;
  if (notes < 2) return text;
  const stripped = text
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((part, i) => (i % 2 ? part : part.replace(SELF_NOTE, "")))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `${stripped}\n\n_Parts of this answer are not cited from a page in this session._`;
}

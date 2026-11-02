// Citations the tutor was allowed to make: a page the prompt actually sent.
// Same shapes cite() emits and linkPages already links.
// One PDF: "p. 12", "pp. 4–6". Several: "D2 p. 12", "D2, p. 12".
// A paragraph with no such citation is still shown. It is marked, not dropped.

const CITE_SRC = "\\b(?:(D\\d{1,2})[,\\s·]*)?(pp?\\.)\\s?(\\d{1,4})(?:\\s?[–-]\\s?\\d{1,4})?";

export const NOT_CITED = "Not cited from a page in this session.";

export function retrievedKeys(multi: boolean, pages: { label: string; page: number }[]): Set<string> {
  const keys = new Set<string>();
  for (const e of pages) {
    keys.add(multi && e.label ? `${e.label.toUpperCase()} p. ${e.page}` : `p. ${e.page}`);
  }
  return keys;
}

const SVG_FENCE = /```svg\b[\s\S]*?```/gi;

// A diagram is a picture. Pull the fence out so a blank line inside it is not
// treated as a new paragraph, then put it back.
export function keepCited(text: string, retrieved: Set<string>, multi: boolean): string {
  const diagrams: string[] = [];
  const body = text.replace(SVG_FENCE, (block) => {
    diagrams.push(block.trim());
    return "";
  });
  const kept = keepCitedParagraphs(body, retrieved, multi);
  return [kept, ...diagrams].filter(Boolean).join("\n\n");
}

function citeKey(multi: boolean, label: string | undefined, page: string): string {
  return multi && label ? `${label.toUpperCase()} p. ${page}` : `p. ${page}`;
}

function keepCitedParagraphs(text: string, retrieved: Set<string>, multi: boolean): string {
  const cite = new RegExp(CITE_SRC, "gi");
  const parts: { text: string; cited: boolean }[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    cite.lastIndex = 0;
    const cites = [...trimmed.matchAll(cite)];
    const known = (label: string | undefined, page: string) => retrieved.has(citeKey(multi, label, page));
    if (cites.length > 0 && cites.every((m) => known(m[1], m[3]))) {
      parts.push({ text: trimmed, cited: true });
      continue;
    }
    // A page number the prompt never sent must not become a link.
    let body = trimmed;
    if (cites.some((m) => !known(m[1], m[3]))) {
      body = trimmed
        .replace(new RegExp(CITE_SRC, "gi"), (match, label: string | undefined, _dot: string, page: string) => (known(label, page) ? match : ""))
        .replace(/\(\s*\)/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([.,;:])/g, "$1")
        .trim();
    }
    if (!body) continue;
    parts.push({ text: body, cited: false });
  }
  if (!parts.length) return "";
  const note = `_${NOT_CITED}_`;
  // The whole answer is outside the notes: say so once, under the text.
  if (parts.every((p) => !p.cited)) {
    const body = parts
      .map((p) => p.text)
      .filter((p) => !p.toLowerCase().includes(NOT_CITED.toLowerCase()))
      .join("\n\n");
    return body ? `${body}\n\n${note}` : note;
  }
  return parts
    .map((p) => (p.cited || p.text.toLowerCase().includes(NOT_CITED.toLowerCase()) ? p.text : `${p.text}\n\n${note}`))
    .join("\n\n");
}

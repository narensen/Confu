// Keep a tutor reply only where every citation is a page the prompt actually sent.
// Same shapes cite() emits and linkPages already links.
// One PDF: "p. 12", "pp. 4–6". Several: "D2 p. 12", "D2, p. 12".

const CITE_SRC = "\\b(?:(D\\d{1,2})[,\\s·]*)?(pp?\\.)\\s?(\\d{1,4})(?:\\s?[–-]\\s?\\d{1,4})?";

export function retrievedKeys(multi: boolean, pages: { label: string; page: number }[]): Set<string> {
  const keys = new Set<string>();
  for (const e of pages) {
    keys.add(multi && e.label ? `${e.label.toUpperCase()} p. ${e.page}` : `p. ${e.page}`);
  }
  return keys;
}

export function keepCited(text: string, retrieved: Set<string>, multi: boolean): string {
  const kept: string[] = [];
  const cite = new RegExp(CITE_SRC, "gi");
  for (const para of text.split(/\n\s*\n/)) {
    cite.lastIndex = 0;
    const cites = [...para.matchAll(cite)];
    if (cites.length === 0) continue;
    const ok = cites.every((m) => {
      const label = m[1]?.toUpperCase();
      const key = multi && label ? `${label} p. ${m[3]}` : `p. ${m[3]}`;
      return retrieved.has(key);
    });
    if (ok) kept.push(para.trim());
  }
  return kept.filter(Boolean).join("\n\n");
}

export const CITE_FALLBACK = "This reply did not cite a page in this session, so it was left out.";

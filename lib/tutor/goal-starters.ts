import type { OutlineItem } from "@/lib/types";

// Ready-made goals built from the PDFs' own tables of contents, so a student
// can start without facing a blank page (and without spending a prompt).

export type StarterDoc = { id: string; label: string; title: string; pageCount: number; outline: OutlineItem[] };
export type Chapter = { key: string; docId: string; docLabel: string; title: string; page: number };
export type StarterKind = "whole" | "chapters" | "overview" | "own";

const SKIP =
  /^(\d+(\.\d+)*\s*)?(contents|table of contents|preface|foreword|prologue|acknowledg|index|references|bibliography|further reading|cover|title page|half title|copyright|dedication|about the authors?|notation|symbols|list of (figures|tables)|glossary|front matter|back matter|epilogue|answers to|solutions to|blank page)\b/i;

// The chapter-level entries of one outline: the shallowest level, or the one
// below it when the top is just the book's own title.
export function chaptersOf(doc: StarterDoc): Chapter[] {
  const items = doc.outline.filter((o) => o.title.trim() && o.page >= 1 && !SKIP.test(o.title.trim()));
  if (!items.length) return [];
  const levels = [...new Set(items.map((o) => o.level))].sort((a, b) => a - b);
  let level = levels[0];
  if (items.filter((o) => o.level === level).length < 2 && levels.length > 1) level = levels[1];
  return items
    .filter((o) => o.level === level)
    .slice(0, 30)
    .map((o, i) => ({ key: `${doc.id}:${i}`, docId: doc.id, docLabel: doc.label, title: o.title.trim().replace(/\s+/g, " "), page: o.page }));
}

function titles(docs: StarterDoc[]) {
  const t = docs.map((d) => `"${d.title}"`);
  return t.length <= 1 ? (t[0] ?? "my PDFs") : `${t.slice(0, -1).join(", ")} and ${t.at(-1)}`;
}

export function starterGoal(kind: StarterKind, docs: StarterDoc[], picked: Chapter[] = []): string {
  if (kind === "whole") {
    return `Work through all of ${titles(docs)}, from start to finish.\n\nBy the end I want to explain every main idea in my own words and work through typical problems on each one.`;
  }
  if (kind === "overview") {
    return `Get the big picture of ${titles(docs)} first: the main ideas, how they connect, and which parts matter most.\n\nThen go deep on the parts that matter most, until I can explain them in my own words.`;
  }
  if (kind === "chapters") {
    // No table of contents to pick from: a template to fill in.
    if (!picked.length && !docs.some((d) => chaptersOf(d).length))
      return `Learn these parts of ${titles(docs)}:\n- (chapter or pages)\n- (chapter or pages)\n\nBy the end I want to explain their key ideas in my own words and work through typical problems on them.`;
    if (!picked.length) return "";
    const multi = docs.length > 1;
    const list = picked.map((c) => `- ${c.title}${multi ? ` (${c.docLabel})` : ""}, from p. ${c.page}`).join("\n");
    const from = multi ? "" : ` from ${titles(docs)}`;
    return `Learn these parts${from}:\n${list}\n\nBy the end I want to explain their key ideas in my own words and work through typical problems on them. Skip the rest unless I need it to understand these.`;
  }
  return "";
}

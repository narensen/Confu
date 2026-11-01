// One printed page from a topic the plan already has. No model call: the
// objectives and concepts are the plan's, and the excerpts are page text
// already stored for the tutor.

export type SheetTopic = {
  title: string;
  objectives: string[] | null;
  key_concepts: string[] | null;
  page_start: number | null;
  page_end: number | null;
};

export type SheetExcerpt = { page: number; text: string };

const EXCERPT_BUDGET = 1600;

export function sheetOf(topic: SheetTopic, pages: { page_number: number; content: string }[]): { objectives: string[]; concepts: string[]; excerpts: SheetExcerpt[] } {
  const objectives = (topic.objectives ?? []).map((o) => o.trim()).filter(Boolean).slice(0, 6);
  const concepts = (topic.key_concepts ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 12);
  const excerpts: SheetExcerpt[] = [];
  let left = EXCERPT_BUDGET;
  const ordered = [...pages].sort((a, b) => a.page_number - b.page_number).slice(0, 4);
  for (const p of ordered) {
    if (left < 80) break;
    const text = p.content.replace(/\s+/g, " ").trim().slice(0, Math.min(520, left));
    if (text.length < 40) continue;
    excerpts.push({ page: p.page_number, text });
    left -= text.length;
  }
  return { objectives, concepts, excerpts };
}

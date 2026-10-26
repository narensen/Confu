// Keshav's three-pass method ("How to Read a Paper", 2007), as data shared by
// the UI and the tutor's prompts.

export type PassNumber = 1 | 2 | 3;

export type PaperNotes = Record<string, string>;

export type PaperReview = {
  document_id: string;
  target_pass: PassNumber;
  passes_done: 0 | 1 | 2 | 3;
  triage_reason: string;
  pass1: PaperNotes;
  pass2: PaperNotes;
  pass3: PaperNotes;
};

export function emptyReview(documentId: string): PaperReview {
  return { document_id: documentId, target_pass: 1, passes_done: 0, triage_reason: "", pass1: {}, pass2: {}, pass3: {} };
}

// Study sessions can mix papers with other material. A document counts as a
// paper once it has review notes or was added by arXiv ID / DOI; anything up
// to this many pages can be marked as one by hand.
export const PAPER_MAX_PAGES = 80;

export function isPaperDoc(doc: { id: string; meta?: { doi?: unknown; arxiv_id?: unknown; paper_check?: unknown } | null }, reviews: Record<string, unknown>) {
  // The student's "Not a paper" wins (its pass notes are kept, in case they change their mind).
  if (doc.meta?.paper_check === "off") return false;
  return doc.id in reviews || Boolean(doc.meta?.doi || doc.meta?.arxiv_id);
}

export type PassField = { key: string; label: string; hint: string; rows?: number };

export type PassDef = {
  n: PassNumber;
  name: string;
  time: string;
  goal: string;
  checklist: string[];
  fields: PassField[];
  stopHere: string;
};

export const PASSES: PassDef[] = [
  {
    n: 1,
    name: "Bird's-eye view",
    time: "5–10 minutes",
    goal: "Decide what this paper is and whether it deserves more of your time.",
    checklist: [
      "Read the title, abstract and introduction",
      "Read the section and subsection headings, nothing else",
      "Read the conclusion",
      "Glance over the references and tick off the ones you've read",
    ],
    fields: [
      { key: "category", label: "Category", hint: "What kind of paper is it? A new method, a measurement, an analysis of an existing system, a survey…" },
      { key: "context", label: "Context", hint: "Which other papers does it build on? What theory or prior work does it use?" },
      { key: "correctness", label: "Correctness", hint: "Do the assumptions look valid?" },
      { key: "contributions", label: "Contributions", hint: "What's actually new? List the main contributions." },
      { key: "clarity", label: "Clarity", hint: "Is it well written?" },
    ],
    stopHere: "Most papers stop here. Promote it only if it's close to your work.",
  },
  {
    n: 2,
    name: "The content",
    time: "about an hour",
    goal: "Grasp the content well enough to summarise the main idea and its evidence to someone else.",
    checklist: [
      "Read it properly, but skip the proofs",
      "Study the figures: axes, units, error bars, and whether the comparisons are fair",
      "Note the key points in the margins",
      "Mark the references you haven't read",
    ],
    fields: [
      { key: "main_idea", label: "Main idea", hint: "Explain the paper's core idea in your own words, as if to a colleague.", rows: 4 },
      { key: "evidence", label: "Evidence", hint: "What supports the claims? Which experiments, datasets, baselines?", rows: 4 },
      { key: "figures", label: "Figures and comparisons", hint: "What do the key figures show? Are error bars reported? Are the baselines fair?", rows: 3 },
      { key: "references", label: "References to read", hint: "One per line: references you need to read next.", rows: 3 },
    ],
    stopHere: "Enough for related work. Go to pass three only if you'll implement or build on it.",
  },
  {
    n: 3,
    name: "Virtual re-implementation",
    time: "4–5 hours as a beginner",
    goal: "Rebuild the paper from its assumptions, in your head or notebook, and find where it breaks.",
    checklist: [
      "Re-derive the method from the same assumptions, without looking",
      "Compare your re-creation with the paper, line by line",
      "Challenge every assumption, step and experiment",
      "Write down what you'd do differently",
    ],
    fields: [
      { key: "derivation", label: "Re-derivation", hint: "Your reconstruction: the key equations and steps, in your own words.", rows: 5 },
      { key: "assumptions", label: "Hidden assumptions", hint: "What does the paper assume without saying so?", rows: 3 },
      { key: "missing", label: "Missing experiments", hint: "What should have been tested and wasn't?", rows: 3 },
      { key: "weaknesses", label: "Weaknesses", hint: "Where is the argument or evidence weakest?", rows: 3 },
      { key: "ideas", label: "Research ideas", hint: "The gaps you found are where your ideas come from. What would you try?", rows: 3 },
    ],
    stopHere: "You understand this paper deeply now, and its gaps are your opportunities.",
  },
];

export const passDef = (n: number) => PASSES[Math.min(3, Math.max(1, n)) - 1];

export function passNotes(review: PaperReview, n: PassNumber): PaperNotes {
  return n === 1 ? review.pass1 : n === 2 ? review.pass2 : review.pass3;
}

// Notes as plain text for the tutor's context.
export function notesText(review: PaperReview): string {
  const parts: string[] = [];
  for (const p of PASSES) {
    const notes = passNotes(review, p.n);
    const filled = p.fields.filter((f) => notes[f.key]?.trim());
    if (filled.length) parts.push(`Pass ${p.n} notes:\n${filled.map((f) => `  ${f.label}: ${notes[f.key].trim().slice(0, 600)}`).join("\n")}`);
  }
  return parts.join("\n") || "No notes yet.";
}

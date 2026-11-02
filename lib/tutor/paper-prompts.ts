import "server-only";
import { notesText, passDef, passNotes, PASSES, type PaperReview } from "@/lib/paper";
import type { LearnerMemory, TutorAction } from "@/lib/types";
import { DIAGRAM_RULE } from "@/lib/tutor/diagram";
import { CITE_THE_ANSWER, cite, citeScopeNote, type Excerpt, type FigureNote, type Material } from "@/lib/tutor/prompts";

function list(items: string[], empty = "none yet"): string {
  return items.length ? items.map((i) => `  - ${i}`).join("\n") : `  - ${empty}`;
}

function status(r: PaperReview) {
  const working = Math.min(3, r.passes_done + 1);
  return r.passes_done >= r.target_pass
    ? `target pass ${r.target_pass}, done`
    : `target pass ${r.target_pass}, ${r.passes_done} pass${r.passes_done === 1 ? "" : "es"} done, now on pass ${working}`;
}

export function buildPaperSystemPrompt(input: {
  sessionTitle: string;
  researchGoal: string;
  materials: Material[];
  reviews: Map<string, PaperReview>;
  focusDocId: string | null;
  memory: LearnerMemory;
  excerpts: Excerpt[];
  figures: FigureNote[];
  current: { label: string; page: number } | null;
  citeMode?: boolean;
  citeFiles?: { label: string; title: string }[];
}): string {
  const { sessionTitle, researchGoal, materials, reviews, focusDocId, memory, excerpts, figures, current, citeMode = false, citeFiles } = input;
  const focus = materials.find((m) => m.id === focusDocId);
  const focusReview = focus ? reviews.get(focus.id) : undefined;

  const readingList = materials.length
    ? materials
        .map((m) => {
          const r = reviews.get(m.id);
          return `${m.label}: "${m.title}" (${m.pageCount} pages) — ${r ? status(r) : "not triaged"}${r?.triage_reason ? ` — why: ${r.triage_reason}` : ""}`;
        })
        .join("\n")
    : "no papers yet";

  const focusBlock =
    focus && focusReview
      ? `## Paper in focus: ${focus.label} "${focus.title}"
Status: ${status(focusReview)}
${notesText(focusReview)}`
      : "## Paper in focus\nNone selected.";

  const excerptBlock = excerpts.length
    ? excerpts.map((e) => `[${cite(materials, e.label, e.page)}] (${e.reason})\n${e.text}`).join("\n\n---\n\n")
    : "(no matching text found — the PDF may be scanned; rely on figure notes or say what you cannot see)";

  const figureBlock = figures.length
    ? `\n\n## Figure notes (from images the researcher captured; produced by a vision model)\n${figures
        .map((f) => `[${cite(materials, f.label, f.page)} figure]\n${f.description}`)
        .join("\n\n")}`
    : "";

  return `You are Confu, a research-reading coach. You help ONE researcher read papers with S. Keshav's three-pass method ("How to Read a Paper"). This paper session is "${sessionTitle}".

## The method
${PASSES.map((p) => `- Pass ${p.n}, ${p.name} (${p.time}): ${p.goal} ${p.checklist.join("; ")}.${p.n === 1 ? " Answer the five Cs: Category, Context, Correctness, Contributions, Clarity." : ""} ${p.stopHere}`).join("\n")}

## Research goal
${researchGoal.trim() || "Not stated yet. If it would help, ask what they're researching."}

## Reading list
${readingList}

${focusBlock}

## What you know about this researcher
${memory.summary || "No history yet."}
Understands well:
${list(memory.understood)}
Struggling with:
${list(memory.struggling)}
Open questions:
${list(memory.open_questions)}
Already explained (don't repeat; build on it):
${list(memory.explained.slice(-20))}

## How you coach
1. MATCH THE PASS. Respect each paper's target pass. Don't drag a first-pass paper into proofs; in pass three, go all the way down.
2. THE RESEARCHER DOES THE THINKING. Especially in passes two and three, prefer pointed questions and critique over handing over answers. When they share notes, assess them honestly: what's right, what's missing, what's wrong.
3. GROUND IT, NEVER INVENT. Claims about this paper must come from the excerpts below; cite the page for each, exactly as the excerpt headers do, like (${cite(materials, materials[0]?.label, 4)}). You only see these excerpts, not the whole paper. If a section, figure, table, number or result isn't in them, say "I can't see that part; which page is it on?" or ask them to capture the figure. Never guess section numbers, figure numbers, results or statistics.${citeMode ? " Put one citation in each paragraph, in that same form. It can sit mid-sentence. If a paragraph cannot cite a page in this session, still write it, and end it with: Not cited from a page in this session." : ` You may use general knowledge of the field for context, labelled "From the wider literature:".`}${CITE_THE_ANSWER}
4. BE A SCEPTICAL REVIEWER. Question assumptions, baselines, statistical significance, ablations, data leakage and how far results generalise.
5. TIE IT TO THE GOAL. Point out what matters for their research goal, and when a paper deserves a deeper pass or doesn't.
${
    citeMode
      ? (citeFiles?.length ?? 0) > 1
        ? `6. STAY WITH THE FILES THEY CHOSE. Searching is off. Answer from the excerpts of those files. Don't invent a paper, author, year, or link.`
        : `6. STAY WITH THIS PAPER. Searching is off. Answer from the excerpts. Don't invent a paper, author, year, or link.`
      : `6. FIND PAPERS WHEN IT HELPS. Your tools find papers useful to this researcher: search_papers (related work, alternatives, "has this been done?"), get_paper (look one up), find_citing_papers (what came after). Use them only when they're asked to find papers or need one to answer; otherwise answer from the excerpts. One or two well-chosen searches beat many. Mention only papers the tools returned or that are in the reading list, never invent a paper, author or year, and link each one you mention as [Title](url). Describe a paper only by what its returned abstract says. If the results don't really answer the question, say so plainly ("I found nothing that directly does X; the closest is…") rather than stretching a paper to fit. Don't use tools for questions the paper itself answers.`
  }
7. BE CONCISE. Usually under 300 words. Use Markdown. Write math ONLY with $…$ (inline) and $$…$$ (display) — never \\( \\) or \\[ \\], and never split a formula across lines. No HTML tags (no <br>, <p>, or <div>): a new paragraph is a blank line. A Markdown table keeps each row on one single line: do not break a line inside a cell; separate points in a cell with a semicolon. Never put a sentence or a formula in backticks or a code fence. A code fence is only for real code, or one svg diagram. No filler.
8. DIAGRAMS. ${DIAGRAM_RULE}

## Paper excerpts${current ? ` (researcher is currently on ${cite(materials, current.label, current.page)})` : ""}
${citeScopeNote(materials, citeFiles)}${excerptBlock}${figureBlock}`;
}

function notesFor(review: PaperReview | undefined, n: 1 | 2 | 3): string {
  if (!review) return "";
  const notes = passNotes(review, n);
  return passDef(n)
    .fields.filter((f) => notes[f.key]?.trim())
    .map((f) => `${f.label}: ${notes[f.key].trim()}`)
    .join("\n");
}

// Instructions for the pass actions. Other actions (ask, summarize, figure…)
// use the regular instruction builder.
export function buildPaperInstruction(action: TutorAction, paper: Material | undefined, review: PaperReview | undefined, message?: string): string | null {
  const name = paper ? `${paper.label} "${paper.title}"` : "this paper";
  const extra = message?.trim() ? `\nAlso: ${message.trim()}` : "";
  const n1 = notesFor(review, 1);
  const n2 = notesFor(review, 2);
  const n3 = notesFor(review, 3);

  switch (action) {
    case "pass1_check":
      return n1
        ? `Here are my five Cs for ${name} after a first pass:\n"""\n${n1}\n"""\nCheck each C against the paper (abstract, introduction, headings, conclusion): what's right, what's missing, what's wrong. Then, given my research goal, tell me whether it deserves a second pass and why.${extra}`
        : `I'm starting a first pass on ${name}. Guide me through the five Cs one at a time with a pointed question each. Don't answer them for me.${extra}`;
    case "pass2_figures":
      return `Walk me through the key figures and tables of ${name} like a reviewer. For each: what it claims, how to read it (axes, units, error bars or variance), whether the comparisons and baselines are fair, and what's missing. Then ask me which result I find least convincing.${extra}`;
    case "pass2_check":
      return n2
        ? `Here's my second-pass explanation of ${name}:\n"""\n${n2}\n"""\nGrade it as if I were explaining the paper to a colleague: what's accurate, what's missing or wrong, anything I overstated. Then ask one question that tests whether I really understand the evidence.${extra}`
        : `I'm on the second pass of ${name}. Ask me to explain its main idea and evidence, one question at a time, and critique my answers.${extra}`;
    case "pass3_rebuild":
      return `Guide me through a virtual re-implementation of ${name}. Start from its problem setup and assumptions, then make me re-derive the method step by step: give me the goal of the next step and let me attempt it before you reveal how the paper does it.${n3 ? `\nMy pass-3 notes so far:\n"""\n${n3}\n"""` : ""}${extra}`;
    case "pass3_probe":
      return `Act as a sharp reviewer of ${name}.${n3 ? ` My pass-3 notes:\n"""\n${n3}\n"""\n` : " "}Probe for hidden assumptions, missing experiments and weaknesses I haven't already listed, citing pages. Then suggest two or three concrete research ideas these gaps open up, tied to my research goal.${extra}`;
    default:
      return null;
  }
}

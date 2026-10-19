import "server-only";
import type { LearnerMemory, PlanTopic, StudyPlan, TutorAction } from "@/lib/types";
import type { ScheduleStatus } from "@/lib/schedule";

// A PDF in the session, referred to by its label ("D1", "D2", …).
export type Material = { id: string; label: string; title: string; pageCount: number };
export type Excerpt = { label: string; page: number; text: string; reason: string };
export type FigureNote = { label: string; page: number; description: string };

// How the tutor cites a page: "p. 12" with one PDF, "D2 p. 12" with several.
export function cite(materials: Material[], label: string | undefined, page: number | string): string {
  return materials.length > 1 && label ? `${label} p. ${page}` : `p. ${page}`;
}

function list(items: string[], empty = "none yet"): string {
  return items.length ? items.map((i) => `  - ${i}`).join("\n") : `  - ${empty}`;
}

function topicWhere(t: PlanTopic, materials: Material[]): string {
  const m = materials.find((x) => x.id === t.document_id);
  if (t.source !== "pdf" || !t.page_start || !m) return "beyond the PDFs";
  return `${materials.length > 1 ? `${m.label} ` : ""}pp. ${t.page_start}–${t.page_end}`;
}

function topicLine(t: PlanTopic, materials: Material[]): string {
  return `#${t.position + 1} ${t.title} (${topicWhere(t, materials)}, due ${t.due_date})`;
}

export function buildSystemPrompt(input: {
  sessionTitle: string;
  materials: Material[];
  plan: StudyPlan | null;
  topics: PlanTopic[];
  topic: PlanTopic | null;
  schedule: ScheduleStatus | null;
  memory: LearnerMemory;
  excerpts: Excerpt[];
  figures: FigureNote[];
  current: { label: string; page: number } | null;
}): string {
  const { sessionTitle, materials, plan, topics, topic, schedule, memory, excerpts, figures, current } = input;
  const sorted = [...topics].sort((a, b) => a.position - b.position);
  const done = sorted.filter((t) => t.status === "completed");
  const next = topic ? sorted.find((t) => t.position > topic.position && t.status !== "completed") : null;

  const goalBlock = plan
    ? `## The student's goal
GOAL: ${plan.goal_title || plan.goal.slice(0, 200)}
${plan.goal_summary ? `SUCCESS LOOKS LIKE: ${plan.goal_summary}\n` : ""}FULL GOAL (student's words):
"""
${plan.goal.slice(0, 2500)}
"""
${plan.materials ? `OTHER MATERIALS THEY USE: ${plan.materials.slice(0, 600)}\n` : ""}LEVEL: ${plan.level}
DEADLINE: ${plan.deadline} (${schedule?.daysLeft ?? "?"} days left) — ${schedule?.completed ?? 0}/${schedule?.total ?? 0} topics complete — ${schedule?.label ?? ""}

CURRENT TOPIC: ${topic ? topicLine(topic, materials) : "all topics complete — consolidate and review"}
${topic ? `  Objectives:\n${list(topic.objectives)}\n  Key concepts:\n${list(topic.key_concepts)}\n  Mastery so far: ${Math.round(topic.mastery * 100)}%${topic.resources?.length ? `\n  Suggested resources:\n${list(topic.resources.map((r) => `${r.type}: ${r.title}`))}` : ""}` : ""}
NEXT TOPIC: ${next ? topicLine(next, materials) : "none"}
COMPLETED TOPICS (foundations — reference, don't re-teach): ${done.length ? done.map((t) => t.title).join("; ") : "none yet"}`
    : `## The student's goal
No study plan yet. Help with what they ask, grounded in their PDFs.`;

  const memoryBlock = `## What you know about this student
${memory.summary || "No history yet — this may be their first session."}
Understands well:
${list(memory.understood)}
Struggling with:
${list(memory.struggling)}
Misconceptions to gently correct:
${list(memory.misconceptions)}
Open questions they raised earlier:
${list(memory.open_questions)}
Already explained to them (do NOT explain again from scratch):
${list(memory.explained.slice(-20))}`;

  const excerptBlock = excerpts.length
    ? excerpts.map((e) => `[${cite(materials, e.label, e.page)}] (${e.reason})\n${e.text}`).join("\n\n---\n\n")
    : "(no matching text found — the PDFs may be scanned; rely on figure notes or say what you cannot see)";

  const figureBlock = figures.length
    ? `\n\n## Figure notes (from images the student captured; produced by a vision model)\n${figures
        .map((f) => `[${cite(materials, f.label, f.page)} figure]\n${f.description}`)
        .join("\n\n")}`
    : "";

  return `You are Confu, a rigorous and warm tutor. You help ONE student reach a learning goal by a deadline. This study session is "${sessionTitle}". Their primary materials are the PDFs listed below, but the goal is bigger than any document: lectures, prerequisites and practice beyond the PDFs are part of the journey. You are not a search engine and not a summariser — your job is durable understanding.

## Materials (PDFs in this session)
${materials.length ? materials.map((m) => `${m.label}: "${m.title}" (${m.pageCount} pages)`).join("\n") : "none uploaded yet"}

${goalBlock}

${memoryBlock}

## How you teach
1. GROUND IT, THEN GO BEYOND. When the PDFs cover the point, build on the excerpts below and ALWAYS cite the page(s) exactly as the excerpt headers do, like (${cite(materials, materials[0]?.label, 12)}). When the topic or question goes beyond the PDF (expected for "beyond the PDFs" topics), teach it fully from your own knowledge, say plainly that it isn't in the PDFs, and point to the topic's suggested resources for more. Never invent page numbers.
2. GO DEEP, NOT WIDE. Pitch it at the student's LEVEL — for beginners, lead with intuition and plain words before any notation. Explain the *why* and the mechanism, not just the *what*. Connect new ideas to what the student already understands. Use one concrete example, analogy, or worked step when it helps. Point out the common trap.
3. DON'T REPEAT YOURSELF. If a concept is in "Already explained" or "Understands well", refer to it in one line and build one level deeper, or move forward. If the student is stuck on the same point again, change the representation (example → analogy → step-by-step → contrast with a near-miss) instead of rephrasing the same explanation.
4. STAY ON THE GOAL. Everything should serve the goal and the current topic. If a question is off-goal, answer it briefly (≤3 sentences), then tie it back to the current topic. Do not drift into tangents you start yourself.
5. KEEP MOMENTUM. When the student shows they've got the current topic's objectives, say so plainly and point them to the next topic rather than circling.
6. CHECK, DON'T LECTURE. End with at most ONE short question that makes them think (why / how / what-if / apply) — or, if they just answered one of your questions, assess the answer honestly first: what's right, what's missing, the precise fix.
7. BE CONCISE. Usually under 250 words. Use Markdown and short paragraphs. Write math ONLY with $…$ (inline) and $$…$$ (display) — never \\( \\) or \\[ \\]. No filler, no "Great question!".

## Document excerpts${current ? ` (student is currently on ${cite(materials, current.label, current.page)})` : ""}
${excerptBlock}${figureBlock}`;
}

// The instruction sent to the model for one turn. Separate from the
// display text so the model gets precise guidance per action.
export function buildUserInstruction(input: {
  action: TutorAction;
  message?: string;
  materials: Material[];
  selection?: { text: string; page: number; label?: string } | null;
  topic: PlanTopic | null;
  figure?: { page: number; label?: string; description: string } | null;
}): string {
  const { action, message, materials, selection, topic, figure } = input;
  const q = message?.trim();
  const passage = selection
    ? `Highlighted passage (${cite(materials, selection.label, selection.page)}):\n"""\n${selection.text.slice(0, 6000)}\n"""\n\n`
    : "";
  const where = topic ? topicWhere(topic, materials) : "";
  const topicName = topic
    ? `"${topic.title}" (${where === "beyond the PDFs" ? "beyond the PDFs — teach it from your own knowledge" : where})`
    : "the material";

  switch (action) {
    case "ask":
      return `${passage}My doubt about this passage: ${q || "I don't understand it. What is it really saying?"}`;
    case "summarize":
      return `${passage}Summarise this passage for my goal: the core claim, how it is supported, and the one thing I must retain. Note what it depends on if that's not obvious.${q ? `\nAlso: ${q}` : ""}`;
    case "context":
      return `${passage}Help me understand the context of this passage: what problem it addresses, which earlier ideas it relies on (cite pages), what it sets up next, and why it matters for my goal.${q ? `\nAlso: ${q}` : ""}`;
    case "simplify":
      return `${passage}Explain this passage in plain language, step by step, with one concrete example. Then restate it precisely in the document's terms so I can connect the two.${q ? `\nAlso: ${q}` : ""}`;
    case "figure":
      return `I captured a region on ${figure ? cite(materials, figure.label, figure.page) : "a page"} (figure, table, diagram or equation).
Vision notes:
"""
${figure?.description ?? "(not available)"}
"""

${q || "Help me read this: what it shows, how to read it (axes, symbols, arrows, units), the key takeaway, and how it connects to the surrounding text and my goal."}`;
    case "quiz":
      return `Check my understanding of ${topicName}. Ask me ONE question that tests understanding (why / how / apply / predict), not recall, targeting an objective I haven't clearly demonstrated yet. Do not reveal the answer.${q ? `\nFocus: ${q}` : ""}`;
    case "teach":
      return `Teach me ${topicName}. Pick up from what I already know (see memory) and teach the next most important idea I haven't covered, grounded in the PDF pages when the topic has them. Keep it to one idea, then ask me one check question.${q ? `\nNote: ${q}` : ""}`;
    case "chat":
    default:
      return `${passage}${q ?? ""}`;
  }
}

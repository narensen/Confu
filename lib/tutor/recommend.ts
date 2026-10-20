import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MODELS, parseJsonObject, type Groq } from "@/lib/groq";
import { findByTitle, papersByArxivIds, sameTitle, searchPapers, titleWithin, type PaperMeta } from "@/lib/scholar";

// Paper recommendations for "I want to get into research on X".
//
//   1. Context: what the reader has already studied in Confu (sessions, goals,
//      what the tutor knows they understand, papers read and how deeply).
//   2. A planner model turns goal + background into targeted literature
//      searches (foundations, core methods, recent work, surveys) and names
//      the canonical papers it knows, which are only kept if a search finds
//      a paper with that exact title.
//   3. Real search APIs return real papers (Semantic Scholar / arXiv / OpenAlex).
//   4. A recommender model picks and orders a reading path from those results
//      only, by id, so it can never suggest a paper that doesn't exist.

export type Stage = "start" | "core" | "frontier";
export type Recommendation = { paper: PaperMeta; stage: Stage; pass: 1 | 2 | 3; why: string };

const clip = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// What this reader has studied in Confu, as a compact brief for the models.
export async function learnerBackground(supabase: SupabaseClient, userId: string) {
  const [profile, sessions, memories, docs, reviews] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("study_sessions").select("id, title, kind, research_goal").eq("user_id", userId).order("updated_at", { ascending: false }).limit(15),
    supabase.from("learner_memory").select("session_id, summary, understood, struggling").eq("user_id", userId).limit(15),
    supabase.from("documents").select("id, session_id, title").eq("user_id", userId).limit(200),
    supabase.from("paper_reviews").select("document_id, passes_done").eq("user_id", userId).limit(200),
  ]);

  const p = (profile.data ?? {}) as { occupation?: string | null; purpose?: string | null; purpose_detail?: string | null };
  const memoryBy = new Map(((memories.data ?? []) as { session_id: string; summary: string; understood: string[]; struggling: string[] }[]).map((m) => [m.session_id, m]));
  const passesBy = new Map(((reviews.data ?? []) as { document_id: string; passes_done: number }[]).map((r) => [r.document_id, r.passes_done]));
  const allDocs = (docs.data ?? []) as { id: string; session_id: string; title: string }[];

  const lines: string[] = [];
  if (p.occupation) lines.push(`They are: ${p.occupation}.`);
  if (p.purpose || p.purpose_detail) lines.push(`They use Confu for: ${[p.purpose, p.purpose_detail].filter(Boolean).join(" — ")}.`);
  for (const s of (sessions.data ?? []) as { id: string; title: string; kind: string; research_goal: string }[]) {
    const m = memoryBy.get(s.id);
    const sDocs = allDocs.filter((d) => d.session_id === s.id);
    const parts = [`- ${s.kind === "paper" ? "Paper reading" : s.kind === "exam" ? "Exam prep" : "Study"}: "${clip(s.title, 80)}"`];
    if (s.research_goal) parts.push(`goal: ${clip(s.research_goal, 200)}`);
    if (m?.summary) parts.push(`tutor's notes: ${clip(m.summary, 220)}`);
    if (m?.understood?.length) parts.push(`understands: ${m.understood.slice(0, 6).map((x) => clip(x, 60)).join("; ")}`);
    if (m?.struggling?.length) parts.push(`shaky on: ${m.struggling.slice(0, 4).map((x) => clip(x, 60)).join("; ")}`);
    if (sDocs.length) {
      parts.push(
        `material: ${sDocs
          .slice(0, 8)
          .map((d) => `"${clip(d.title, 70)}"${passesBy.has(d.id) ? ` (${passesBy.get(d.id)} of 3 passes read)` : ""}`)
          .join(", ")}`,
      );
    }
    lines.push(parts.join(" | "));
  }
  return { brief: lines.join("\n").slice(0, 5000), knownTitles: allDocs.map((d) => d.title) };
}

const Plan = z.object({
  level: z.string().catch(""),
  queries: z
    .array(
      z.object({
        q: z.string().min(3).max(200),
        stage: z.enum(["start", "core", "frontier"]).catch("core"),
        recent: z.boolean().catch(false),
      }),
    )
    .min(1)
    .max(8),
  classics: z
    .array(
      z.object({
        title: z.string().min(4).max(300),
        year: z.coerce.number().int().nullable().catch(null),
        arxiv: z.string().nullable().catch(null),
        stage: z.enum(["start", "core", "frontier"]).catch("start"),
      }),
    )
    .max(10)
    .catch([]),
});

const Picks = z.object({
  summary: z.string().catch(""),
  picks: z
    .array(
      z.object({
        id: z.string(),
        stage: z.enum(["start", "core", "frontier"]).catch("core"),
        pass: z.coerce.number().int().min(1).max(3).catch(1),
        why: z.string().max(600).catch(""),
      }),
    )
    .max(14),
});

async function json<T>(groq: Groq, schema: z.ZodType<T>, prompt: string, effort: "low" | "medium", maxTokens = 3500): Promise<T> {
  const ask = (e: "low" | "medium") =>
    groq.chat.completions.create({
      model: MODELS.chat,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_completion_tokens: maxTokens,
      reasoning_effort: e,
    });
  let res;
  try {
    res = await ask(effort);
  } catch (err) {
    // Reasoning can use up the budget before any JSON is written: retry lighter.
    if ((err as { status?: number }).status !== 400 || effort === "low") throw err;
    res = await ask("low");
  }
  return schema.parse(parseJsonObject(res.choices[0]?.message?.content ?? ""));
}

export async function recommendPapers(
  groq: Groq,
  opts: { goal: string; background: string; knownTitles: string[]; onStatus?: (s: string) => void; onPlan?: (plan: unknown) => void },
): Promise<{ summary: string; items: Recommendation[] }> {
  const year = new Date().getFullYear();

  // 1. Plan the literature search.
  opts.onStatus?.("Planning the search…");
  const plan = await json(
    groq,
    Plan,
    `You plan literature searches for someone who wants to get into research in a field.

THEIR GOAL:
"""
${opts.goal}
"""

WHAT THEY HAVE ALREADY STUDIED (from their learning history; may be empty):
"""
${opts.background || "Nothing recorded yet."}
"""

Judge their level from the history (don't re-teach what they've shown they understand; fill gaps they're shaky on). Then write 6 search queries for an academic search engine (Semantic Scholar / arXiv), each 3–8 words of precise technical terms, no quotes or boolean operators:
- 2 "start": the foundational or seminal papers and a good survey for this goal, at their level.
- 2 "core": the main methods/ideas someone in this area must know.
- 2 "frontier": recent work and open problems (set "recent": true).
Also list up to 8 "classics": the specific, well-known papers a researcher in this exact area is expected to have read, including the papers that introduced the methods named in the goal and the recent landmark results. Recall each by its first author, lab and year, then give its exact published title and, if it's on arXiv, its arXiv ID (e.g. "1707.06347"). No generic or descriptive titles: every paper is checked against arXiv and the literature, and any whose ID and title don't match are discarded.
Return ONLY JSON: {"level": "one sentence on where they are", "queries": [{"q": "string", "stage": "start" | "core" | "frontier", "recent": boolean}], "classics": [{"title": "string", "year": number, "arxiv": "string or null", "stage": "start" | "core" | "frontier"}]}`,
    "medium",
  );

  opts.onPlan?.(plan);

  // 2. Search for real papers.
  opts.onStatus?.("Searching the literature…");
  const pool: { paper: PaperMeta; stage: Stage; classic?: boolean }[] = [];
  const add = (paper: PaperMeta, stage: Stage, classic = false) => {
    if (!paper.title || pool.some((x) => sameTitle(x.paper.title, paper.title))) return;
    if (opts.knownTitles.some((t) => sameTitle(t, paper.title))) return; // already in their library
    pool.push({ paper, stage, classic });
  };

  // Named classics first, kept only when verified: by arXiv ID (one batch
  // lookup; the record's title must match the claimed one), else by title.
  const classics = plan.classics.slice(0, 8);
  const fromArxiv = await papersByArxivIds(classics.flatMap((c) => (c.arxiv ? [c.arxiv] : []))).catch(() => [] as PaperMeta[]);
  const unverified: typeof classics = [];
  for (const c of classics) {
    // The arXiv record is authoritative; it must be the paper the model meant.
    const match = fromArxiv.find((p) => sameTitle(p.title, c.title) || titleWithin(c.title, p.title));
    if (match) add(match, c.stage, true);
    else unverified.push(c);
  }
  const byTitle = await Promise.all(unverified.slice(0, 4).map((c) => findByTitle(c.title, { arxiv: false }).catch(() => null)));
  byTitle.forEach((match, j) => {
    const want = unverified[j];
    // A generic title can match a different paper: the year must agree too.
    if (match && (!want.year || !match.year || Math.abs(want.year - match.year) <= 1)) add(match, want.stage, true);
  });
  const landmarks = pool.length;
  opts.onStatus?.(`Verified ${landmarks} landmark paper${landmarks === 1 ? "" : "s"}; searching for more…`);

  const queries = plan.queries.slice(0, 6);
  for (let i = 0; i < queries.length; i += 3) {
    const batch = await Promise.all(
      queries.slice(i, i + 3).map((q) => searchPapers(q.q, 8, q.recent ? year - 3 : undefined, { arxiv: false }).catch(() => [] as PaperMeta[])),
    );
    batch.forEach((results, j) => results.forEach((paper) => add(paper, queries[i + j].stage)));
  }
  // Search services exhausted (no API keys, shared limits): fall back to arXiv
  // alone, one query every few seconds as it asks. Slower, but still real papers.
  if (pool.length < 8) {
    opts.onStatus?.("Search is busy; asking arXiv directly (a little slower)…");
    for (const q of queries.slice(0, 4)) {
      await new Promise((r) => setTimeout(r, 3100));
      (await searchPapers(q.q, 8, q.recent ? year - 3 : undefined).catch(() => [] as PaperMeta[])).forEach((p) => add(p, q.stage));
    }
  }
  if (!pool.length) return { summary: "The paper search services didn't return anything just now. Try again in a minute, or rephrase your goal.", items: [] };

  // 3. Pick and order a reading path from those papers only.
  opts.onStatus?.(`Choosing your reading path from ${pool.length} papers…`);
  // Kept small: Groq's free tier allows 8k tokens a minute, and one request must fit.
  const candidates = pool.slice(0, 30).map((c, i) => ({ ...c, id: `P${i + 1}` }));
  const list = candidates
    .map(
      (c) =>
        `[${c.id}] (${c.classic ? "a landmark paper in this area" : `found searching for ${c.stage}`}) "${c.paper.title}" — ${c.paper.authors.slice(0, 3).join(", ")}${c.paper.authors.length > 3 ? " et al." : ""}, ${c.paper.year ?? "n.d."}${c.paper.venue ? `, ${c.paper.venue}` : ""}${c.paper.cited_by != null ? `, ${c.paper.cited_by} citations` : ""}\n${clip(c.paper.abstract, 240) || "(no abstract)"}`,
    )
    .join("\n\n");

  const picked = await json(
    groq,
    Picks,
    `You are a research mentor building a reading path for one person. Recommend papers ONLY from the candidate list below, referring to them by id. Never invent papers.

THEIR GOAL:
"""
${opts.goal}
"""

WHERE THEY ARE: ${plan.level || "unknown"}
WHAT THEY HAVE STUDIED:
"""
${opts.background || "Nothing recorded yet."}
"""

CANDIDATES (real search results; some are off-topic or weak, skip those):
${list}

Choose 6–10 papers that together take them from where they are to the research frontier of their goal:
- "start": 2–3 foundational/seminal papers or one strong survey, at their level. Skip basics they already know.
- "core": 2–4 key methods papers they must understand deeply.
- Papers marked "a landmark paper in this area" are the field's canonical works: include every one that fits the goal (they make up most of "start" and "core"); a recent paper with few citations should not displace a landmark.
- "frontier": 2–3 recent papers (last ~3 years) showing open problems or the current state of the art.
For each: "pass" = how deep to read with Keshav's three-pass method (3 only for what they'll build on, 1 for context), and "why": one or two sentences, specific to THIS person (link to what they studied or are missing). Only say what a paper does if its title or abstract above says so; never credit it with a method or result it doesn't state. Plain text, no Markdown.
Order picks in the sequence they should read them.
"summary": 2 sentences on the path and where it leads. If the candidates are poor for the goal, pick fewer and say so in the summary.
Return ONLY JSON: {"summary": "string", "picks": [{"id": "P3", "stage": "start" | "core" | "frontier", "pass": 1 | 2 | 3, "why": "string"}]}`,
    "medium",
  );

  const byId = new Map(candidates.map((c) => [c.id.toLowerCase(), c]));
  const seen = new Set<string>();
  const items: Recommendation[] = [];
  for (const p of picked.picks) {
    const c = byId.get(p.id.trim().toLowerCase());
    if (!c || seen.has(c.id)) continue; // unknown id: ignore, never trust a made-up paper
    seen.add(c.id);
    items.push({ paper: c.paper, stage: p.stage, pass: p.pass as 1 | 2 | 3, why: p.why.trim() });
  }
  return { summary: picked.summary.trim(), items };
}

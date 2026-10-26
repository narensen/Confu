import { after } from "next/server";
import { z } from "zod";
import { groqErrorResponse, resolveGroq } from "@/lib/ai-access";
import { MODELS, parseJsonObject } from "@/lib/groq";
import { logError } from "@/lib/log";
import { arxivByName, findByTitle, norm, openAlexByName, papersByArxivIds, resolvePaper, sameTitle, type PaperMeta } from "@/lib/scholar";
import { videoIdFrom } from "@/lib/import/youtube";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({ sessionId: z.uuid() });
const Named = z.object({
  field: z.string().catch(""), // the goal's research field, to search with
  papers: z
    .array(
      z.object({
        name: z.string().catch(""), // as the goal writes it: "PPO", "Dr. GRPO"
        title: z.string().catch(""), // as the goal writes it, or if the model is certain
        arxiv: z.string().catch(""), // only if the model is certain
        doi: z.string().catch(""), // as the goal writes it
      }),
    )
    .catch([]),
});

// What the goal says about the paper (to search by when it isn't found), and what was found.
type GoalPaper = { name: string; title?: string; doi?: string; arxiv?: string; paper: PaperMeta | null; candidates: PaperMeta[] };
type GoalLink = { url: string; kind: "youtube" | "web" };

// The papers a study goal names, by full title or by nickname ("PPO",
// "DeepSeekMath (GRPO)", "Dr. GRPO"), found on arXiv, Semantic Scholar and
// OpenAlex so they can be added in one click. A paper that can't be pinned
// down comes back with its likeliest matches for the student to pick from;
// nothing named is silently dropped. Links in the goal (lectures, pages) come
// back too, to import. Papers already in the session are left out.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId } = parsed.data;

  const [{ data: plan }, { data: docs }] = await Promise.all([
    supabase.from("study_plans").select("goal, goal_title, materials").eq("session_id", sessionId).maybeSingle(),
    supabase.from("documents").select("title, source_url").eq("session_id", sessionId),
  ]);
  const goal = [plan?.goal_title, plan?.goal, plan?.materials].filter(Boolean).join("\n").trim();
  if (goal.length < 8) return Response.json({ papers: [], links: [] });
  const have = (docs ?? []) as { title: string; source_url: string | null }[];

  // Links: lectures and pages written into the goal.
  const links: GoalLink[] = [];
  for (const m of goal.matchAll(/https?:\/\/[^\s<>()"'`\]]+/g)) {
    const url = m[0].replace(/[.,;:!?)]+$/, "");
    if (/arxiv\.org|doi\.org/i.test(url) || links.some((l) => l.url === url) || have.some((h) => h.source_url === url)) continue;
    links.push({ url, kind: videoIdFrom(url) ? "youtube" : "web" });
  }

  const access = await resolveGroq(supabase, userId, sessionId, "recommend");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  let named: z.infer<typeof Named>;
  try {
    const res = await access.groq.chat.completions.create({
      model: MODELS.chat,
      messages: [{ role: "user", content: extractPrompt(goal) }],
      response_format: { type: "json_object" },
      temperature: 0,
      max_completion_tokens: 2500,
      reasoning_effort: "medium",
    });
    named = Named.parse(parseJsonObject(res.choices[0]?.message?.content ?? ""));
  } catch (err) {
    if ((err as { status?: number })?.status) return groqErrorResponse(err, "Couldn't read the papers in your goal.");
    logError("goal papers failed", err);
    return Response.json({ papers: [], links });
  }

  const wants = named.papers.filter((p) => p.name.trim() || p.title.trim()).slice(0, 15);
  return Response.json({ papers: await findNamed(wants, named.field, have.map((h) => h.title)), links });
}

export function extractPrompt(goal: string) {
  return `A student wrote this study goal:
"""
${goal.slice(0, 6000)}
"""

List EVERY research paper it names or clearly refers to, including ones given only by an acronym or nickname (DQN, GAE, PPO, "DeepSeekMath (GRPO)", "Dr. GRPO"). Don't leave any out. Leave out textbooks, courses, lectures, blog posts and guides.

For each paper:
- name: exactly as the goal writes it
- title: its full title as the goal writes it; if the goal gives only a nickname, its full published title ONLY if you are certain of it (many papers are newer than what you know), else ""
- arxiv: its arXiv id (like 1707.06347) as the goal writes it, or ONLY if you are certain, else ""
- doi: its DOI (like 10.48550/arXiv.1707.06347) exactly as the goal writes it, else ""

Also give "field": the research area these papers belong to, in 3 to 8 plain words (for example "reinforcement learning for large language models").

Return ONLY JSON: {"field": "", "papers": [{"name": "", "title": "", "arxiv": "", "doi": ""}]}`;
}

// How well a search result matches what the goal names. The name often isn't
// in the title ("Dr. GRPO" is "Understanding R1-Zero-Like Training"), so the
// abstract counts too. Words from the goal's field must appear somewhere, which
// keeps same-named papers from other fields out (a "ReLIFT converter").
type Want = { name: string; title: string; arxiv: string; doi: string };

const nameOf = (w: Want) => norm(w.name.replace(/\(.*?\)/g, " "));
// arXiv's own DOIs (10.48550/arXiv.1707.06347) are looked up as arXiv ids.
const arxivOf = (w: Want) => (w.arxiv.trim() || w.doi.match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i)?.[1] || "").replace(/v\d+$/, "");
const doiOf = (w: Want) => (arxivOf(w) ? "" : (w.doi.match(/10\.\d{4,9}\/[^\s"<>]+/)?.[0] ?? "").replace(/[.,;)\]]+$/, ""));

function score(p: PaperMeta, want: Want, field: string[]) {
  const name = nameOf(want);
  const title = norm(p.title);
  const abstract = norm(p.abstract ?? "");
  let s = 0;
  let sure = false; // strong enough to pick without asking
  if (want.title && sameTitle(p.title, want.title)) {
    s += 6;
    sure = true;
  }
  // An id or DOI counts only if the title agrees: models (and goals drafted
  // with them) misremember ids.
  const titleAgrees = !want.title || sameTitle(p.title, want.title);
  if (arxivOf(want) && p.arxiv_id === arxivOf(want) && titleAgrees) sure = true;
  if (doiOf(want) && p.doi?.toLowerCase() === doiOf(want).toLowerCase() && titleAgrees) sure = true;
  if (name.length >= 3) {
    if (title.startsWith(`${name} `) || title === name) {
      s += 4;
      // "DAPO: An Open-Source…" names the paper; "DeepSeekMath-V2: …" is a sequel.
      const raw = p.title.toLowerCase().replace(/\s+/g, " ").trim();
      const spelled = want.name.replace(/\(.*?\)/g, " ").toLowerCase().replace(/\s+/g, " ").trim();
      if (raw === spelled || raw.startsWith(`${spelled}:`) || raw.startsWith(`${spelled} :`)) {
        s += 1;
        sure = true;
      }
    }
    if (` ${abstract} `.includes(` ${name} `) || ` ${title} `.includes(` ${name} `)) s += 3;
  }
  // Off-topic papers sharing the name are out, unless it's the exact title the model knows.
  const onTopic = !field.length || field.some((w) => title.includes(w) || abstract.includes(w)) || Boolean(want.title && sameTitle(p.title, want.title));
  return { s, onTopic, sure };
}

// Best first; ties go to the original: more cited, then older (a follow-up
// called "Improving DAPO…" is newer and less cited than DAPO).
function rank(found: PaperMeta[], want: Want, field: string[]) {
  return found
    .map((p) => ({ p, ...score(p, want, field) }))
    .filter((r) => r.onTopic)
    .sort((a, b) => b.s - a.s || (b.p.cited_by ?? 0) - (a.p.cited_by ?? 0) || (a.p.year ?? 9999) - (b.p.year ?? 9999));
}

// Run tasks a few at a time.
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

export async function findNamed(wants: Want[], fieldText: string, haveTitles: string[]): Promise<GoalPaper[]> {
  // Topic words that actually say which field (not "methods" or "algorithms").
  const generic = new Set(["learning", "paper", "papers", "research", "methods", "method", "algorithms", "algorithm", "optimization", "models", "model", "systems", "approaches", "techniques", "analysis", "theory", "applications", "deep", "large", "based", "data", "study"]);
  const field = [...new Set(norm(fieldText).split(" "))].filter((w) => w.length > 3 && !generic.has(w));
  const todo = wants.filter((w) => !haveTitles.some((h) => (w.title && sameTitle(h, w.title)) || (nameOf(w).length >= 3 && norm(h).startsWith(`${nameOf(w)} `))));
  const found: PaperMeta[][] = todo.map(() => []);
  const add = (i: number, list: PaperMeta[]) => found[i].push(...list.filter((f) => !found[i].some((x) => sameTitle(x.title, f.title))));
  // Picked only on strong evidence; otherwise the student chooses.
  const picked = (i: number) => {
    const top = rank(found[i], todo[i], field)[0];
    return top && top.sure ? top.p : null;
  };

  // 1. arXiv ids (given, or in an arXiv DOI): one batch lookup. Other DOIs
  //    through Crossref, three at a time.
  const ids = await papersByArxivIds(todo.map(arxivOf).filter(Boolean)).catch(() => []);
  todo.forEach((w, i) => add(i, ids.filter((p) => p.arxiv_id === arxivOf(w))));
  await pool([...todo.keys()].filter((i) => doiOf(todo[i])), 3, async (i) => {
    add(i, await resolvePaper(doiOf(todo[i])).catch(() => []));
  });
  // 2. For the rest, three at a time: titles the model is sure of, then
  //    OpenAlex by name and field (fast, generous limits).
  await pool([...todo.keys()], 3, async (i) => {
    if (picked(i)) return;
    const w = todo[i];
    if (w.title) {
      const t = await findByTitle(w.title, { arxiv: false }).catch(() => null);
      if (t) add(i, [t]);
      if (picked(i)) return;
    }
    add(i, await openAlexByName(w.name.replace(/\(.*?\)/g, " "), field.slice(0, 2).join(" ")).catch(() => []));
  });

  // 3. Still unsure: arXiv by name in title or abstract, for papers too new for
  //    OpenAlex. arXiv allows one request every few seconds, so at most three.
  for (const i of [...todo.keys()].filter((i) => !picked(i) && nameOf(todo[i]).length >= 3).slice(0, 3)) {
    add(i, await arxivByName(todo[i].name.replace(/\(.*?\)/g, " ")).catch(() => []));
  }

  // Papers with the same name ("DAPO" twice): the more cited one is the one
  // people mean. arXiv gives no citation counts, so look them up for the tie.
  await pool([...todo.keys()], 3, async (i) => {
    const ranked = rank(found[i], todo[i], field);
    const tied = ranked.filter((r) => r.s >= 3 && r.s === ranked[0]?.s && r.p.cited_by == null);
    if (tied.length < 2) return;
    await Promise.all(
      tied.slice(0, 3).map(async (r) => {
        const known = await findByTitle(r.p.title, { arxiv: false }).catch(() => null);
        r.p.cited_by = known && sameTitle(known.title, r.p.title) ? (known.cited_by ?? 0) : 0;
      }),
    );
  });

  const results: GoalPaper[] = [];
  todo.forEach((w, i) => {
    const paper = picked(i);
    if (paper && (haveTitles.some((h) => sameTitle(h, paper.title)) || results.some((r) => r.paper && sameTitle(r.paper.title, paper.title)))) return;
    results.push({
      name: w.name.trim() || w.title.trim(),
      ...(w.title.trim() ? { title: w.title.trim() } : {}),
      ...(doiOf(w) ? { doi: doiOf(w) } : {}),
      ...(arxivOf(w) ? { arxiv: arxivOf(w) } : {}),
      paper,
      candidates: paper ? [] : rank(found[i], w, field).slice(0, 3).map((r) => r.p),
    });
  });
  return results;
}

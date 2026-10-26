import { after } from "next/server";
import { z } from "zod";
import { groqErrorResponse, resolveGroq } from "@/lib/ai-access";
import { MODELS, parseJsonObject } from "@/lib/groq";
import { logError } from "@/lib/log";
import { findByTitle, sameTitle, type PaperMeta } from "@/lib/scholar";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({ sessionId: z.uuid() });
const Named = z.object({ papers: z.array(z.object({ title: z.string().catch("") })).catch([]) });

// The papers a study goal names ("read Attention Is All You Need and the PPO
// paper"), found on Semantic Scholar / OpenAlex so they can be added in one
// click. Only papers verified by title come back; what the goal names but
// couldn't be found is listed by name. Papers already in the session are left out.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId } = parsed.data;

  const [{ data: plan }, { data: docs }] = await Promise.all([
    supabase.from("study_plans").select("goal, goal_title").eq("session_id", sessionId).maybeSingle(),
    supabase.from("documents").select("title").eq("session_id", sessionId),
  ]);
  const goal = [plan?.goal_title, plan?.goal].filter(Boolean).join("\n").trim();
  if (goal.length < 8) return Response.json({ papers: [], unresolved: [] });

  const access = await resolveGroq(supabase, userId, sessionId, "recommend");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  let titles: string[];
  try {
    const res = await access.groq.chat.completions.create({
      // The small model invents plausible titles; this one leaves out what it isn't sure of.
      model: MODELS.chat,
      messages: [
        {
          role: "user",
          content: `A student wrote this study goal:
"""
${goal.slice(0, 3000)}
"""

List the research papers it names or unmistakably refers to, by their full, exact published title. "The PPO paper" means "Proximal Policy Optimization Algorithms"; "the transformer paper" means "Attention Is All You Need". Leave out topics, books, courses, people and anything you're not sure is one specific paper. Most goals name none: then return an empty list.
Return ONLY JSON: {"papers": [{"title": "string"}]}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_completion_tokens: 1500,
      reasoning_effort: "medium",
    });
    titles = Named.parse(parseJsonObject(res.choices[0]?.message?.content ?? ""))
      .papers.map((p) => p.title.trim())
      .filter((t) => t.split(/\s+/).length >= 2)
      .slice(0, 10);
  } catch (err) {
    if ((err as { status?: number })?.status) return groqErrorResponse(err, "Couldn't read the papers in your goal.");
    logError("goal papers failed", err);
    return Response.json({ papers: [], unresolved: [] });
  }

  const have = ((docs ?? []) as { title: string }[]).map((d) => d.title);
  const papers: PaperMeta[] = [];
  const unresolved: string[] = [];
  const wanted = titles.filter((t) => !have.some((h) => sameTitle(h, t)));
  // Three at a time: a lookup can take several seconds.
  const lookups: (PaperMeta | null)[] = [];
  for (let i = 0; i < wanted.length; i += 3) {
    lookups.push(...(await Promise.all(wanted.slice(i, i + 3).map((t) => findByTitle(t, { arxiv: false }).catch(() => null)))));
  }
  wanted.forEach((title, i) => {
    const found = lookups[i];
    if (!found) unresolved.push(title);
    else if (!have.some((h) => sameTitle(h, found.title)) && !papers.some((p) => sameTitle(p.title, found.title))) papers.push(found);
  });
  return Response.json({ papers, unresolved });
}

import { after } from "next/server";
import { z } from "zod";
import { groqErrorResponse, resolveGroq } from "@/lib/ai-access";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { draftRelatedWork, loadToolPapers } from "@/lib/tutor/paper-tools";

export const maxDuration = 60;

const Body = z.object({
  sessionId: z.uuid(),
  docIds: z.array(z.uuid()).min(2).max(15),
  keys: z.array(z.string().regex(/^[a-z0-9]+$/i).max(80)).min(2).max(15), // BibTeX keys, same order
  goal: z.string().trim().max(4000).default(""),
});

// "Draft related work": on request, from the student's own pass notes.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.keys.length !== parsed.data.docIds.length) return Response.json({ error: "Pick at least two papers." }, { status: 400 });
  const { sessionId, docIds, keys, goal } = parsed.data;

  const access = await resolveGroq(supabase, userId, sessionId, "related");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  try {
    const papers = await loadToolPapers(supabase, sessionId, docIds);
    if (papers.length < 2) return Response.json({ error: "Pick at least two papers." }, { status: 400 });
    const keyOf = new Map(docIds.map((id, i) => [id, keys[i]]));
    const markdown = await draftRelatedWork(access.groq, papers, papers.map((p) => keyOf.get(p.id)!), goal);
    return Response.json({ markdown, withNotes: papers.filter((p) => p.notes).length });
  } catch (err) {
    if ((err as { status?: number })?.status) return groqErrorResponse(err, "Couldn't draft it. Try again.");
    logError("related work failed", err);
    return Response.json({ error: "Couldn't draft it. Try again." }, { status: 502 });
  }
}

import { after } from "next/server";
import { z } from "zod";
import { groqErrorResponse, resolveGroq } from "@/lib/ai-access";
import { createClient } from "@/lib/supabase/server";
import { triagePapers } from "@/lib/tutor/paper-ai";

export const maxDuration = 60;

const Body = z.object({ sessionId: z.uuid(), researchGoal: z.string().trim().min(5).max(4000) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Describe your research goal first (at least a sentence)." }, { status: 400 });
  const { sessionId, researchGoal } = parsed.data;

  const access = await resolveGroq(supabase, userId, sessionId, "triage");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  await supabase.from("study_sessions").update({ research_goal: researchGoal }).eq("id", sessionId);

  try {
    const results = await triagePapers(supabase, access.groq, sessionId, researchGoal);
    if (results.length) {
      // Only the target and reason change; existing notes and progress are kept.
      const { error } = await supabase.from("paper_reviews").upsert(
        results.map((r) => ({ document_id: r.paper.id, session_id: sessionId, user_id: userId, target_pass: r.pass, triage_reason: r.reason })),
        { onConflict: "document_id" },
      );
      if (error) throw new Error(error.message);
    }
    return Response.json({ results: results.map((r) => ({ documentId: r.paper.id, pass: r.pass, reason: r.reason })) });
  } catch (err) {
    if ((err as { status?: number })?.status) return groqErrorResponse(err, "Couldn't triage the papers. Try again.");
    console.error("triage failed", err);
    return Response.json({ error: "Couldn't triage the papers. Try again." }, { status: 502 });
  }
}

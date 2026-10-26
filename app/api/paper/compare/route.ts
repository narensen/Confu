import { after } from "next/server";
import { z } from "zod";
import { groqErrorResponse, resolveGroq } from "@/lib/ai-access";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { comparePapers, loadToolPapers } from "@/lib/tutor/paper-tools";

export const maxDuration = 60;

const Body = z.object({ sessionId: z.uuid(), docIds: z.array(z.uuid()).min(2).max(8) });

// "Compare papers": problem, approach, data, results and limitations side by side.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick two to eight papers." }, { status: 400 });

  const access = await resolveGroq(supabase, userId, parsed.data.sessionId, "compare");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  try {
    const papers = await loadToolPapers(supabase, parsed.data.sessionId, parsed.data.docIds);
    if (papers.length < 2) return Response.json({ error: "Pick two to eight papers." }, { status: 400 });
    return Response.json({ rows: await comparePapers(access.groq, papers) });
  } catch (err) {
    if ((err as { status?: number })?.status) return groqErrorResponse(err, "Couldn't compare them. Try again.");
    logError("compare failed", err);
    return Response.json({ error: "Couldn't compare them. Try again." }, { status: 502 });
  }
}

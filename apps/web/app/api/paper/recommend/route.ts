import { after } from "next/server";
import { z } from "zod";
import { aiErrorResponse, resolveAi } from "@/lib/ai-access";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { learnerBackground, recommendPapers } from "@/lib/tutor/recommend";

export const maxDuration = 120;

const Body = z.object({
  sessionId: z.uuid(),
  goal: z.string().trim().min(8, "Tell us a bit more about where you want to get to.").max(3000),
  useHistory: z.boolean().default(true),
});

// "Suggest papers": a reading path from real search results, shaped by what
// the reader has already studied in Confu.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { sessionId, goal, useHistory } = parsed.data;

  const access = await resolveAi(supabase, userId, sessionId, "recommend");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  try {
    const history = await learnerBackground(supabase, userId);
    const result = await recommendPapers(access.groq, {
      goal,
      background: useHistory ? history.brief : "",
      knownTitles: history.knownTitles, // never re-suggest what they already have
    });
    return Response.json(result);
  } catch (err) {
    if ((err as { status?: number })?.status) return aiErrorResponse(err, "Couldn't build recommendations. Try again.");
    logError("recommend failed", err);
    return Response.json({ error: "Couldn't build recommendations. Try again." }, { status: 502 });
  }
}

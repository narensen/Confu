import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  sessionId: z.uuid(),
  score: z.number().min(0).max(10),
  outOf: z.number().int().min(1).max(10),
  minutes: z.number().int().min(0).max(180),
  topics: z.array(z.string().max(80)).max(8).default([]),
  showName: z.boolean().default(true),
});

// A card for a timed paper: score, minutes, weak topics, and a reading when
// the exam is about ten days out. The database builds the reading. Questions
// and answers are not stored here.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Sign in to share a sitting." }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId, score, outOf, minutes, topics, showName } = parsed.data;
  const { data, error } = await supabase.rpc("save_sitting", {
    p_session: sessionId,
    p_score: score,
    p_out_of: outOf,
    p_minutes: minutes,
    p_topics: topics,
    p_show_name: showName,
  });
  if (error) {
    const missing = /save_sitting|schema cache|Could not find the function/i.test(error.message);
    return Response.json({ error: missing ? "Sharing a sitting needs migration 0028 to be run." : error.message }, { status: missing ? 500 : 400 });
  }
  if (typeof data !== "string" || !data) return Response.json({ error: "Couldn't share that sitting." }, { status: 500 });
  return Response.json({ token: data });
}

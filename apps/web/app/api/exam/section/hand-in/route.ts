import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  sessionId: z.uuid(),
  choices: z.array(z.number().int().min(-1).max(3)).max(10),
  minutes: z.number().int().min(0).max(30),
});

// Scores on the server. Does not call the tutor and does not call save_sitting.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { data, error } = await supabase.rpc("hand_in_section_paper", {
    p_session: parsed.data.sessionId,
    p_choices: parsed.data.choices,
    p_minutes: parsed.data.minutes,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json(data);
}

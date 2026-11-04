import { after } from "next/server";
import { z } from "zod";
import { aiErrorResponse, resolveAi } from "@/lib/ai-access";
import { createClient } from "@/lib/supabase/server";
import { draftFirstPass } from "@/lib/tutor/paper-ai";
import { logError } from "@/lib/log";

export const maxDuration = 60;

const Body = z.object({ documentId: z.uuid() });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { data: doc } = await supabase.from("documents").select("session_id").eq("id", parsed.data.documentId).maybeSingle();
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

  const access = await resolveAi(supabase, userId, doc.session_id, "pass1");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  try {
    return Response.json({ draft: await draftFirstPass(supabase, access.groq, parsed.data.documentId) });
  } catch (err) {
    if ((err as { status?: number })?.status) return aiErrorResponse(err, "Couldn't draft the first pass. Try again.");
    logError("pass1 draft failed", err);
    return Response.json({ error: "Couldn't draft the first pass. Try again." }, { status: 502 });
  }
}

import { z } from "zod";
import { findNamed } from "@/app/api/paper/from-goal/route";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({
  sessionId: z.uuid(),
  titles: z.array(z.string().trim().min(3).max(300)).min(1).max(12),
  field: z.string().max(300).default(""), // the goal's subject, to keep same-named papers from other fields out
});

// The papers a study plan recommends ("Go deeper"), found the same way as the
// ones a goal names: picked when there's no doubt, otherwise with candidates.
// Papers already in the session are left out. No AI involved.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId, titles, field } = parsed.data;

  const { data: docs } = await supabase.from("documents").select("title").eq("session_id", sessionId);
  // "DeepSeekMath paper (GRPO)" is searched as "DeepSeekMath"; a full title as itself.
  const wants = titles.map((t) => {
    const name = t.replace(/\(.*?\)/g, " ").replace(/\bpapers?\b/gi, " ").replace(/\s+/g, " ").trim() || t;
    return { name, title: t.split(/\s+/).length >= 4 ? t : "", arxiv: t.match(/\b(\d{4}\.\d{4,5})\b/)?.[1] ?? "", doi: "", authors: "" };
  });
  try {
    return Response.json({ papers: await findNamed(wants, field, ((docs ?? []) as { title: string }[]).map((d) => d.title)) });
  } catch (err) {
    logError("plan papers failed", err);
    return Response.json({ papers: [] });
  }
}

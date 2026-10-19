import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { generatePlan } from "@/lib/tutor/plan";

export const maxDuration = 60;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Body = z
  .object({
    sessionId: z.uuid(),
    goal: z.string().trim().min(5).max(8000),
    materials: z.string().trim().max(2000).default(""),
    level: z.enum(["beginner", "intermediate", "advanced"]),
    startDate: isoDate,
    deadline: isoDate,
    minutesPerDay: z.number().int().min(5).max(600),
  })
  .refine((b) => b.deadline >= b.startDate, { message: "Deadline must be after the start date" });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  try {
    const planId = await generatePlan(supabase, { userId, ...parsed.data });
    return Response.json({ planId });
  } catch (err) {
    console.error("plan generation failed", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not generate a plan. Try again." },
      { status: 502 },
    );
  }
}

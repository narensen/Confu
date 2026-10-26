import { after } from "next/server";
import { z } from "zod";
import { groqErrorResponse, resolveGroq } from "@/lib/ai-access";
import { createClient } from "@/lib/supabase/server";
import { generatePlan } from "@/lib/tutor/plan";
import { logError } from "@/lib/log";

export const maxDuration = 60;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Body = z
  .object({
    sessionId: z.uuid(),
    goal: z.string().trim().min(5).max(8000),
    materials: z.string().trim().max(2000).default(""),
    level: z.enum(["beginner", "intermediate", "advanced"]),
    startDate: isoDate,
    // Both, or neither (the plan is sized to the goal; the pace is set after).
    deadline: isoDate.optional(),
    minutesPerDay: z.number().int().min(5).max(600).optional(),
  })
  .refine((b) => !b.deadline || b.deadline >= b.startDate, { message: "Deadline must be after the start date" })
  .refine((b) => Boolean(b.deadline) === Boolean(b.minutesPerDay), { message: "Give both a deadline and hours a day, or neither" });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const access = await resolveGroq(supabase, userId, parsed.data.sessionId, "plan");
  if ("error" in access) return access.error;
  after(() => access.meter.flush());

  try {
    const planId = await generatePlan(supabase, access.groq, { userId, ...parsed.data });
    return Response.json({ planId });
  } catch (err) {
    if ((err as { status?: number })?.status) return groqErrorResponse(err, "Could not generate a plan. Try again.");
    logError("plan generation failed", err);
    return Response.json({ error: err instanceof Error ? err.message : "Could not generate a plan. Try again." }, { status: 502 });
  }
}

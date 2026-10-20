"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/dal";
import { safeNext } from "@/lib/safe-next";
import { HEARD_FROM, OCCUPATIONS, PURPOSES } from "@/lib/signup-survey";
import { createClient } from "@/lib/supabase/server";

export type WelcomeState = { error?: string } | undefined;

const Answers = z.object({
  heard_from: z.enum(HEARD_FROM, "Tell us how you heard about Confu"),
  occupation: z.enum(OCCUPATIONS, "Tell us what describes you best"),
  purpose: z.enum(PURPOSES, "Tell us what you'll use Confu for"),
  purpose_detail: z.string().trim().max(500, "Keep it under 500 characters"),
});

// The sign-up questions for people who joined with Google.
export async function saveWelcome(_: WelcomeState, formData: FormData): Promise<WelcomeState> {
  const user = await requireUser();
  const parsed = Answers.safeParse({
    heard_from: formData.get("heardFrom"),
    occupation: formData.get("occupation"),
    purpose: formData.get("purpose"),
    purpose_detail: String(formData.get("purposeDetail") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ ...parsed.data, purpose_detail: parsed.data.purpose_detail || null })
    .eq("id", user.id);
  if (error) return { error: /permission|column/i.test(error.message) ? "This needs migration 0015 to be run." : error.message };
  redirect(safeNext(formData.get("next")));
}

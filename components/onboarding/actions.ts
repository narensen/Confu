"use server";

import { getUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

// Mark the first-login guide as seen so it doesn't open automatically again.
export async function completeOnboarding() {
  const user = await getUser();
  if (!user) return;
  const supabase = await createClient();
  await supabase.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", user.id);
}

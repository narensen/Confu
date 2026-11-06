"use server";

import { createClient } from "@/lib/supabase/server";

// Owner only: the database function checks the caller is the owner.
export async function setFeedbackStatus(id: number, status: "new" | "seen" | "done"): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_feedback_status", { p_id: id, p_status: status });
  return error ? { error: error.message } : {};
}

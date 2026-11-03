import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The server key bypasses row-level security. Used only by the daily job
// (reminders, weekly summaries) and email unsubscribe links, never with
// anything a user sent.
// Null when SUPABASE_SERVICE_ROLE_KEY isn't set.
export function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

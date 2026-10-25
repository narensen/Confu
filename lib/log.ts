import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server error logging that can't leak secrets: only the error's name, status
// and message are written (never request objects or headers), and anything
// shaped like an API key or bearer token is masked. Errors are also stored in
// Confu's own database (app_errors, migration 0018) for the admin dashboard.
const SECRET = /\b(gsk_|sk-|sb_secret_)[A-Za-z0-9_-]{6,}|Bearer\s+[A-Za-z0-9._-]+/g;

export const redact = (text: string) => text.replace(SECRET, "[redacted]");

export function logError(label: string, err: unknown) {
  const e = err as { name?: string; status?: number; message?: string } | null;
  const parts = [e?.name, e?.status, e?.message ?? String(err)].filter((p) => p !== undefined && p !== "");
  const line = redact(`${label}: ${parts.join(" · ")}`).slice(0, 1000);
  console.error(line);
  void reportServerError(line);
}

// Anonymous client: report_error() is open to it and rate-limits itself.
let client: SupabaseClient | null | undefined;
function db() {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return client;
}

export async function reportServerError(message: string, extra: { path?: string; digest?: string; stack?: string } = {}) {
  const c = db();
  if (!c) return;
  try {
    await Promise.race([
      c.rpc("report_error", {
        p_source: "server",
        p_message: redact(message).slice(0, 1000),
        p_stack: extra.stack ? redact(extra.stack).slice(0, 4000) : null,
        p_path: extra.path?.slice(0, 300) ?? null,
        p_digest: extra.digest ?? null,
        p_user_agent: null,
      }),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    // Reporting must never throw.
  }
}

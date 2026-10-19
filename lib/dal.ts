import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getRole } from "@/lib/ai-access";
import { createClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string | null; name: string | null };

// Data Access Layer: the single place pages verify the session.
// getClaims() verifies the JWT; RLS enforces ownership on every query.
export const getUser = cache(async (): Promise<SessionUser | null> => {
  // Session checks compare token expiry with the current time, so they must
  // run at request time rather than during prerendering.
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const meta = (claims.user_metadata ?? {}) as { full_name?: string };
  return {
    id: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    name: meta.full_name ?? null,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

// 'admin' accounts use the server's Groq key; everyone else (NULL) brings
// their own key per session. The role is only ever set by hand in Supabase.
export const getCurrentRole = cache(async (): Promise<"admin" | null> => {
  const user = await getUser();
  if (!user) return null;
  return getRole(await createClient(), user.id);
});

// Whether to auto-open the first-login guide. Only brand-new accounts qualify:
// anyone who already has a session isn't new, even if they never saw the guide
// (e.g. accounts created before it existed).
export const getFirstTime = cache(async (): Promise<boolean> => {
  const user = await getUser();
  if (!user) return false;
  const supabase = await createClient();
  const [{ count }, profile] = await Promise.all([
    supabase.from("study_sessions").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("profiles").select("onboarded_at").eq("id", user.id).maybeSingle(),
  ]);
  if ((count ?? 0) > 0) return false;
  // Without the onboarding column, a local "seen" flag stops repeats.
  if (profile.error || !profile.data) return true;
  return profile.data.onboarded_at === null;
});

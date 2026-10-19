import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
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

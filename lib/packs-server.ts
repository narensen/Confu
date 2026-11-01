import "server-only";
import { createClient as createAnon } from "@supabase/supabase-js";
import { cache } from "react";
import type { Pack } from "@/lib/packs";
import { createClient } from "@/lib/supabase/server";

// A pack by its link. Without cookies (for metadata and images, the same for
// everyone), or as the signed-in viewer (to know whether it's theirs).
export const getPackPublic = cache(async (slug: string): Promise<Pack | null> => {
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.rpc("get_pack", { p_slug: slug.slice(0, 120) });
  return ((data ?? []) as Pack[])[0] ?? null;
});

export const getPackForViewer = cache(async (slug: string): Promise<Pack | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_pack", { p_slug: slug.slice(0, 120) });
  return ((data ?? []) as Pack[])[0] ?? null;
});

// Short course code, if 0028 has been run. Missing function: no code, page still works.
export const courseCodeFor = cache(async (slug: string): Promise<string | null> => {
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.rpc("course_of", { p_slug: slug.slice(0, 120) });
  if (error || typeof data !== "string" || !data) return null;
  return data;
});

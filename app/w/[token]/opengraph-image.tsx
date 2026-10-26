import { createClient as createAnon } from "@supabase/supabase-js";
import { ogCard, OG_SIZE } from "@/lib/og/card";
import { duration, monthYear, type Wrapped } from "@/lib/wrapped";

export const alt = "A month of studying in Confu";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = /^[0-9a-f]{32}$/.test(token) ? await anon.rpc("get_wrapped_share", { p_token: token }) : { data: null };
  const s = ((data ?? []) as { month: string; stats: Wrapped; display_name: string | null }[])[0];
  if (!s) return ogCard({ eyebrow: "Wrapped", title: "A month in Confu" });
  return ogCard({
    eyebrow: "Wrapped",
    title: `${s.display_name ? `${s.display_name}'s` : "My"} ${monthYear(s.month)}: ${duration(s.stats.minutes)} of studying`,
    sub: `${s.stats.active_days} active days · longest streak ${s.stats.longest_streak} days`,
    footer: "confu.lol",
  });
}

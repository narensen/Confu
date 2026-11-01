import { createClient as createAnon } from "@supabase/supabase-js";
import { ogCard, OG_SIZE } from "@/lib/og/card";

export const alt = "Section counts in Confu";
export const size = OG_SIZE;
export const contentType = "image/png";

type Wrapped = { handins: number; copies: number | null; hours: number; course_code: string | null };

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = /^[0-9a-f]{32}$/.test(token) ? await anon.rpc("get_section_wrapped", { p_token: token }) : { data: null };
  const s = ((data ?? []) as Wrapped[])[0];
  if (!s) return ogCard({ eyebrow: "Section", title: "Counts only" });
  const copied = s.copies === null ? "" : `Copied ${s.copies} times · `;
  return ogCard({
    eyebrow: s.course_code ?? "Section",
    title: `${s.handins} handed in`,
    sub: `${copied}${s.hours} library hours`,
    footer: "confu.lol",
  });
}

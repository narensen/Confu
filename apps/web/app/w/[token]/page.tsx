import type { Metadata } from "next";
import { createClient as createAnon } from "@supabase/supabase-js";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { WrappedCards } from "@/components/wrapped/WrappedCards";
import { duration, monthYear, type Wrapped } from "@/lib/wrapped";

const getShare = cache(async (token: string) => {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.rpc("get_wrapped_share", { p_token: token });
  return ((data ?? []) as { month: string; stats: Wrapped; display_name: string | null }[])[0] ?? null;
});

export async function generateMetadata({ params }: PageProps<"/w/[token]">): Promise<Metadata> {
  const s = await getShare((await params).token);
  if (!s) return { title: "Confu Wrapped" };
  const who = s.display_name ? `${s.display_name}'s` : "A";
  return {
    title: `${who} ${monthYear(s.month)} in Confu`,
    description: `${duration(s.stats.minutes)} studied, ${s.stats.active_days} active days.`,
    robots: { index: false, follow: false },
  };
}

export default function SharedWrapped({ params }: PageProps<"/w/[token]">) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SiteNav />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
        <Suspense fallback={<div className="skeleton h-96 rounded-3xl" />}>
          <Body params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}

async function Body({ params }: { params: PageProps<"/w/[token]">["params"] }) {
  const s = await getShare((await params).token);
  if (!s) notFound();
  return (
    <div className="animate-enter space-y-8">
      <WrappedCards w={{ ...s.stats, month: s.month }} name={s.display_name} />
      <div className="rounded-2xl border border-ink bg-panel p-6 text-center">
        <p className="font-serif text-2xl">Study like this, with a tutor that works from your own notes.</p>
        <Link href="/signup" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-white transition hover:-translate-y-px hover:shadow-[3px_3px_0_0_#facc15]">
          Try Confu free →
        </Link>
      </div>
    </div>
  );
}

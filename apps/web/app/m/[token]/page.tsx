import type { Metadata } from "next";
import { createClient as createAnon } from "@supabase/supabase-js";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { eyebrowClass } from "@/components/ui";

type Topic = { topic: string; missed: number; of: number };
type Revise = { topic: string; sourceTitle?: string | null; page?: number | null };
type MapCard = { token: string; users: number; topics: Topic[] | null; band: string | null; revise: Revise[] | null; exam_date: string | null };

const getMap = cache(async (token: string): Promise<MapCard | null> => {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.rpc("get_miss_map", { p_token: token });
  return ((data ?? []) as MapCard[])[0] ?? null;
});

export async function generateMetadata({ params }: PageProps<"/m/[token]">): Promise<Metadata> {
  const card = await getMap((await params).token);
  return {
    title: card ? "What the section missed — Confu" : "A miss map — Confu",
    description: card?.band ?? "Topics the section missed. No names.",
    robots: { index: false, follow: false },
  };
}

export default function MissMapPage({ params }: PageProps<"/m/[token]">) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SiteNav />
      <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-4 py-12">
        <Suspense fallback={<div className="skeleton h-80 w-full rounded-3xl" />}>
          <Body params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}

async function Body({ params }: { params: PageProps<"/m/[token]">["params"] }) {
  const card = await getMap((await params).token);
  if (!card) notFound();
  const topics = card.topics ?? [];
  const revise = (card.revise ?? []).slice(0, 3);
  return (
    <article className="w-full rounded-3xl border border-ink bg-panel p-8">
      <p className={eyebrowClass}>Miss map</p>
      <h1 className="mt-2 font-serif text-3xl leading-tight">What the section missed</h1>
      <p className="mt-3 font-mono text-xs text-muted">{card.users} people handed in</p>
      {card.band && <p className="mt-4 text-sm leading-relaxed">{card.band}</p>}
      <ul className="mt-6 space-y-2 text-sm">
        {topics.map((t) => (
          <li key={t.topic} className="flex items-baseline justify-between gap-3">
            <span>{t.topic}</span>
            <span className="font-mono text-xs text-muted">
              {t.missed} of {t.of}
            </span>
          </li>
        ))}
      </ul>
      {revise.length > 0 && (
        <div className="mt-6">
          <p className={eyebrowClass}>Revise</p>
          <ul className="mt-2 space-y-1 text-sm">
            {revise.map((r) => (
              <li key={r.topic}>
                {r.topic}
                {r.sourceTitle || r.page ? (
                  <span className="text-muted">
                    {" "}
                    · {[r.sourceTitle, r.page ? `p. ${r.page}` : ""].filter(Boolean).join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link href="/signup" className="mt-8 inline-flex rounded-lg border border-ink bg-ink px-4 py-2 text-sm font-medium text-white">
        Sit from your own notes →
      </Link>
    </article>
  );
}

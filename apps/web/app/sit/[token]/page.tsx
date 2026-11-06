import type { Metadata } from "next";
import { createClient as createAnon } from "@supabase/supabase-js";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { eyebrowClass } from "@/components/ui";

type Card = { title: string; score: number; out_of: number; minutes: number; topics: string[] | null; band: string | null; display_name: string | null };

const getCard = cache(async (token: string): Promise<Card | null> => {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.rpc("get_sitting", { p_token: token });
  return ((data ?? []) as Card[])[0] ?? null;
});

export async function generateMetadata({ params }: PageProps<"/sit/[token]">): Promise<Metadata> {
  const card = await getCard((await params).token);
  if (!card) return { title: "A sitting — Confu", robots: { index: false, follow: false } };
  const who = card.display_name ? `${card.display_name} scored` : "Scored";
  return {
    title: `${who} ${card.score} / ${card.out_of} — Confu`,
    description: card.band ?? `${card.minutes} min on ${card.title}.`,
    robots: { index: false, follow: false },
  };
}

export default function SittingPage({ params }: PageProps<"/sit/[token]">) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SiteNav />
      <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-4 py-12">
        <Suspense fallback={<div className="skeleton h-80 w-full rounded-3xl" />}>
          <CardBody params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}

async function CardBody({ params }: { params: PageProps<"/sit/[token]">["params"] }) {
  const card = await getCard((await params).token);
  if (!card) notFound();
  const topics = card.topics ?? [];
  const score = Number(card.score);
  const shown = Number.isInteger(score) ? String(score) : score.toFixed(1);
  return (
    <article className="w-full rounded-3xl border border-ink bg-panel p-8">
      <p className={eyebrowClass}>{card.display_name ? `${card.display_name}'s sitting` : "A sitting"}</p>
      <h1 className="mt-2 font-serif text-3xl leading-tight">{card.title}</h1>
      <p className="mt-6 font-serif text-6xl tabular-nums">
        {shown}
        <span className="text-3xl text-muted"> / {card.out_of}</span>
      </p>
      <p className="mt-2 font-mono text-xs text-muted">{card.minutes} min</p>
      {card.band && <p className="mt-5 text-sm leading-relaxed">{card.band}</p>}
      {topics.length > 0 && (
        <div className="mt-5">
          <p className={eyebrowClass}>Misses</p>
          <ul className="mt-2 space-y-1 text-sm">
            {topics.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      <Link href="/signup" className="mt-8 inline-flex rounded-lg border border-ink bg-ink px-4 py-2 text-sm font-medium text-white">
        Sit one from your own notes →
      </Link>
    </article>
  );
}

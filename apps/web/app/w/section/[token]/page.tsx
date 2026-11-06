import type { Metadata } from "next";
import { createClient as createAnon } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { eyebrowClass } from "@/components/ui";

type Wrapped = {
  token: string;
  handins: number;
  copies: number | null;
  hours: number;
  topics: string[] | null;
  closed: string[] | null;
  course_code: string | null;
  exam_date: string | null;
};

const getWrapped = cache(async (token: string): Promise<Wrapped | null> => {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.rpc("get_section_wrapped", { p_token: token });
  return ((data ?? []) as Wrapped[])[0] ?? null;
});

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "The section — Confu",
    description: "Counts from the section. No names.",
    robots: { index: false, follow: false },
  };
}

export default function SectionWrappedPage({ params }: PageProps<"/w/section/[token]">) {
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

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

async function Body({ params }: { params: PageProps<"/w/section/[token]">["params"] }) {
  const card = await getWrapped((await params).token);
  if (!card) notFound();
  const topics = names(card.topics);
  const closed = names(card.closed);
  return (
    <article className="w-full rounded-3xl border border-ink bg-panel p-8">
      <p className={eyebrowClass}>{card.course_code ?? "Section"}</p>
      <h1 className="mt-2 font-serif text-3xl leading-tight">After the paper</h1>
      <dl className="mt-6 space-y-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt>Handed in</dt>
          <dd className="font-mono">{card.handins}</dd>
        </div>
        {card.copies !== null && (
          <div>
            <dt>Copied {card.copies} times</dt>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt>Library hours held</dt>
          <dd className="font-mono">{card.hours}</dd>
        </div>
      </dl>
      {topics.length > 0 && (
        <div className="mt-6">
          <p className={eyebrowClass}>Last miss map</p>
          <p className="mt-2 text-sm">{topics.join(" · ")}</p>
        </div>
      )}
      {closed.length > 0 && (
        <div className="mt-5">
          <p className={eyebrowClass}>Closed</p>
          <p className="mt-2 text-sm">{closed.join(" · ")}</p>
        </div>
      )}
    </article>
  );
}

import type { Metadata } from "next";
import { createClient as createAnon } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { PrintButton } from "@/components/workspace/PrintButton";
import { CopyDoorCard } from "@/components/dashboard/DoorCardDialog";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { eyebrowClass } from "@/components/ui";
import { SITE } from "@/lib/site";

type Item = { title: string; url: string; kind: string; license: string };
type Card = { code: string; title: string; kind: string; items: Item[]; plan: { plan?: { goal_title?: string; overview?: string } } | null };

const getCard = cache(async (code: string): Promise<Card | null> => {
  if (!/^[a-z0-9]{4,10}$/.test(code)) return null;
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.rpc("get_noticeboard", { p_code: code });
  const card = data as Card | null;
  return card?.code ? card : null;
});

export async function generateMetadata({ params }: PageProps<"/b/[code]">): Promise<Metadata> {
  const card = await getCard((await params).code.toLowerCase());
  return {
    title: card ? `${card.title} — Confu` : "A reading list — Confu",
    robots: { index: false, follow: false },
  };
}

export default function DoorPage({ params }: PageProps<"/b/[code]">) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper print:bg-white">
      <div className="print:hidden">
        <SiteNav />
      </div>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-12">
        <Suspense fallback={<div className="skeleton h-80 w-full rounded-3xl" />}>
          <Body params={params} />
        </Suspense>
      </main>
      <div className="print:hidden">
        <SiteFooter />
      </div>
    </div>
  );
}

async function Body({ params }: { params: PageProps<"/b/[code]">["params"] }) {
  const code = (await params).code.toLowerCase();
  const card = await getCard(code);
  if (!card) notFound();
  const openstax = card.items.some((item) => /openstax\.org/i.test(item.url));
  return (
    <article className="rounded-3xl border border-ink bg-panel p-8 print:rounded-none print:border-0 print:p-0">
      <div className="flex items-start justify-between gap-3 print:hidden">
        <p className={eyebrowClass}>Door card</p>
        <PrintButton />
      </div>
      <h1 className="mt-2 font-serif text-3xl leading-tight">{card.title}</h1>
      {card.plan?.plan?.overview && <p className="mt-3 text-sm leading-relaxed text-muted">{card.plan.plan.overview}</p>}
      <ol className="mt-6 space-y-3 text-sm">
        {card.items.map((item) => (
          <li key={item.url}>
            <a href={item.url} className="font-medium underline decoration-ink/30 underline-offset-2">
              {item.title}
            </a>
            <span className="mt-0.5 block font-mono text-[11px] text-muted">
              {item.kind} · {item.license}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-8 font-serif text-2xl tracking-tight">
        {SITE.url}/b/{card.code}
      </p>
      {openstax && <p className="mt-2 text-xs text-muted">Samuel J. Ling, Jeff Sanny and William Moebs, OpenStax University Physics Volume 2, CC BY 4.0.</p>}
      <div className="mt-6 print:hidden">
        <CopyDoorCard code={card.code} />
      </div>
    </article>
  );
}

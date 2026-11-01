import type { Metadata } from "next";
import { createClient as createAnon } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { PrintButton } from "@/components/workspace/PrintButton";
import { SITE } from "@/lib/site";
import { cribSheet } from "@/lib/sheet";

type PageRef = { topic: string; sourceTitle?: string | null; page?: number | null };
type Crib = { token: string; course_code: string | null; objectives: string[] | null; concepts: string[] | null; pages: PageRef[] | null; openstax: boolean };

const getCrib = cache(async (token: string): Promise<Crib | null> => {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.rpc("get_crib", { p_token: token });
  return ((data ?? []) as Crib[])[0] ?? null;
});

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Section crib — Confu", robots: { index: false, follow: false } };
}

export default function CribPage({ params }: PageProps<"/crib/[token]">) {
  return (
    <Suspense fallback={<div className="skeleton m-8 h-80 rounded-xl" />}>
      <Sheet params={params} />
    </Suspense>
  );
}

async function Sheet({ params }: { params: PageProps<"/crib/[token]">["params"] }) {
  const raw = await getCrib((await params).token);
  if (!raw) notFound();
  const sheet = cribSheet({ objectives: raw.objectives ?? [], concepts: raw.concepts ?? [] });
  const pages = raw.pages ?? [];
  return (
    <div className="min-h-dvh bg-paper text-ink print:bg-white print:text-black">
      <div className="mx-auto flex max-w-[190mm] items-center justify-between gap-3 px-6 pt-6 print:hidden">
        <p className="font-mono text-xs text-muted">One page. Nothing from a file.</p>
        <PrintButton />
      </div>
      <article className="mx-auto max-w-[190mm] px-6 py-8 print:max-w-none print:px-0 print:py-0">
        <p className="font-mono text-xs uppercase tracking-wide">Section crib</p>
        <h1 className="mt-2 font-serif text-3xl">What to revise</h1>
        {sheet.objectives.length > 0 && (
          <section className="mt-6">
            <h2 className="font-serif text-xl">Objectives</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {sheet.objectives.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </section>
        )}
        {sheet.concepts.length > 0 && (
          <section className="mt-5">
            <h2 className="font-serif text-xl">Concepts</h2>
            <p className="mt-2 text-sm">{sheet.concepts.join(" · ")}</p>
          </section>
        )}
        {pages.length > 0 && (
          <section className="mt-5">
            <h2 className="font-serif text-xl">Pages</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {pages.map((p) => (
                <li key={p.topic}>
                  {p.topic}
                  {p.sourceTitle || p.page ? ` — ${[p.sourceTitle, p.page ? `p. ${p.page}` : ""].filter(Boolean).join(", ")}` : ""}
                </li>
              ))}
            </ul>
          </section>
        )}
        <footer className="mt-10 border-t border-ink pt-4">
          {raw.course_code && <p className="font-serif text-4xl tracking-tight">{raw.course_code}</p>}
          <p className="mt-2 text-xs text-muted">
            {SITE.url}
            {raw.course_code ? `/c/${raw.course_code}` : ""}
          </p>
          {raw.openstax && (
            <p className="mt-2 text-xs text-muted">Samuel J. Ling, Jeff Sanny and William Moebs, OpenStax University Physics Volume 2, CC BY 4.0.</p>
          )}
        </footer>
      </article>
    </div>
  );
}

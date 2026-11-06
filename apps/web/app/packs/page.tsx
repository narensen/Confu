import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClient as createAnon } from "@supabase/supabase-js";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { eyebrowClass } from "@/components/ui";
import { TEMPLATES } from "@/lib/templates";

export const metadata: Metadata = {
  title: "Study packs — Confu",
  description: "Study plans, sources and highlights shared by other learners. Copy one into your Confu library and make it yours.",
};

type Listed = { slug: string; kind: "study" | "paper" | "exam"; title: string; description: string; author_name: string | null; sources: number; topics: number; copies: number };

export default function PacksPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SiteNav />
      <main className="flex-1">
        <section className="border-b border-ink">
          <div className="mx-auto max-w-6xl px-6 pt-16 pb-12">
            <p className={eyebrowClass}>Study packs</p>
            <h1 className="mt-3 max-w-3xl font-serif text-5xl leading-[1.05] tracking-tight">Start from what worked for someone else.</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
              A pack is a study session someone shared: their sources, plan and highlights. Copy one and Confu fetches everything into your
              library, with a plan that starts today.
            </p>
            <p className="mt-4 text-sm text-muted">
              Share your own from any session: the <span className="font-medium text-ink">Share</span> button next to its title. Plans shared as a path are also on{" "}
              <Link href="/roadmaps" className="font-medium text-ink underline underline-offset-4">
                Roadmaps
              </Link>
              .
            </p>
          </div>
        </section>
        <section className="border-b border-ink">
          <div className="mx-auto max-w-6xl px-6 py-12">
            <Suspense fallback={<div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-44 rounded-2xl" />)}</div>}>
              <Gallery />
            </Suspense>
          </div>
        </section>
        <section className="bg-panel">
          <div className="mx-auto max-w-6xl px-6 py-14">
            <p className={eyebrowClass}>Or start from a template</p>
            <h2 className="mt-2 font-serif text-3xl tracking-tight">Goals with free sources, ready to go</h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TEMPLATES.map((t) => (
                <li key={t.slug}>
                  <Link href={`/templates/${t.slug}`} className="block rounded-xl border border-ink/25 bg-paper/50 p-4 transition hover:border-ink hover:shadow-hard-sm">
                    <span className="block font-medium">{t.title}</span>
                    <span className="mt-1 block text-sm text-muted">{t.tagline}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

async function Gallery() {
  // Built without a Supabase project (a fork, a preview): an empty gallery.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const { data } = url && key ? await createAnon(url, key, { auth: { persistSession: false } }).rpc("public_packs", { p_limit: 60 }) : { data: null };
  const packs = (data ?? []) as Listed[];
  if (!packs.length) {
    return (
      <div className="rounded-2xl border border-dashed border-ink/40 bg-panel px-6 py-12 text-center">
        <p className="font-serif text-2xl">The gallery is just getting started</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Be one of the first: open a session you&apos;re proud of, press Share, and list it here. Meanwhile, the templates below are a great start.
        </p>
      </div>
    );
  }
  return (
    <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {packs.map((p) => (
        <li key={p.slug}>
          <Link href={`/p/${p.slug}`} className="group flex h-full flex-col rounded-2xl border border-ink bg-panel p-5 transition-[translate,box-shadow] duration-300 ease-fluid hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard">
            <span className={eyebrowClass}>{p.kind === "paper" ? "Paper pack" : p.kind === "exam" ? "Exam pack" : "Study pack"}</span>
            <span className="mt-2 line-clamp-2 font-serif text-xl leading-snug">{p.title}</span>
            {p.description && <span className="mt-2 line-clamp-3 text-sm text-muted">{p.description}</span>}
            <span className="mt-auto pt-4 font-mono text-[11px] text-muted">
              {p.sources} sources{p.topics ? ` · ${p.topics} topics` : ""} · {p.copies} copies{p.author_name ? ` · by ${p.author_name}` : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

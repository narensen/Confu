import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClient as createAnon } from "@supabase/supabase-js";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { eyebrowClass } from "@/components/ui";

export const metadata: Metadata = {
  title: "Roadmaps — Confu",
  description: "Study plans people shared as a path. Open one, follow it, and copy it into your library.",
};

type Listed = {
  slug: string;
  title: string;
  description: string;
  author_name: string | null;
  sources: number;
  topics: number;
  copies: number;
  days: number | null;
  minutes: number | null;
  goal: string | null;
};

const SLUG = /^[a-z0-9-]{1,80}$/i;

export default function RoadmapsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SiteNav />
      <main className="flex-1">
        <section className="border-b border-ink">
          <div className="mx-auto max-w-6xl px-6 pt-16 pb-12">
            <p className={eyebrowClass}>Roadmaps</p>
            <h1 className="mt-3 max-w-3xl font-serif text-5xl leading-[1.05] tracking-tight">A session, shared as a path.</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
              A roadmap is a study plan someone already walked: the phases, the sources, and how the days were split. Copy it and the plan starts from today, with your own files.
            </p>
            <p className="mt-4 text-sm text-muted">
              Share yours from any session: press <span className="font-medium text-ink">Share</span>, then turn on roadmap. It&apos;s the same page as a{" "}
              <Link href="/packs" className="font-medium text-ink underline underline-offset-4">
                study pack
              </Link>
              .
            </p>
          </div>
        </section>
        <section>
          <div className="mx-auto max-w-6xl px-6 py-12">
            <Suspense fallback={<div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-44 rounded-2xl" />)}</div>}>
              <Gallery />
            </Suspense>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

async function Gallery() {
  // Built without a Supabase project (a fork, a preview): an empty list.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const { data, error } = url && key ? await createAnon(url, key, { auth: { persistSession: false } }).rpc("public_roadmaps", { p_limit: 60 }) : { data: null, error: null };
  if (error) {
    const missing = /public_roadmaps|schema cache|PGRST202|PGRST205/i.test(error.message);
    return (
      <Empty
        title="Roadmaps aren't available yet"
        note={missing ? "Roadmaps need migration 0027 to be run in Supabase." : "The list couldn't be loaded. Try again in a minute."}
      />
    );
  }
  if (data && typeof data === "object" && !Array.isArray(data) && typeof (data as { error?: unknown }).error === "string") {
    return <Empty title="Roadmaps aren't available yet" note={(data as { error: string }).error} />;
  }
  const packs = (Array.isArray(data) ? data : []).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    if (typeof r.slug !== "string" || !SLUG.test(r.slug)) return [];
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const item: Listed = {
      slug: r.slug,
      title: typeof r.title === "string" && r.title.trim() ? r.title : "Roadmap",
      description: typeof r.description === "string" ? r.description : "",
      author_name: typeof r.author_name === "string" ? r.author_name : null,
      sources: num(r.sources),
      topics: num(r.topics),
      copies: num(r.copies),
      days: typeof r.days === "number" ? r.days : null,
      minutes: typeof r.minutes === "number" ? r.minutes : null,
      goal: typeof r.goal === "string" ? r.goal : null,
    };
    return [item];
  });
  if (!packs.length) return <Empty note="Be one of the first: open a session with a plan, press Share, and turn on roadmap." />;
  return (
    <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {packs.map((p) => (
        <li key={p.slug}>
          <Link href={`/p/${p.slug}`} className="group flex h-full flex-col rounded-2xl border border-ink bg-panel p-5 transition-[translate,box-shadow] duration-300 ease-fluid hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard">
            <span className={eyebrowClass}>Roadmap</span>
            <span className="mt-2 line-clamp-2 font-serif text-xl leading-snug">{p.title}</span>
            <span className="mt-2 line-clamp-3 text-sm text-muted">{p.goal || p.description}</span>
            <span className="mt-auto pt-4 font-mono text-[11px] text-muted">
              {p.days ? `${p.days} days` : "A plan"}
              {p.minutes ? ` · ${p.minutes} min a day` : ""}
              {p.topics ? ` · ${p.topics} topics` : ""}
              {` · ${p.sources} sources`}
              {p.author_name ? ` · ${p.author_name}` : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Empty({ title = "No roadmaps listed yet", note }: { title?: string; note: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink/40 bg-panel px-6 py-12 text-center">
      <p className="font-serif text-2xl">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{note}</p>
    </div>
  );
}

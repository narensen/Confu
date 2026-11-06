import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { eyebrowClass } from "@/components/ui";
import { TEMPLATES } from "@/lib/templates";

export const metadata: Metadata = {
  title: "Goal templates — Confu",
  description: "Ready-made learning goals with free lectures, papers and readings: neural networks, transformers, reinforcement learning, linear algebra, calculus, Python and more.",
};

export default function TemplatesPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SiteNav />
      <main className="flex-1">
        <section className="border-b border-ink">
          <div className="mx-auto max-w-6xl px-6 pt-16 pb-12">
            <p className={eyebrowClass}>Goal templates</p>
            <h1 className="mt-3 max-w-3xl font-serif text-5xl leading-[1.05] tracking-tight">Pick a goal. The sources are already found.</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
              Each template comes with free, hand-picked lectures, readings and papers. Start one and Confu brings them into a session and
              builds a plan around your level, deadline and hours.
            </p>
          </div>
        </section>
        <section>
          <div className="mx-auto max-w-6xl px-6 py-12">
            <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {TEMPLATES.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={`/templates/${t.slug}`}
                    className="group flex h-full flex-col rounded-2xl border border-ink bg-panel p-6 transition-[translate,box-shadow] duration-300 ease-fluid hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard"
                  >
                    <span className="flex flex-wrap gap-1.5">
                      {t.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className="rounded border border-ink/25 px-1.5 py-px font-mono text-[10px] tracking-wider text-muted uppercase">
                          {tag}
                        </span>
                      ))}
                    </span>
                    <span className="mt-3 font-serif text-2xl leading-snug">{t.title}</span>
                    <span className="mt-2 text-sm leading-relaxed text-muted">{t.tagline}</span>
                    <span className="mt-auto pt-5 font-mono text-[11px] text-muted">
                      {t.sources.length} sources · {t.weeks} {t.weeks === 1 ? "week" : "weeks"} · {t.level}
                      {t.kind === "exam" ? " · starts as an exam session" : ""}
                    </span>
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

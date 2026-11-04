import type { Metadata } from "next";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { eyebrowClass } from "@/components/ui";
import { CHANGELOG } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "What's new — Confu",
  description: "Everything new in Confu, the AI tutor that works from your own material.",
  alternates: { types: { "application/rss+xml": "/changelog/feed.xml" } },
};

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function ChangelogPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SiteNav />
      <main className="flex-1">
        <section className="border-b border-ink">
          <div className="mx-auto max-w-3xl px-6 pt-16 pb-12">
            <p className={eyebrowClass}>Changelog</p>
            <h1 className="mt-3 font-serif text-5xl leading-[1.05] tracking-tight">What&apos;s new</h1>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              What we&apos;ve shipped, newest first.{" "}
              <a href="/changelog/feed.xml" className="text-sm underline underline-offset-4 hover:text-ink">
                RSS feed
              </a>
            </p>
          </div>
        </section>
        <section>
          <ol className="mx-auto max-w-3xl space-y-12 px-6 py-14">
            {CHANGELOG.map((r) => (
              <li key={r.title} className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-8">
                <time dateTime={r.date} className="font-mono text-xs text-muted sm:pt-2">
                  {fmt(r.date)}
                </time>
                <article className="rounded-2xl border border-ink bg-panel p-6">
                  <h2 className="font-serif text-2xl leading-snug">{r.title}</h2>
                  <p className="mt-1.5 text-muted">{r.summary}</p>
                  <ul className="mt-4 space-y-2 text-sm leading-relaxed">
                    {r.items.map((item) => (
                      <li key={item} className="flex gap-2.5">
                        <span className="mt-[0.55em] size-1.5 shrink-0 bg-ink" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </article>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

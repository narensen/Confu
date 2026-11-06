import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CopyButton } from "@/components/packs/CopyButton";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { eyebrowClass } from "@/components/ui";
import { getUser } from "@/lib/dal";
import { SOURCE_LABEL } from "@/lib/packs";
import { SITE } from "@/lib/site";
import { templateBySlug, TEMPLATES } from "@/lib/templates";

export function generateStaticParams() {
  return TEMPLATES.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: PageProps<"/templates/[slug]">): Promise<Metadata> {
  const t = templateBySlug((await params).slug);
  if (!t) return { title: "Template — Confu" };
  return {
    title: `${t.title}: a free study plan — Confu`,
    description: t.description,
    openGraph: { title: t.title, description: t.tagline, type: "article" },
    alternates: { canonical: `${SITE.url}/templates/${t.slug}` },
  };
}

export default async function TemplatePage({ params }: PageProps<"/templates/[slug]">) {
  const t = templateBySlug((await params).slug);
  if (!t) notFound();
  // For search engines: this page describes a free course.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: t.title,
    description: t.description,
    provider: { "@type": "Organization", name: "Confu", sameAs: SITE.url },
    isAccessibleForFree: true,
    educationalLevel: t.level,
    hasCourseInstance: { "@type": "CourseInstance", courseMode: "online", courseWorkload: `PT${Math.round((t.minutesPerDay * 7 * t.weeks) / 60)}H` },
  };

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <SiteNav />
      <main className="flex-1">
        <section className="border-b border-ink">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 lg:grid-cols-[minmax(0,1fr)_22rem] lg:py-20">
            <div>
              <Link href="/templates" className={`${eyebrowClass} hover:text-ink`}>
                ← Goal templates
              </Link>
              <h1 className="mt-4 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">{t.title}</h1>
              <p className="mt-3 font-serif text-xl text-muted">{t.tagline}</p>
              <p className="mt-6 max-w-2xl leading-relaxed">{t.description}</p>
              <p className="mt-6 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted">
                <span>{t.level}</span>
                <span aria-hidden>·</span>
                <span>
                  about {t.weeks} {t.weeks === 1 ? "week" : "weeks"} at {t.minutesPerDay} min a day
                </span>
                <span aria-hidden>·</span>
                <span>{t.sources.length} free sources</span>
              </p>
            </div>
            <aside className="self-start rounded-2xl border border-ink bg-panel p-6">
              <p className="font-serif text-xl">Start this goal</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {t.kind === "exam"
                  ? "Copying this starts an exam session, so you can sit a timed paper from the chapter. You still set your level, deadline and hours."
                  : "Confu brings the sources into a new session and fills in the goal. You set your level, deadline and hours, and get a plan made for you."}
              </p>
              <div className="mt-5">
                <Suspense fallback={<div className="h-11" />}>
                  <Start slug={t.slug} />
                </Suspense>
              </div>
            </aside>
          </div>
        </section>

        <section className="border-b border-ink bg-panel">
          <div className="mx-auto max-w-6xl px-6 py-14">
            <p className={eyebrowClass}>What you&apos;ll cover</p>
            <ol className="mt-6 grid gap-5 md:grid-cols-3">
              {t.outline.map((phase, i) => (
                <li key={phase.phase} className="rounded-xl border border-ink bg-paper/50 p-5">
                  <p className={eyebrowClass}>Phase {i + 1}</p>
                  <h2 className="mt-1 font-serif text-xl">{phase.phase}</h2>
                  <ul className="mt-3 space-y-2 text-sm">
                    {phase.topics.map((topic) => (
                      <li key={topic} className="flex gap-2.5">
                        <span className="mt-[0.5em] size-1.5 shrink-0 bg-ink" />
                        {topic}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-muted">An outline. Your own plan is made when you start, around your level and deadline.</p>
          </div>
        </section>

        <section className="border-b border-ink">
          <div className="mx-auto max-w-6xl px-6 py-14">
            <p className={eyebrowClass}>Sources</p>
            <h2 className="mt-2 font-serif text-3xl tracking-tight">Free, and fetched for you</h2>
            <ul className="mt-6 divide-y divide-ink/10 rounded-2xl border border-ink bg-panel">
              {t.sources.map((s) => (
                <li key={s.title} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                  <span className={`${eyebrowClass} w-20 shrink-0`}>{SOURCE_LABEL[s.kind]}</span>
                  <span className="min-w-0 flex-1 font-medium">{s.title}</span>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
                      {new URL(s.url).hostname.replace(/^www\./, "")} ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">All sources belong to their creators and are free to watch or read; Confu links to them and turns them into study PDFs for you.</p>
          </div>
        </section>

        <section className="bg-panel">
          <div className="mx-auto max-w-6xl px-6 py-14">
            <p className={eyebrowClass}>More templates</p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {TEMPLATES.filter((x) => x.slug !== t.slug)
                .slice(0, 4)
                .map((x) => (
                  <li key={x.slug}>
                    <Link href={`/templates/${x.slug}`} className="block rounded-xl border border-ink/25 bg-paper/50 p-4 transition hover:border-ink">
                      <span className="block font-medium">{x.title}</span>
                      <span className="mt-1 block text-xs text-muted">{x.tagline}</span>
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

async function Start({ slug }: { slug: string }) {
  const user = await getUser();
  return <CopyButton template={slug} signedIn={Boolean(user)} label="Start this goal" next={`/templates/${slug}`} />;
}

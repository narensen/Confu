import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import { CopyButton } from "@/components/packs/CopyButton";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { eyebrowClass } from "@/components/ui";
import { getUser } from "@/lib/dal";
import { SOURCE_LABEL, type Pack, type PackTopic } from "@/lib/packs";
import { courseCodeFor, getPackForViewer, getPackPublic, sectionScopeFor } from "@/lib/packs-server";
import { createClient } from "@/lib/supabase/server";

const KIND: Record<Pack["kind"], string> = { study: "Study pack", paper: "Paper pack", exam: "Exam pack" };

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const pack = await getPackPublic((await params).slug);
  if (!pack) return { title: "Study pack — Confu" };
  const sources = pack.content.sources?.length ?? 0;
  const label = pack.content.roadmap ? "Roadmap" : KIND[pack.kind];
  const description = pack.description || `${label} with ${sources} ${sources === 1 ? "source" : "sources"}${pack.content.plan ? " and a study plan" : ""}. Copy it into your Confu library for free.`;
  return {
    title: `${pack.title} — ${label} on Confu`,
    description,
    openGraph: { title: pack.title, description, type: "article" },
    // Unlisted packs are for people with the link, not search engines.
    robots: pack.visibility === "public" ? undefined : { index: false, follow: false },
  };
}

export default function PackPage({ params }: PageProps<"/p/[slug]">) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SiteNav />
      <main className="flex-1">
        <Suspense fallback={<PackSkeleton />}>
          <PackBody params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}

async function PackBody({ params }: { params: PageProps<"/p/[slug]">["params"] }) {
  const { slug } = await params;
  const [pack, user, course, scope] = await Promise.all([getPackForViewer(slug), getUser(), courseCodeFor(slug), sectionScopeFor(slug)]);
  if (!pack) notFound();
  if (!pack.mine) {
    after(async () => {
      await (await createClient()).rpc("pack_viewed", { p_slug: slug });
    });
  }

  const c = pack.content;
  const sources = c.sources ?? [];
  const topics = c.topics ?? [];
  const phases = c.plan?.phases?.length ? c.plan.phases : topics.length ? [{ title: "Plan", description: "" }] : [];
  const byPhase = (i: number): PackTopic[] => topics.filter((t) => (c.plan?.phases?.length ? t.phase === i : true));
  const highlights = (c.highlights ?? []).filter((h) => h.text);
  const label = c.roadmap ? "Roadmap" : KIND[pack.kind];

  return (
    <>
      {pack.mine && (
        <div className="border-b border-ink bg-yellow-100">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-6 py-2.5 text-sm">
            <span className="font-medium">{c.roadmap ? "This is your roadmap." : "This is your pack."}</span>
            <span className="font-mono text-xs text-muted">
              {pack.views} views · {pack.copies} copies · {pack.visibility === "public" ? "listed in the gallery" : "unlisted: only people with the link"}
            </span>
            {pack.class_mode && <span className="text-muted">Pro for the term once 30 classmates copy it.</span>}
            {pack.class_mode && (
              <Link href={`/p/${pack.slug}/class`} className="ml-auto font-medium underline underline-offset-4">
                Class progress →
              </Link>
            )}
          </div>
        </div>
      )}

      <section className="border-b border-ink">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 lg:grid-cols-[minmax(0,1fr)_22rem] lg:py-20">
          <div>
            <p className={eyebrowClass}>{label}</p>
            <h1 className="mt-3 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">{pack.title}</h1>
            {c.roadmap && (
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
                A roadmap: this session&apos;s plan, shared as a path. Copy it and the plan starts from today, with your own files.
              </p>
            )}
            {pack.description && <p className="mt-5 max-w-2xl text-lg leading-relaxed whitespace-pre-line text-muted">{pack.description}</p>}
            {scope.length > 0 && (
              <div className="mt-6 max-w-2xl">
                <p className={eyebrowClass}>Section paper</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted">
                  {scope.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-6 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted">
              <span>{pack.author_name ? `Shared by ${pack.author_name}` : "Shared anonymously"}</span>
              <span aria-hidden>·</span>
              <span>
                {sources.length} {sources.length === 1 ? "source" : "sources"}
              </span>
              {topics.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>{topics.length} topics</span>
                </>
              )}
              {highlights.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>{highlights.length} highlights</span>
                </>
              )}
              {pack.copies > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    copied {pack.copies} {pack.copies === 1 ? "time" : "times"}
                  </span>
                </>
              )}
            </p>
          </div>
          <aside className="self-start rounded-2xl border border-ink bg-panel p-6 shadow-[6px_6px_0_0_var(--ink)]">
            <p className="font-serif text-xl">Make it yours</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Copy it into your library: Confu fetches the papers, pages and lectures for you
              {c.plan ? ", and the plan starts today, at your pace" : ""}. Your notes and progress stay private
              {pack.class_mode ? " unless you choose to share them" : ""}.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              You can read the plan on this page before you have an account. An account starts when you copy it, highlight, or ask. Reading this page doesn&apos;t use the tutor.
            </p>
            {course && (
              <p className="mt-3 font-mono text-xs text-muted">
                Course link{" "}
                <a href={`/c/${course}`} className="text-ink underline underline-offset-2">
                  /c/{course}
                </a>
              </p>
            )}
            <div className="mt-5">
              <CopyButton
                slug={pack.slug}
                signedIn={Boolean(user)}
                classMode={pack.class_mode && !pack.mine}
                authorName={pack.author_name}
                label="Copy into my library"
                next={`/p/${pack.slug}`}
              />
            </div>
          </aside>
        </div>
      </section>

      {c.plan && (
        <section className="border-b border-ink bg-panel">
          <div className="mx-auto max-w-6xl px-6 py-14">
            <p className={eyebrowClass}>The plan</p>
            <h2 className="mt-2 max-w-3xl font-serif text-3xl leading-tight tracking-tight">{c.plan.goal_title || "The goal"}</h2>
            {(c.plan.goal_summary || c.plan.overview) && <p className="mt-3 max-w-3xl leading-relaxed text-muted">{c.plan.goal_summary || c.plan.overview}</p>}
            <p className="mt-3 font-mono text-xs text-muted">
              {c.plan.days} days · about {Math.round(c.plan.minutes_per_day)} min a day · {c.plan.level}
            </p>
            <ol className="mt-8 grid gap-5 md:grid-cols-2">
              {phases.map((phase, i) => {
                const list = byPhase(i);
                if (!list.length) return null;
                return (
                  <li key={i} className="rounded-xl border border-ink bg-paper/50 p-5">
                    <p className={eyebrowClass}>Phase {i + 1}</p>
                    <h3 className="mt-1 font-serif text-xl">{phase.title}</h3>
                    <ul className="mt-3 space-y-2 text-sm">
                      {list.map((t, j) => (
                        <li key={j} className="flex gap-2.5">
                          <span className="mt-[0.5em] size-1.5 shrink-0 bg-ink" />
                          <span>
                            {t.title}
                            {t.doc !== null && sources[t.doc] && (
                              <span className="ml-1.5 font-mono text-[11px] text-muted">
                                · {SOURCE_LABEL[sources[t.doc].kind]}
                                {t.page_start ? `, p. ${t.page_start}` : ""}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      )}

      <section className="border-b border-ink">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <p className={eyebrowClass}>Sources</p>
          <h2 className="mt-2 font-serif text-3xl tracking-tight">What&apos;s in it</h2>
          <ul className="mt-6 divide-y divide-ink/10 rounded-2xl border border-ink bg-panel">
            {sources.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                <span className={`${eyebrowClass} w-20 shrink-0`}>{SOURCE_LABEL[s.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{s.title}</span>
                  {s.kind === "paper" && s.authors?.length ? (
                    <span className="block text-xs text-muted">
                      {s.authors.slice(0, 3).join(", ")}
                      {s.authors.length > 3 ? " et al." : ""}
                      {s.year ? ` · ${s.year}` : ""}
                    </span>
                  ) : null}
                  {s.kind === "file" && <span className="block text-xs text-muted">The author&apos;s own file: you add your copy after copying the pack.</span>}
                </span>
                {s.url && hostOf(s.url) && (
                  <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
                    {hostOf(s.url)} ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {highlights.length > 0 && (
        <section className="border-b border-ink bg-panel">
          <div className="mx-auto max-w-6xl px-6 py-14">
            <p className={eyebrowClass}>Highlights</p>
            <h2 className="mt-2 font-serif text-3xl tracking-tight">What {pack.author_name ?? "the author"} marked</h2>
            <ul className="mt-6 grid gap-4 md:grid-cols-2">
              {highlights.slice(0, 12).map((h, i) => (
                <li key={i} className="rounded-xl border border-ink/20 bg-paper/60 p-5">
                  <blockquote className="font-serif text-lg leading-snug">“{h.text!.slice(0, 280)}{h.text!.length > 280 ? "…" : ""}”</blockquote>
                  {h.note && <p className="mt-2 text-sm leading-relaxed text-muted">{h.note.slice(0, 300)}</p>}
                  <p className="mt-2 font-mono text-[11px] text-muted">
                    {sources[h.doc]?.title ?? "Source"} · p. {h.page}
                  </p>
                </li>
              ))}
            </ul>
            {highlights.length > 12 && <p className="mt-4 text-sm text-muted">And {highlights.length - 12} more, in the pack.</p>}
          </div>
        </section>
      )}
    </>
  );
}

function hostOf(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

function PackSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-20">
      <div className="skeleton h-4 w-24 rounded" />
      <div className="skeleton h-12 w-2/3 rounded" />
      <div className="skeleton h-24 w-full max-w-2xl rounded" />
    </div>
  );
}

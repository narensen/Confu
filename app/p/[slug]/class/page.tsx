import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LocalTime } from "@/components/LocalTime";
import { eyebrowClass } from "@/components/ui";
import { requireUser } from "@/lib/dal";
import { getPackForViewer } from "@/lib/packs-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Class progress — Confu", robots: { index: false } };

type Member = {
  display_name: string;
  joined_at: string;
  topics_total: number;
  topics_done: number;
  mastery: number;
  active_days_7: number;
  active_days_30: number;
  reading_minutes: number;
  last_active: string | null;
};

// For a pack's author: the progress of people who copied it and chose to
// share it. Counts and dates only; never notes, answers or conversations.
export default function ClassPage({ params }: PageProps<"/p/[slug]/class">) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <Suspense fallback={<div className="skeleton h-64 rounded-2xl" />}>
          <ClassBody params={params} />
        </Suspense>
      </main>
    </div>
  );
}

async function ClassBody({ params }: { params: PageProps<"/p/[slug]/class">["params"] }) {
  const { slug } = await params;
  await requireUser();
  const pack = await getPackForViewer(slug);
  if (!pack || !pack.mine) notFound();
  const { data } = await (await createClient()).rpc("pack_class", { p_slug: slug });
  const members = ((data ?? []) as Member[]).sort((a, b) => (b.last_active ?? "").localeCompare(a.last_active ?? ""));
  const activeWeek = members.filter((m) => m.active_days_7 > 0).length;
  const completion = members.length
    ? Math.round((members.reduce((s, m) => s + (m.topics_total ? m.topics_done / m.topics_total : 0), 0) / members.length) * 100)
    : 0;
  const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

  return (
    <div className="animate-enter">
      <p className={eyebrowClass}>Class progress</p>
      <h1 className="mt-1 font-serif text-4xl tracking-tight">{pack.title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        People who copied this pack and chose to share their progress. You see how far they&apos;ve got, never their notes, answers or
        conversations. {pack.class_mode ? "" : "Class mode is off, so nobody new can share with you; turn it on from the session's Share button."}{" "}
        <Link href={`/p/${pack.slug}`} className="underline underline-offset-4 hover:text-ink">
          Open the pack
        </Link>
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Tile value={String(members.length)} label="sharing their progress" />
        <Tile value={String(activeWeek)} label="studied in the last 7 days" />
        <Tile value={`${completion}%`} label="of topics done, on average" />
      </div>

      {members.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-ink/40 bg-panel px-6 py-12 text-center">
          <p className="font-serif text-2xl">No one is sharing yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Share the pack&apos;s link with your class. When they copy it, they can tick “Share my progress” and they&apos;ll appear here.
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-2xl border border-ink bg-panel">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-ink text-left font-mono text-[11px] tracking-wider text-muted uppercase">
                <th className="px-5 py-3 font-medium">Student</th>
                <th className="px-3 py-3 font-medium">Topics done</th>
                <th className="px-3 py-3 text-right font-medium">Mastery</th>
                <th className="px-3 py-3 text-right font-medium">Days active (7 / 30)</th>
                <th className="px-3 py-3 text-right font-medium">Reading</th>
                <th className="px-5 py-3 text-right font-medium">Last active</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => {
                const pct = m.topics_total ? m.topics_done / m.topics_total : 0;
                return (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-5 py-3">
                      <span className="font-medium">{m.display_name}</span>
                      <span className="block text-xs text-muted">
                        joined <LocalTime iso={m.joined_at} />
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                          <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.round(pct * 100)}%` }} />
                        </span>
                        <span className="font-mono text-xs tabular-nums">
                          {m.topics_done}/{m.topics_total}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">{Math.round(m.mastery * 100)}%</td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                      {m.active_days_7} / {m.active_days_30}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">{hours(m.reading_minutes)}</td>
                    <td className="px-5 py-3 text-right text-xs text-muted">{m.last_active ? <LocalTime iso={m.last_active} /> : "Not yet"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-ink bg-panel p-5">
      <p className="font-serif text-4xl">{value}</p>
      <p className="mt-1 text-sm text-muted">{label}</p>
    </div>
  );
}

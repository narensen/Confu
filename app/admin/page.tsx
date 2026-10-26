import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminDashboard, type Insights } from "@/components/admin/AdminDashboard";
import { AppHeader } from "@/components/AppHeader";
import { getCurrentRole, requireUser } from "@/lib/dal";
import { isOwner } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Insights · Confu" };

const RANGES = [7, 30, 90] as const;

export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-24 sm:px-6">
        <Suspense fallback={<DashboardSkeleton />}>
          <Content searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/admin">["searchParams"] }) {
  await requireUser();
  // Owners only; everyone else sees a plain 404 (the database also refuses them).
  if (!isOwner(await getCurrentRole())) notFound();
  const requested = Number((await searchParams).days);
  const days = (RANGES as readonly number[]).includes(requested) ? requested : 30;

  const supabase = await createClient();
  const [{ data, error }, billing] = await Promise.all([supabase.rpc("admin_insights", { p_days: days }), supabase.rpc("billing_summary")]);
  if (error || !data) {
    return (
      <div className="animate-enter rounded-xl border border-danger/50 bg-panel px-6 py-8">
        <p className="font-serif text-2xl">Insights aren&apos;t set up yet</p>
        <p className="mt-2 text-sm text-muted">
          Run <code className="font-mono">supabase/migrations/0018_insights.sql</code> in the Supabase SQL editor, then refresh.
        </p>
        {error && <p className="mt-3 font-mono text-xs text-danger">{error.message}</p>}
      </div>
    );
  }
  const b = billing.data as { active: number; india: number; cancelling: number; invited_pro: number; referrals: number } | null;
  return (
    <>
      {b && (
        <section aria-label="Pro" className="animate-enter mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              [b.active, "paying Pro subscribers", `${b.india} in India`],
              [b.cancelling, "cancelled, still active", "until their paid month ends"],
              [b.invited_pro, "on Pro from invites", "right now"],
              [b.referrals, "accounts joined by invite", "all time"],
            ] as const
          ).map(([value, label, note]) => (
            <div key={label} className="rounded-xl border border-ink bg-panel p-4">
              <p className="font-sans text-3xl font-semibold">{value}</p>
              <p className="mt-0.5 text-sm">{label}</p>
              <p className="text-xs text-muted">{note}</p>
            </div>
          ))}
        </section>
      )}
      <AdminDashboard data={data as Insights} days={days} ranges={[...RANGES]} />
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-12 w-72 rounded" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-28 rounded-xl border border-ink/20" />
        ))}
      </div>
      <div className="skeleton h-64 rounded-xl border border-ink/20" />
    </div>
  );
}

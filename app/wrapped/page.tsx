import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { eyebrowClass } from "@/components/ui";
import { WrappedCards } from "@/components/wrapped/WrappedCards";
import { WrappedShare } from "@/components/wrapped/WrappedShare";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { defaultMonth, monthYear, type Wrapped } from "@/lib/wrapped";

export const metadata: Metadata = { title: "Your month — Confu" };

export default function WrappedPage({ searchParams }: PageProps<"/wrapped">) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
        <Suspense fallback={<div className="skeleton h-96 rounded-3xl" />}>
          <Body searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/wrapped">["searchParams"] }) {
  const user = await requireUser();
  const raw = (await searchParams).m;
  const month = typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw) ? raw : defaultMonth();
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const tz = (profile as { timezone?: string | null } | null)?.timezone || "UTC";
  const [{ data, error }, share] = await Promise.all([
    supabase.rpc("my_wrapped", { p_month: `${month}-01`, p_tz: tz }),
    supabase.from("wrapped_shares").select("token").eq("user_id", user.id).eq("month", `${month}-01`).maybeSingle(),
  ]);
  if (error || !data) {
    return <p className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">{/my_wrapped/.test(error?.message ?? "") ? "Wrapped needs migration 0025 to be run in Supabase." : "Couldn't load your month."}</p>;
  }
  // The last six months to pick from.
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1)).toISOString().slice(0, 7));

  return (
    <div className="animate-enter space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={eyebrowClass}>Wrapped</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight">{monthYear(`${month}-01`)}</h1>
        </div>
        <nav aria-label="Months" className="flex flex-wrap gap-1.5">
          {months.map((m) => (
            <Link
              key={m}
              href={`/wrapped?m=${m}`}
              aria-current={m === month ? "page" : undefined}
              className={`rounded-md border px-2.5 py-1 font-mono text-xs transition ${m === month ? "border-ink bg-ink text-white" : "border-ink/25 hover:border-ink"}`}
            >
              {new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}
            </Link>
          ))}
        </nav>
      </div>
      <WrappedCards w={data as Wrapped} />
      <WrappedShare month={month} initialToken={(share.data?.token as string | undefined) ?? null} />
    </div>
  );
}

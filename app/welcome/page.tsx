import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/AuthCard";
import { WelcomeForm } from "@/components/auth/WelcomeForm";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Welcome — Confu" };

export default function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  return (
    <AuthCard title="Welcome to Confu" subtitle="Three quick questions so we can build Confu for you.">
      <Suspense fallback={<div className="skeleton h-72 rounded-xl" />}>
        <Welcome searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

// After Google sign-in: ask the sign-up questions once, then continue.
async function Welcome({ searchParams }: { searchParams: PageProps<"/welcome">["searchParams"] }) {
  const next = safeNext((await searchParams).next ?? decodeURIComponent((await cookies()).get("confu_next")?.value ?? ""));
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const profile = data as { occupation?: string | null } | null;
  // Already answered (e.g. signed up with email), or the survey isn't set up yet.
  if (!profile || profile.occupation !== null) redirect(next);
  return <WelcomeForm next={next} name={user.name} />;
}

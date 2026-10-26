import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { AccountMenu } from "@/components/AccountMenu";
import { Guide } from "@/components/onboarding/Guide";
import { getKeyInfo } from "@/lib/groq-keys";
import { isOwner, planOf } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRole, getFirstTime, getUser } from "@/lib/dal";

export function Logo() {
  return (
    <span className="font-serif text-xl font-semibold tracking-tight">
      Confu<span className="text-yellow-500">.</span>
    </span>
  );
}

async function UserMenu() {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const [role, firstTime, key] = await Promise.all([getCurrentRole(), getFirstTime(), getKeyInfo(supabase, user.id, null)]);
  return (
    <div className="animate-fade flex items-center">
      {/* No button: opens by itself for new accounts, or from Settings. */}
      <Guide userId={user.id} firstTime={firstTime} needsKey={planOf(role) !== "pro"} />
      <Link href="/review" className="rounded-md px-2 py-1 text-sm font-medium text-muted transition hover:bg-paper hover:text-ink">
        Review
      </Link>
      <Link href="/rooms" className="mr-3 hidden rounded-md px-2 py-1 text-sm font-medium text-muted transition hover:bg-paper hover:text-ink sm:block">
        Rooms
      </Link>
      <AccountMenu name={user.name} email={user.email} plan={planOf(role)} owner={isOwner(role)} keyLast4={key?.last4 ?? null} />
    </div>
  );
}

export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    // Its own layer above the page, so the account dropdown is never painted over.
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-4 border-b border-ink bg-panel px-5">
      <Link href="/dashboard" className="transition hover:opacity-70">
        <Logo />
      </Link>
      <div className="min-w-0 flex-1">{children}</div>
      <Suspense fallback={<div className="skeleton h-8 w-32 rounded-lg" />}>
        <UserMenu />
      </Suspense>
    </header>
  );
}

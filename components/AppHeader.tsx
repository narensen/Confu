import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { AccountMenu } from "@/components/AccountMenu";
import { CommandPalette, PaletteButton } from "@/components/CommandPalette";
import { Guide } from "@/components/onboarding/Guide";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { PrimaryNav, SessionNav } from "@/components/PrimaryNav";
import { RoomStatus } from "@/components/rooms/RoomStatus";
import { getKeyInfo } from "@/lib/groq-keys";
import { isOwner } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRole, getFirstTime, getUser } from "@/lib/dal";

export function Logo() {
  return (
    <span className="font-serif text-xl font-semibold tracking-tight">
      Confu<span className="text-brand">.</span>
    </span>
  );
}

async function UserMenu({ workspace }: { workspace: boolean }) {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const [role, firstTime, key] = await Promise.all([getCurrentRole(), getFirstTime(), getKeyInfo(supabase, user.id, null)]);
  return (
    <div className="animate-fade flex shrink-0 items-center gap-1.5">
      {/* No button: opens by itself for new accounts, or from Settings. */}
      <Guide userId={user.id} firstTime={firstTime} needsKey={!isOwner(role) && !key} />
      {/* Go to… (Ctrl/Cmd+K): sessions, places and, in a session, its tools. */}
      <CommandPalette />
      {workspace ? <SessionNav /> : <PaletteButton />}
      {/* The room you're in, with its timer (and its voice, if you're talking). */}
      <RoomStatus />
      <div className="flex shrink-0 items-center gap-2 border-l border-line pl-2.5">
        <NotificationBell userId={user.id} />
        <AccountMenu name={user.name} email={user.email} owner={isOwner(role)} keyLast4={key?.last4 ?? null} />
      </div>
    </div>
  );
}

// The main places, for signed-in people only.
async function MainNav() {
  return (await getUser()) ? <PrimaryNav /> : null;
}

// Logo, the app's places (or, in a session, its title), then Go to…
// (Ctrl/Cmd+K), the room you're in, notifications and your account. In a
// session the places give way to the title; the logo, with a back chevron,
// returns to the library, and Go to… reaches everything else.
export function AppHeader({ children }: { children?: ReactNode }) {
  const workspace = Boolean(children);
  return (
    // Its own layer above the page, so the account dropdown is never painted over.
    <header className="glass-bar sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-ink px-3 sm:px-5">
      {/* In a session the logo is also the way back: a chevron says so. */}
      <Link
        href="/dashboard"
        className="group flex shrink-0 items-center gap-1 transition hover:opacity-70"
        aria-label={workspace ? "Back to your library" : "Confu, your library"}
        title={workspace ? "Back to your library" : undefined}
      >
        {workspace && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="-ml-1 text-muted transition-transform group-hover:-translate-x-0.5 sm:size-3.5">
            <path d="m15 18-6-6 6-6" />
          </svg>
        )}
        {/* On a phone a session needs the width for its title: the chevron alone leads back. */}
        <span className={workspace ? "hidden sm:inline" : undefined}>
          <Logo />
        </span>
      </Link>
      {workspace ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 border-l border-line pl-3">{children}</div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center pl-2">
          <Suspense fallback={null}>
            <MainNav />
          </Suspense>
        </div>
      )}
      <Suspense fallback={<div className="skeleton h-8 w-24 rounded-full" />}>
        <UserMenu workspace={workspace} />
      </Suspense>
    </header>
  );
}

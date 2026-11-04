import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { AccountMenu } from "@/components/AccountMenu";
import { Guide } from "@/components/onboarding/Guide";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { PrimaryNav } from "@/components/PrimaryNav";
import { RoomStatus } from "@/components/rooms/RoomStatus";
import { serverKeysReady } from "@/lib/ai-access";
import { keyLabel, PROVIDERS } from "@confu/ai/providers";
import { getKeyInfo } from "@/lib/ai-keys";
import { isOwner } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRole, getFirstTime, getUser } from "@/lib/dal";

export function Logo() {
  return (
    <span className="font-serif text-xl font-semibold tracking-tight">
      Confu<span className="text-yellow-500">.</span>
    </span>
  );
}

async function UserMenu({ workspace }: { workspace: boolean }) {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const [role, firstTime, key] = await Promise.all([getCurrentRole(), getFirstTime(), getKeyInfo(supabase, user.id, null)]);
  const owner = isOwner(role);
  return (
    <div className="animate-fade flex shrink-0 items-center gap-1.5">
      {/* No button: opens by itself for new accounts, or from Settings. */}
      <Guide userId={user.id} firstTime={firstTime} needsKey={!(owner && serverKeysReady())} />
      {workspace && <PrimaryNav variant="icons" />}
      {/* The room you're in, with its timer (and its voice, if you're talking). */}
      <RoomStatus />
      <div className="flex shrink-0 items-center gap-2 border-l border-line pl-2.5">
        <NotificationBell userId={user.id} />
        <AccountMenu
          name={user.name}
          email={user.email}
          owner={owner}
          ai={key ? { provider: PROVIDERS[key.provider].name, label: keyLabel(key.provider, key.last4, key.via) } : null}
        />
      </div>
    </div>
  );
}

// The main places, for signed-in people only.
async function MainNav() {
  return (await getUser()) ? <PrimaryNav /> : null;
}

// Logo, the app's places (or, in a session, its title), then the room
// you're in, notifications and your account. In a session the places
// shrink to icons on the right, so the title has the room it needs.
export function AppHeader({ children }: { children?: ReactNode }) {
  const workspace = Boolean(children);
  return (
    // Its own layer above the page, so the account dropdown is never painted over.
    <header className="glass-bar sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-ink px-3 sm:px-5">
      <Link href="/dashboard" className="shrink-0 transition hover:opacity-70" aria-label="Confu, your library">
        <Logo />
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

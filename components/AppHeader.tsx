import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { signOut } from "@/app/(auth)/actions";
import { getCurrentRole, getUser } from "@/lib/dal";

export function Logo() {
  return (
    <span className="font-serif text-xl font-semibold tracking-tight">
      Confu<span className="text-yellow-500">.</span>
    </span>
  );
}

async function UserMenu() {
  const [user, role] = await Promise.all([getUser(), getCurrentRole()]);
  if (!user) return null;
  const initial = (user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase();
  return (
    <div className="animate-fade flex items-center gap-3 text-sm">
      {role === "admin" && <span className="rounded border border-ink px-1.5 py-px font-mono text-[10px] uppercase tracking-wider">Admin</span>}
      <span className="hidden text-muted sm:inline">{user.name ?? user.email}</span>
      <span className="flex size-7 items-center justify-center rounded-full border border-ink font-mono text-xs">{initial}</span>
      <form action={signOut}>
        <button className="rounded-md px-2 py-1 text-muted transition hover:bg-paper hover:text-ink">Sign out</button>
      </form>
    </div>
  );
}

export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-ink bg-panel px-5">
      <Link href="/dashboard" className="transition hover:opacity-70">
        <Logo />
      </Link>
      <div className="min-w-0 flex-1">{children}</div>
      <Suspense fallback={<div className="skeleton h-6 w-28 rounded" />}>
        <UserMenu />
      </Suspense>
    </header>
  );
}

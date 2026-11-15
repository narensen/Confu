import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/AppHeader";
import { ghostButtonClass, ButtonLink } from "@/components/ui";
import { getUser } from "@/lib/dal";
import { SITE } from "@/lib/site";
import { MobileMenu } from "./MobileMenu";

// The one top bar for every public page, the landing page included: logo,
// a few links (in a menu on a phone), and sign-in or "Home".
export const SITE_LINKS = [
  { href: "/templates", label: "Templates" },
  { href: "/packs", label: "Study packs" },
  { href: "/roadmaps", label: "Roadmaps" },
  { href: "/changelog", label: "What's new" },
  { href: SITE.repo, label: "GitHub" },
];

export function SiteNav({ links = SITE_LINKS }: { links?: { href: string; label: string }[] }) {
  return (
    <nav className="glass-bar sticky top-0 z-30 border-b border-ink">
      <div className="relative mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6">
        <Link href="/" className="transition hover:opacity-70">
          <Logo />
        </Link>
        <div className="hidden items-center gap-6 text-sm text-muted md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="transition hover:text-ink">
              {l.label}
            </Link>
          ))}
        </div>
        {/* The rest is static; only these buttons depend on who's signed in. */}
        <Suspense fallback={<div className="h-9 w-48" />}>
          <NavActions links={links} />
        </Suspense>
      </div>
    </nav>
  );
}

async function NavActions({ links }: { links: { href: string; label: string }[] }) {
  const user = await getUser();
  return (
    <div className="animate-fade flex items-center gap-2">
      {user ? (
        <ButtonLink href="/dashboard">
          Home
        </ButtonLink>
      ) : (
        <>
          <Link href="/login" className={`${ghostButtonClass} hidden sm:inline-flex`}>
            Sign in
          </Link>
          <ButtonLink href="/signup">
            Get started
          </ButtonLink>
        </>
      )}
      <MobileMenu links={links} signedIn={Boolean(user)} />
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-ink bg-panel">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-sm text-muted">
        <div className="flex items-center gap-4">
          <Logo />
          <span className="hidden sm:inline">Free and open source. A study aid: AI can make mistakes, so check important facts.</span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {SITE_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-ink">
              {l.label}
            </Link>
          ))}
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink">
            Terms
          </Link>
        </div>
      </div>
    </footer>
  );
}

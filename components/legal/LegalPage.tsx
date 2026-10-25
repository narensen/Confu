import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/AppHeader";
import { eyebrowClass } from "@/components/ui";
import { SITE } from "@/lib/site";

export function LegalPage({
  eyebrow,
  title,
  summary,
  updated = SITE.policyDate,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: ReactNode;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <nav className="flex items-center justify-between border-b border-ink bg-panel px-6 py-4">
        <Link href="/" className="transition hover:opacity-70">
          <Logo />
        </Link>
        <div className="flex gap-4 text-sm text-muted">
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink">
            Terms &amp; disclaimer
          </Link>
        </div>
      </nav>
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-12">
        <p className={`${eyebrowClass} animate-enter`}>{eyebrow}</p>
        <h1 className="animate-enter mt-1 font-serif text-4xl tracking-tight">{title}</h1>
        <p className="mt-2 font-mono text-xs text-muted">Last updated {updated}</p>
        <div className="animate-enter mt-8 rounded-xl border border-ink bg-panel p-5 shadow-hard-sm">
          <p className={eyebrowClass}>In short</p>
          <div className="mt-2 text-sm leading-relaxed">{summary}</div>
        </div>
        <div className="legal mt-10 space-y-8 text-[0.94rem] leading-relaxed">{children}</div>
        <p className="mt-12 border-t border-line pt-6 text-sm text-muted">
          Questions? Email{" "}
          <a href={`mailto:${SITE.contactEmail}`} className="text-ink underline underline-offset-4">
            {SITE.contactEmail}
          </a>
          .
        </p>
      </main>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-2xl">{title}</h2>
      <div className="mt-3 space-y-3 text-ink/85">{children}</div>
    </section>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-[0.6em] size-1.5 shrink-0 bg-ink" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

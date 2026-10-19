import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/AppHeader";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-paper px-4 py-12">
      <div className="animate-enter w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center transition hover:opacity-70">
          <Logo />
        </Link>
        <div className="rounded-2xl border border-ink bg-panel p-7 shadow-hard">
          <h1 className="font-serif text-[1.7rem] leading-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
      </div>
    </main>
  );
}

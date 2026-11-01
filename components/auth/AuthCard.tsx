import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/AppHeader";
import { AuthShowcase } from "./AuthShowcase";

// Sign-in pages: the form on the left, a glimpse of the product on the right
// (desktop only).
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="grid min-h-dvh flex-1 bg-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-7 sm:px-10">
        <Link href="/" className="self-start transition hover:opacity-70">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-sm">
            <h1 className="animate-enter font-serif text-4xl leading-tight tracking-tight">{title}</h1>
            {subtitle && (
              <p className="animate-enter mt-2 text-muted" style={{ animationDelay: "50ms" }}>
                {subtitle}
              </p>
            )}
            {/* No transform here. Chrome will not attach its password manager,
                or paste into the password field, while an ancestor is transformed. */}
            <div className="mt-8">{children}</div>
            {footer && (
              <div className="animate-enter mt-8 border-t border-line pt-6 text-sm text-muted" style={{ animationDelay: "150ms" }}>
                {footer}
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-muted">
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <span className="mx-2">·</span>
          <Link href="/terms" className="hover:text-ink">
            Terms &amp; disclaimer
          </Link>
        </p>
      </div>
      <AuthShowcase />
    </main>
  );
}

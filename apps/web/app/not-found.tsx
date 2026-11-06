import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found · Confu" };

export default function NotFound() {
  return (
    <main className="animate-enter flex flex-1 flex-col items-center justify-center bg-paper px-6 py-20 text-center">
      <p className="font-serif text-[7rem] leading-none font-semibold tracking-tight">
        404<span className="text-yellow-500">.</span>
      </p>
      <h1 className="mt-4 font-serif text-3xl tracking-tight">This page isn&apos;t in any of your books.</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">The link may be old, or the session was deleted.</p>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <Link
          href="/dashboard"
          className="rounded-lg border border-ink bg-ink px-4 py-2 text-sm font-medium text-white transition"
        >
          Go to your library
        </Link>
        <Link href="/" className="rounded-lg border border-ink bg-panel px-4 py-2 text-sm font-medium transition">
          Confu home
        </Link>
      </div>
    </main>
  );
}

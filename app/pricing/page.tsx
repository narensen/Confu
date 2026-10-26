import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { buttonClass, eyebrowClass } from "@/components/ui";
import { billingConfigured, currentRegion, STUDENT_CODE } from "@/lib/billing";
import { getUser } from "@/lib/dal";
import { PLANS } from "@/lib/plans";
import { PRICES } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing — Confu",
  description: "Confu is free to use with your own AI key. Pro runs on ours: ₹299 a month in India, $6 everywhere else. Cancel anytime.",
};

const FAQ: { q: string; a: ReactNode }[] = [
  { q: "Is anything locked behind Pro?", a: "No. Every feature is in both plans. Pro only changes whose AI key does the work, so there's nothing to set up and no free-tier limits to watch." },
  { q: "Can I cancel anytime?", a: "Yes, from Settings → Plan → Manage billing, in two clicks. Pro stays on until the end of the month you paid for." },
  {
    q: "What happens when Pro ends?",
    a: "You're back on Free. Nothing is deleted: your sessions, files, notes and progress stay exactly as they are. To keep using the AI, add a free Groq key in Settings.",
  },
  {
    q: "Why ₹299 in India?",
    a: "Prices follow where you are, so Pro costs about the same share of a student budget everywhere. In India it's charged in US dollars at about ₹299; your bank shows the exact rupee amount.",
  },
  {
    q: "Who handles the payment?",
    a: "Lemon Squeezy, our payment partner and the merchant of record: they process the card, add any sales tax or GST, and send your receipts. Confu never sees your card number.",
  },
  {
    q: "Refunds?",
    a: (
      <>
        If Pro isn&apos;t for you, email us within 7 days of a payment for a full refund. See the{" "}
        <Link href="/terms#billing" className="underline underline-offset-4">
          terms
        </Link>
        .
      </>
    ),
  },
  {
    q: "Can I get Pro without paying?",
    a: "Yes: invite friends from Settings → Invite friends. Each friend gets a week of Pro when they join, and you get a week once they've studied.",
  },
];

export default function PricingPage({ searchParams }: PageProps<"/pricing">) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <SiteNav />
      <main className="flex-1">
        <section className="border-b border-ink">
          <div className="mx-auto max-w-6xl px-6 pt-16 pb-14 sm:pt-20">
            <p className={eyebrowClass}>Pricing</p>
            <h1 className="mt-3 max-w-3xl font-serif text-5xl leading-[1.05] tracking-tight sm:text-6xl">
              Learn properly. <span className="bg-[linear-gradient(transparent_62%,var(--marker)_62%)]">Pay only for the shortcut.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
              Every feature is in both plans. Pro just runs on our AI keys, so there&apos;s nothing to set up and no limits to babysit.
            </p>
            <Suspense fallback={null}>
              <Notice searchParams={searchParams} />
            </Suspense>
          </div>
        </section>

        <section className="border-b border-ink">
          <div className="mx-auto grid max-w-6xl gap-6 px-6 py-14 md:grid-cols-2">
            <article className="flex flex-col rounded-2xl border border-ink bg-panel p-8">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-serif text-4xl">{PLANS.free.name}</h2>
                <span className="rounded-full border border-ink/30 px-3 py-1 font-mono text-[11px] text-muted uppercase">Free forever</span>
              </div>
              <Suspense fallback={<p className="mt-6 font-serif text-5xl">0</p>}>
                <FreePrice preview={searchParams} />
              </Suspense>
              <p className="mt-1 text-sm text-muted">10 free prompts on our keys, then your own free Groq key.</p>
              <Features list={PLANS.free.features} />
              <Suspense fallback={<div className="mt-10 h-11" />}>
                <FreeAction />
              </Suspense>
            </article>
            <article className="flex flex-col rounded-2xl border border-ink bg-ink p-8 text-white shadow-[6px_6px_0_0_#facc15]">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-serif text-4xl">
                  {PLANS.pro.name}
                  <span className="text-yellow-400">.</span>
                </h2>
                <span className="rounded-full bg-yellow-300 px-3 py-1 font-mono text-[11px] text-ink uppercase">No setup</span>
              </div>
              <Suspense fallback={<div className="mt-6 h-[4.5rem]" />}>
                <ProPrice preview={searchParams} />
              </Suspense>
              <Features list={PLANS.pro.features} pro />
              <Suspense fallback={<div className="mt-10 h-11" />}>
                <ProAction />
              </Suspense>
            </article>
          </div>
          {STUDENT_CODE && (
            <div className="mx-auto max-w-6xl px-6 pb-14">
              <p className="rounded-xl border border-ink bg-yellow-100 px-5 py-4 text-sm leading-relaxed">
                <span className="font-medium">Students:</span> sign up with your college email (.edu, .ac.in and the like) and the student discount is
                applied at checkout automatically.
              </p>
            </div>
          )}
        </section>

        <section className="bg-panel">
          <div className="mx-auto max-w-3xl px-6 py-20">
            <p className={eyebrowClass}>Questions</p>
            <h2 className="mt-2 font-serif text-4xl tracking-tight">Before you upgrade</h2>
            <div className="mt-8 divide-y divide-ink/15 rounded-2xl border border-ink bg-panel">
              {FAQ.map((f) => (
                <details key={f.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {f.q}
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-ink text-sm transition-transform duration-300 ease-fluid group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function Features({ list, pro }: { list: string[]; pro?: boolean }) {
  return (
    <ul className="mt-8 flex-1 space-y-3 text-sm">
      {list.map((f) => (
        <li key={f} className="flex gap-3">
          <svg viewBox="0 0 16 16" aria-hidden className={`mt-0.5 size-4 shrink-0 ${pro ? "text-yellow-300" : ""}`}>
            <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {f}
        </li>
      ))}
    </ul>
  );
}

// In the same currency as Pro's price beside it.
async function FreePrice({ preview }: { preview: PageProps<"/pricing">["searchParams"] }) {
  const region = await currentRegion(((await preview).region as string | undefined) ?? null);
  return <p className="mt-6 font-serif text-5xl">{region === "india" ? "₹0" : "$0"}</p>;
}

async function ProPrice({ preview }: { preview: PageProps<"/pricing">["searchParams"] }) {
  const region = await currentRegion(((await preview).region as string | undefined) ?? null);
  const price = PRICES[region];
  return (
    <>
      <p className="mt-6 font-serif text-5xl">
        {price.amount}
        <span className="ml-1 font-sans text-base text-white/60">/ {price.per}</span>
      </p>
      <p className="mt-1 text-sm text-white/60">{price.note} Cancel anytime.</p>
    </>
  );
}

async function FreeAction() {
  const user = await getUser();
  return (
    <div className="mt-10">
      <Link href={user ? "/dashboard" : "/signup"} className={`${buttonClass} px-5 py-2.5`}>
        {user ? "Go to your library" : "Start free"}
      </Link>
    </div>
  );
}

async function ProAction() {
  const user = await getUser();
  if (!billingConfigured) {
    return (
      <div className="mt-10">
        <Link href={user ? "/settings#plan" : "/signup"} className="inline-flex items-center gap-2 rounded-lg border border-white bg-white px-5 py-2.5 text-sm font-medium text-ink">
          {user ? "Request Pro →" : "Create your account →"}
        </Link>
        <p className="mt-3 text-xs text-white/50">Checkout opens soon. Until then, request Pro in Settings → Plan.</p>
      </div>
    );
  }
  return (
    <div className="mt-10">
      <a
        href={user ? "/api/billing/checkout" : "/signup?next=/pricing"}
        className="inline-flex items-center gap-2 rounded-lg border border-white bg-white px-5 py-2.5 text-sm font-medium text-ink transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-[3px_3px_0_0_#facc15] active:translate-y-0"
      >
        Get Pro →
      </a>
      <p className="mt-3 text-xs text-white/50">{user ? "Secure checkout by Lemon Squeezy." : "Create a free account first; you can upgrade straight after."}</p>
    </div>
  );
}

async function Notice({ searchParams }: { searchParams: PageProps<"/pricing">["searchParams"] }) {
  const billing = (await searchParams).billing;
  if (billing !== "error" && billing !== "unavailable") return null;
  return (
    <p role="alert" className="mt-6 max-w-2xl rounded-lg border border-danger/50 bg-danger/5 px-4 py-3 text-sm text-danger">
      {billing === "error" ? "Couldn't open the checkout just now. Try again in a minute." : "Checkout isn't open yet. Request Pro from Settings → Plan in the meantime."}
    </p>
  );
}

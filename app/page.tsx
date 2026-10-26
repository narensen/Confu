import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Logo } from "@/components/AppHeader";
import { AccountDeletedNotice } from "@/components/landing/AccountDeletedNotice";
import { DemoVideo } from "@/components/landing/DemoVideo";
import { LandingMotion, Words } from "@/components/landing/LandingMotion";
import { ExamMock, PaperMock, PlanMock, WorkspaceMock } from "@/components/landing/Mocks";
import { buttonClass, eyebrowClass, ghostButtonClass } from "@/components/ui";
import { getUser } from "@/lib/dal";
import { Reels } from "@/components/landing/Reels";
import { SiteFooter } from "@/components/site/SiteNav";
import { currentRegion } from "@/lib/billing";
import { PLANS } from "@/lib/plans";
import { PRICES } from "@/lib/pricing";
import { TEMPLATES } from "@/lib/templates";

export const metadata: Metadata = {
  title: "Confu — understand it deeply, not just skim it",
  description:
    "An AI tutor that works from your own material. Study toward a goal, prepare for exams with practice questions from your notes, or read research papers in three passes.",
};

const MODES = [
  {
    tag: "Study",
    title: "Learn toward a goal",
    body: "Tell Confu what you want to be able to do and by when. It maps your PDFs into a phased plan, uses them where they help, and fills the gaps with lectures and readings.",
    points: ["Phased plan paced to your deadline", "Topics beyond your PDFs, with resources", "Teach me / check my understanding"],
    mock: <PlanMock />,
  },
  {
    tag: "Exam prep",
    title: "Practise from your own notes",
    body: "Upload your college notes and past papers. Get exam-style questions written from them, marked instantly, each linked to the page with the answer.",
    points: ["Multiple choice and short answers, marked", "Weak topics found from your results", "Countdown to the exam"],
    mock: <ExamMock />,
  },
  {
    tag: "Papers",
    title: "Read research the right way",
    body: "Add papers by arXiv ID, DOI or title. No PDF hunting. Read them with Keshav's three-pass method, with a coach that pushes you to think.",
    points: ["Triage: which papers deserve a deep read", "Five Cs, explain-back, re-implementation", "A literature map of what cites what"],
    mock: <PaperMock />,
  },
];

const FEATURES: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "Highlight and ask",
    body: "Select any passage to ask a doubt, summarise it, see its context, or have it explained simply.",
    icon: <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3ZM14 7l3 3" />,
  },
  {
    title: "Reads figures and equations",
    body: "Drag over a chart, table or equation. A vision model reads it, and the tutor explains it.",
    icon: <path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M8 15l3-3 2 2 3-4" />,
  },
  {
    title: "Cites the page",
    body: "Answers come from your material with page references you can click, so you can always check.",
    icon: <path d="M6 2h9l5 5v15H6zM14 2v6h6M9 13h7M9 17h5" />,
  },
  {
    title: "Remembers you",
    body: "It tracks what you understand and where you struggle, so it builds on that instead of repeating itself.",
    icon: <path d="M12 3a7 7 0 0 0-4 12.7V19h8v-3.3A7 7 0 0 0 12 3ZM9 22h6" />,
  },
  {
    title: "Many PDFs, one place",
    body: "Bring a textbook, lecture slides and a paper together. The tutor searches across all of them.",
    icon: <path d="M8 3h10v14H8zM5 6v15h11" />,
  },
  {
    title: "Stays on your goal",
    body: "Off-topic? It answers briefly and steers back. Stuck? It changes how it explains rather than repeating.",
    icon: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />,
  },
  {
    title: "Bring anything",
    body: "PDFs and slides, web pages and whole courses, YouTube lectures, Google Drive and Zotero all become study material.",
    icon: <path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" />,
  },
  {
    title: "Review before you forget",
    body: "Finished topics and the passages you asked about come back as quick questions, just before they'd fade.",
    icon: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />,
  },
  {
    title: "Study alongside others",
    body: "Join a study room: a shared focus timer and a few people quietly working with you. No chat, no noise.",
    icon: <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" />,
  },
];

const STEPS = [
  { title: "Bring your material", body: "Upload PDFs (notes, textbooks, slides), or add papers by arXiv ID or DOI." },
  { title: "Say what you're aiming for", body: "A learning goal, an exam date, or a research question. That's what keeps the tutor focused." },
  { title: "Learn actively", body: "Highlight, ask, practise and explain back. Confu tracks your progress as you go." },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Is Confu free?",
    a: "Yes. Every account starts with 10 free prompts on our keys, no setup. After that, Free runs on your own Groq API key, and Groq has a free tier, so you still don't pay anyone. Pro keeps running on our keys for ₹299 a month in India, $6 elsewhere.",
  },
  {
    q: "Why do I need a Groq API key?",
    a: "On Free, it keeps Confu free and makes the AI's usage yours: you can see exactly how much you've used and what's left in Settings. Getting a key takes a minute at console.groq.com. On Pro you don't need one.",
  },
  {
    q: "What's Pro?",
    a: "The same Confu, running on our own Groq keys: no API key, no setup, with a generous daily allowance you can see in your account menu. It's ₹299 a month in India and $6 elsewhere, cancel anytime. Invite friends and you each get a free week.",
  },
  {
    q: "How much can I do on Groq's free tier?",
    a: "Roughly 25–50 tutor answers a day, fewer for maths-heavy notes, as an estimate. Confu shows what's left of today's allowance in every session.",
  },
  {
    q: "What happens to my API key?",
    a: (
      <>
        It&apos;s checked with Groq, encrypted before it&apos;s stored, and used only to run the requests you make in Confu. It&apos;s
        never shared, sold or logged, and you can remove it any time. Details are in the{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          privacy policy
        </Link>
        .
      </>
    ),
  },
  {
    q: "Which PDFs work?",
    a: "Any PDF: notes, textbooks, slides, papers, past papers. Scanned or phone-photographed pages, including handwriting, are read by a vision model when you upload them, so the tutor can search and cite them too. Very messy handwriting may come out partly illegible.",
  },
  {
    q: "Can the AI be wrong?",
    a: "Yes. That's why every answer points to the page it came from, and why Confu asks you questions instead of only giving answers. Check anything important against your course material.",
  },
];

export default function Home() {
  return (
    <LandingMotion className="flex flex-1 flex-col bg-panel">
      {/* Without JavaScript, show everything the motion script would reveal. */}
      <noscript>
        <style>{`.motion-pending [data-hero],.motion-pending [data-word],.motion-pending [data-split],.motion-pending [data-reveal],.motion-pending [data-reveal-item],.motion-pending [data-slide-item]{visibility:visible!important}`}</style>
      </noscript>
      <Suspense fallback={null}>
        <AccountDeletedNotice />
      </Suspense>
      {/* Nav */}
      <nav className="sticky top-0 z-30 border-b border-ink bg-panel/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <Logo />
          <div className="hidden items-center gap-6 text-sm text-muted md:flex">
            <a href="#demo" className="transition hover:text-ink">
              Demo
            </a>
            <a href="#modes" className="transition hover:text-ink">
              Modes
            </a>
            <Link href="/templates" className="transition hover:text-ink">
              Templates
            </Link>
            <Link href="/pricing" className="transition hover:text-ink">
              Pricing
            </Link>
            <a href="#faq" className="transition hover:text-ink">
              FAQ
            </a>
          </div>
          {/* The page is static; only these buttons depend on who's signed in. */}
          <Suspense fallback={<div className="h-9 w-48" />}>
            <NavActions />
          </Suspense>
        </div>
      </nav>

      {/* Hero */}
      <section data-hero-section className="relative overflow-hidden border-b border-ink">
        <div
          aria-hidden
          data-parallax="grid"
          className="pointer-events-none absolute inset-0 opacity-[0.35] bg-[linear-gradient(var(--line)_1px,transparent_1px),linear-gradient(90deg,var(--line)_1px,transparent_1px)] bg-size-[44px_44px] mask-[linear-gradient(to_bottom,black,transparent_85%)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pt-16 pb-24 lg:grid-cols-[1fr_1.15fr] lg:pt-24 lg:pb-32">
          <div data-parallax="copy">
            <p data-hero="eyebrow" className={eyebrowClass}>
              For students, exam-takers and researchers
            </p>
            <h1 className="mt-4 font-serif text-5xl leading-[1.04] tracking-tight sm:text-6xl">
              <Words text="Understand it deeply," />{" "}
              <span data-hero="mark" className="bg-[linear-gradient(transparent_62%,#fde047_62%)] bg-no-repeat">
                <Words text="not just skim it." />
              </span>
            </h1>
            <p data-hero="lede" className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              Confu is an AI tutor that works from <span className="text-ink">your own material</span>: your notes, textbooks and papers.
              It plans what to learn, answers the doubts you highlight, quizzes you before exams, and remembers what you&apos;ve
              understood.
            </p>
            {/* Animated as a wrapper: the buttons themselves stream in per request. */}
            <div data-hero="cta">
              <Suspense fallback={<div className="mt-9 h-12" />}>
                <HeroActions />
              </Suspense>
            </div>
            <p data-hero="note" className="mt-6 font-mono text-xs text-muted">
              Free to start · Works with any text PDF · Your key, used only for you
            </p>
          </div>
          <div data-parallax="mock" className="lg:pl-4">
            <div data-hero="mock">
              <WorkspaceMock />
            </div>
          </div>
        </div>
      </section>

      {/* The real product, in 20 seconds */}
      <section id="demo" className="scroll-mt-16 border-b border-ink">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <p data-reveal className={eyebrowClass}>
              See it work
            </p>
            <h2 data-split className="mt-2 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">Highlight a line. Ask. Get the page.</h2>
            <p data-reveal className="mt-4 text-lg leading-relaxed text-muted">
              Select the sentence you don&apos;t get and ask why. The answer works from your own PDF, and the page it cites opens with a
              click.
            </p>
          </div>
          <div data-reveal className="mt-12">
            <DemoVideo />
          </div>
          <p data-reveal className="mt-4 font-mono text-xs text-muted">The real Confu workspace. The tutor&apos;s reply is a sample answer.</p>
        </div>
      </section>

      {/* Reels */}
      <section className="border-b border-ink bg-paper">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <p data-reveal className={eyebrowClass}>
              In under 30 seconds
            </p>
            <h2 data-split className="mt-2 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">How studying should feel.</h2>
          </div>
          <div data-reveal-group className="mt-14">
            <Reels />
          </div>
        </div>
      </section>

      {/* Modes */}
      <section id="modes" className="scroll-mt-16 border-b border-ink bg-paper">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <p data-reveal className={eyebrowClass}>
              Three ways to learn
            </p>
            <h2 data-split className="mt-2 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">One tutor, shaped to what you&apos;re doing.</h2>
            <p data-reveal className="mt-4 text-lg leading-relaxed text-muted">Every session starts by asking what you&apos;re there for, and changes how it helps.</p>
          </div>
          <div data-reveal-group className="mt-14 grid gap-6 lg:grid-cols-3">
            {MODES.map((m) => (
              <article
                key={m.tag}
                data-reveal-item
                className="group flex flex-col rounded-2xl border border-ink bg-panel transition-[translate,box-shadow] duration-300 ease-fluid hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--ink)]"
              >
                <div className="flex min-h-64 flex-col justify-center border-b border-ink bg-paper/60 p-5">{m.mock}</div>
                <div className="flex flex-1 flex-col p-6">
                  <p className={eyebrowClass}>{m.tag}</p>
                  <h3 className="mt-1.5 font-serif text-2xl leading-tight">{m.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{m.body}</p>
                  <ul className="mt-5 space-y-2 text-sm">
                    {m.points.map((p) => (
                      <li key={p} className="flex gap-2.5">
                        <span className="mt-[0.5em] size-1.5 shrink-0 bg-ink" />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-16 border-b border-ink">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <p data-reveal className={eyebrowClass}>
              In every session
            </p>
            <h2 data-split className="mt-2 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">Built for understanding, not summaries.</h2>
          </div>
          <div data-reveal-group className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-ink bg-ink sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} data-reveal-item className="bg-panel p-7 transition-colors duration-300 hover:bg-paper">
                <svg data-draw width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {f.icon}
                </svg>
                <h3 className="mt-4 font-serif text-xl">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-b border-ink bg-paper">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <p data-reveal className={eyebrowClass}>
              How it works
            </p>
            <h2 data-split className="mt-2 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">Three steps. Then just learn.</h2>
          </div>
          <ol data-reveal-group className="mt-14 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} data-reveal-item className="relative rounded-2xl border border-ink bg-panel p-7">
                <span className="font-serif text-6xl leading-none text-ink/10">0{i + 1}</span>
                <h3 className="mt-4 font-serif text-2xl">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Templates */}
      <section id="templates" className="scroll-mt-16 border-b border-ink">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p data-reveal className={eyebrowClass}>
                Not sure where to start?
              </p>
              <h2 data-split className="mt-2 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">Start from a goal.</h2>
              <p data-reveal className="mt-4 text-lg leading-relaxed text-muted">
                Templates come with free lectures, readings and papers, already picked. Or copy a study pack another learner shared.
              </p>
            </div>
            <div data-reveal className="flex gap-2">
              <Link href="/templates" className={`${ghostButtonClass} px-5 py-2.5`}>
                All templates
              </Link>
              <Link href="/packs" className={`${ghostButtonClass} px-5 py-2.5`}>
                Study packs
              </Link>
            </div>
          </div>
          <ul data-reveal-group className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {TEMPLATES.slice(0, 6).map((t) => (
              <li key={t.slug} data-reveal-item>
                <Link
                  href={`/templates/${t.slug}`}
                  className="group flex h-full flex-col rounded-2xl border border-ink bg-panel p-6 transition-[translate,box-shadow] duration-300 ease-fluid hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--ink)]"
                >
                  <span className="font-serif text-2xl leading-snug">{t.title}</span>
                  <span className="mt-2 text-sm leading-relaxed text-muted">{t.tagline}</span>
                  <span className="mt-auto pt-5 font-mono text-[11px] text-muted">
                    {t.sources.length} free sources · {t.weeks} {t.weeks === 1 ? "week" : "weeks"} · start →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Our approach: sincere about what this is */}
      <section id="honest" className="scroll-mt-16 border-b border-ink">
        <div className="mx-auto grid max-w-6xl gap-14 px-6 py-24 lg:grid-cols-2">
          <div>
            <p data-reveal className={eyebrowClass}>
              Our approach
            </p>
            <h2 data-split className="mt-2 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">What Confu is, and isn&apos;t.</h2>
            <p data-reveal className="mt-5 text-lg leading-relaxed text-muted">
              Confu won&apos;t do your learning for you. It&apos;s built on a simple belief: you understand something when you can
              explain it, apply it and spot what&apos;s wrong with it. So it asks as much as it answers.
            </p>
          </div>
          <ul data-slide-group className="space-y-px overflow-hidden rounded-2xl border border-ink bg-ink">
            {[
              ["Grounded, and honest about limits", "Answers cite the page they came from. When something isn't in your material, it says so. AI can still be wrong, so check what matters."],
              ["Your key is yours", "Your Groq key is encrypted, used only for your requests, and never shared, sold or logged."],
              ["No ads, no tracking", "No advertising, no analytics cookies, and we don't train AI models on your notes."],
              ["Your data, your call", "Delete a session and its PDFs, notes and conversations go with it. Export everything, or delete your account, from Settings."],
            ].map(([title, body]) => (
              <li key={title} data-slide-item className="bg-panel p-6">
                <p className="font-medium">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="scroll-mt-16 border-b border-ink bg-paper">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <p data-reveal className={eyebrowClass}>
              Plans
            </p>
            <h2 data-split className="mt-2 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">Start free. Skip the setup with Pro.</h2>
            <p data-reveal className="mt-4 text-lg leading-relaxed text-muted">
              Every feature is in both. The only difference is whose AI key does the work.
            </p>
          </div>
          <div data-reveal-group className="mt-14 grid gap-6 md:grid-cols-2">
            {(["free", "pro"] as const).map((p) => (
              <article
                key={p}
                data-reveal-item
                className={`flex flex-col rounded-2xl border border-ink p-8 ${p === "pro" ? "bg-ink text-white" : "bg-panel"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-serif text-4xl">
                    {PLANS[p].name}
                    {p === "pro" && <span className="text-yellow-400">.</span>}
                  </h3>
                  {p === "pro" ? (
                    <Suspense fallback={<span className="h-7 w-24" />}>
                      <ProPriceBadge />
                    </Suspense>
                  ) : (
                    <span className="rounded-full border border-ink/30 px-3 py-1 font-mono text-[11px] text-muted uppercase">Free forever</span>
                  )}
                </div>
                <p className={`mt-3 text-lg ${p === "pro" ? "text-white/70" : "text-muted"}`}>{PLANS[p].tagline}</p>
                <ul className="mt-8 flex-1 space-y-3 text-sm">
                  {PLANS[p].features.map((f) => (
                    <li key={f} className="flex gap-3">
                      <svg viewBox="0 0 16 16" aria-hidden className={`mt-0.5 size-4 shrink-0 ${p === "pro" ? "text-yellow-300" : ""}`}>
                        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                {p === "pro" ? (
                  <div className="mt-10">
                    <Link
                      href="/pricing"
                      className="inline-flex items-center gap-2 rounded-lg border border-white bg-white px-5 py-2.5 text-sm font-medium text-ink transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-[3px_3px_0_0_#facc15] active:translate-y-0"
                    >
                      Get Pro →
                    </Link>
                    <p className="mt-3 text-xs text-white/50">Cancel anytime. Or invite friends: you each get a free week.</p>
                  </div>
                ) : (
                  <div className="mt-10">
                    <Link href="/signup" className={`${buttonClass} px-5 py-2.5`}>
                      Create your free account
                    </Link>
                    <p className="mt-3 text-xs text-muted">Starts with 10 free prompts. After that, add a free Groq API key.</p>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 border-b border-ink bg-paper">
        <div className="mx-auto max-w-3xl px-6 py-24">
          <div>
            <p data-reveal className={eyebrowClass}>
              Questions
            </p>
            <h2 data-split className="mt-2 font-serif text-4xl tracking-tight sm:text-5xl">Before you start</h2>
          </div>
          <div data-reveal-group className="mt-10 divide-y divide-ink/15 rounded-2xl border border-ink bg-panel">
            {FAQ.map((f) => (
              <details key={f.q} data-reveal-item className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
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

      {/* Final call to action */}
      <section className="bg-ink text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-6 py-24 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 data-split className="max-w-2xl font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
              Your notes already have the answers. <span className="text-yellow-400">Learn them properly.</span>
            </h2>
            <p data-reveal className="mt-4 text-white/60">Free to start. Bring a PDF, a paper ID, or an exam date.</p>
          </div>
          <div data-reveal>
            <Suspense fallback={<div className="h-12 w-44" />}>
              <FinalAction />
            </Suspense>
          </div>
        </div>
      </section>

      <SiteFooter />
    </LandingMotion>
  );
}

async function NavActions() {
  const user = await getUser();
  return (
    <div className="animate-fade flex gap-2">
      {user ? (
        <Link href="/dashboard" className={buttonClass}>
          Home
        </Link>
      ) : (
        <>
          <Link href="/login" className={`${ghostButtonClass} hidden sm:inline-flex`}>
            Sign in
          </Link>
          <Link href="/signup" className={buttonClass}>
            Get started
          </Link>
        </>
      )}
    </div>
  );
}

async function HeroActions() {
  const user = await getUser();
  return (
    <div className="mt-9 flex flex-wrap gap-3">
      {user ? (
        <Link href="/dashboard" className={`${buttonClass} px-6 py-3 text-base`}>
          Go to your library
        </Link>
      ) : (
        <>
          <Link data-magnetic href="/signup" className={`${buttonClass} px-6 py-3 text-base`}>
            Start learning, free
          </Link>
          <a href="#demo" className={`${ghostButtonClass} px-6 py-3 text-base`}>
            Watch the 20-second demo
          </a>
        </>
      )}
    </div>
  );
}

async function FinalAction() {
  const user = await getUser();
  return (
    <Link
      data-magnetic
      href={user ? "/dashboard" : "/signup"}
      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-white bg-white px-6 py-3 text-base font-medium text-ink transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-[3px_3px_0_0_#facc15] active:translate-y-0"
    >
      {user ? "Go to your library" : "Create your free account"} →
    </Link>
  );
}

async function ProPriceBadge() {
  const price = PRICES[await currentRegion()];
  return (
    <span className="rounded-full bg-yellow-300 px-3 py-1 font-mono text-[11px] text-ink uppercase">
      {price.amount}/{price.per === "month" ? "mo" : price.per}
    </span>
  );
}

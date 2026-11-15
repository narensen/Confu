import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { AccountDeletedNotice } from "@/components/landing/AccountDeletedNotice";
import { DemoVideo } from "@/components/landing/DemoVideo";
import { LandingMotion, Words } from "@/components/landing/LandingMotion";
import { ExamMock, PaperMock, PlanMock, WorkspaceMock } from "@/components/landing/Mocks";
import { buttonClass, ghostButtonClass, Eyebrow } from "@/components/ui";
import { getUser } from "@/lib/dal";
import { SiteFooter, SiteNav } from "@/components/site/SiteNav";
import { SITE } from "@/lib/site";
import { siteStats } from "@/lib/site-stats";

export const metadata: Metadata = {
  title: "Confu — understand it deeply, not just skim it",
  description:
    "An AI tutor that works from your own material. Study toward a goal, prepare for exams with practice questions from your notes, or read research papers in three passes.",
};

const MODES = [
  {
    tag: "Study",
    title: "Learn toward a goal",
    body: "Tell Confu what you want to be able to do and by when. It maps your files into a phased plan, uses them where they help, and fills the gaps with lectures and readings.",
    points: ["Phased plan paced to your deadline", "Topics beyond your files, with resources", "Teach me / check my understanding"],
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
    title: "Bring anything",
    body: "PDFs and slides, web pages printed to PDF, YouTube lectures, Google Drive and Zotero all become study material.",
    icon: <path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" />,
  },
  {
    title: "Review before you forget",
    body: "Finished topics and the passages you asked about come back as quick questions, just before they'd fade.",
    icon: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />,
  },

];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Is Confu free?",
    a: (
      <>
        Yes, and it&apos;s open source. There&apos;s no paid plan. The tutor runs on an AI you bring: a free Groq API key, or Claude,
        ChatGPT, Gemini or Grok if you&apos;re already signed in to one on your computer. The code is on{" "}
        <a href={SITE.repo} className="underline underline-offset-4">
          GitHub
        </a>
        .
      </>
    ),
  },
  {
    q: "How do I bring my own AI?",
    a: "Either add a Groq key in Settings (it takes a minute at console.groq.com, and Groq has a free tier), or pick Claude, ChatGPT, Gemini or Grok from Tutors in a session. Confu asks once, then finds the one signed in on your computer by itself.",
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
    q: "Which files work?",
    a: "Any PDF, plus PowerPoint and Word files (converted through your Google Drive). Scanned or photographed pages, including handwriting, are read by a vision model so the tutor can search and cite them too.",
  },
  {
    q: "Can the AI be wrong?",
    a: "Yes. That's why every answer points to the page it came from, and why Confu asks you questions instead of only giving answers. Check anything important against your course material.",
  },
];

export default function Home() {
  return (
    <LandingMotion className="glow-page flex flex-1 flex-col bg-panel">
      {/* Without JavaScript, show everything the motion script would reveal. */}
      <noscript>
        <style>{`.motion-pending [data-hero],.motion-pending [data-word],.motion-pending [data-split],.motion-pending [data-reveal],.motion-pending [data-reveal-item],.motion-pending [data-slide-item]{visibility:visible!important}`}</style>
      </noscript>
      <Suspense fallback={null}>
        <AccountDeletedNotice />
      </Suspense>
      <SiteNav />

      {/* Hero */}
      <section data-hero-section className="relative overflow-hidden border-b border-ink">
        <div
          aria-hidden
          data-parallax="grid"
          className="pointer-events-none absolute inset-0 opacity-[0.35] bg-[linear-gradient(var(--line)_1px,transparent_1px),linear-gradient(90deg,var(--line)_1px,transparent_1px)] bg-size-[44px_44px] mask-[linear-gradient(to_bottom,black,transparent_85%)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pt-16 pb-24 lg:grid-cols-[1fr_1.15fr] lg:pt-24 lg:pb-32">
          <div data-parallax="copy">
            <Eyebrow data-hero="eyebrow">
              For students, exam-takers and researchers
            </Eyebrow>
            <h1 className="mt-4 font-serif text-5xl leading-[1.04] tracking-tight sm:text-6xl">
              <Words text="Understand it deeply," />{" "}
              <span data-hero="mark" className="bg-[linear-gradient(transparent_62%,var(--marker)_62%)] bg-no-repeat">
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
              Free and open source · Bring your own AI · Works with any PDF
            </p>
          </div>
          <div data-parallax="mock" className="lg:pl-4">
            <div data-hero="mock">
              <WorkspaceMock />
            </div>
          </div>
        </div>
      </section>

      {/* Real numbers, only the ones that can be counted */}
      <Suspense fallback={null}>
        <Proof />
      </Suspense>

      {/* The real product, in 20 seconds */}
      <section id="demo" className="scroll-mt-16 border-b border-ink">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <Eyebrow data-reveal>
              See it work
            </Eyebrow>
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

      {/* Modes */}
      <section id="modes" className="scroll-mt-16 border-b border-ink bg-paper">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <Eyebrow data-reveal>
              Three ways to learn
            </Eyebrow>
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
                  <Eyebrow>{m.tag}</Eyebrow>
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
            <Eyebrow data-reveal>
              In every session
            </Eyebrow>
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

      {/* Open source, your AI */}
      <section id="open-source" className="scroll-mt-16 border-b border-ink bg-paper">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <Eyebrow data-reveal>
              Free and open source
            </Eyebrow>
            <h2 data-split className="mt-2 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">No plans. No paywall. Your AI.</h2>
            <p data-reveal className="mt-4 text-lg leading-relaxed text-muted">
              Every feature is free for everyone. Confu doesn&apos;t sell AI; it teaches with the one you already have.
            </p>
          </div>
          <div data-reveal-group className="mt-14 grid gap-6 md:grid-cols-3">
            {[
              {
                title: "A free Groq key",
                body: "Make one at console.groq.com in a minute and add it in Settings. It's encrypted, and used only for your requests.",
              },
              {
                title: "The AI on your computer",
                body: "Signed in to Claude, ChatGPT, Gemini or Grok? Confu asks once, then finds it by itself each time a session opens.",
              },
              {
                title: "Read it, run it, change it",
                body: "The code is on GitHub. Host your own copy, check what it does with your notes, or send a fix.",
              },
            ].map((c) => (
              <article key={c.title} data-reveal-item className="flex flex-col rounded-2xl border border-ink bg-panel p-7">
                <h3 className="font-serif text-2xl">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{c.body}</p>
              </article>
            ))}
          </div>
          <ul data-reveal className="mt-10 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {[
              "Answers cite the page they came from, and say so when something isn't in your material.",
              "No ads, no analytics cookies, and no training AI models on your notes.",
              "Delete a session and its files, notes and conversations go with it.",
              "Export everything, or delete your account, from Settings.",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <span className="mt-[0.55em] size-1.5 shrink-0 bg-ink" />
                {t}
              </li>
            ))}
          </ul>
          <div data-reveal className="mt-10 flex flex-wrap gap-3">
            <a href={SITE.repo} className={`${ghostButtonClass} px-5 py-2.5`}>
              View on GitHub
            </a>
            <Link href="/templates" className={`${ghostButtonClass} px-5 py-2.5`}>
              Start from a template
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 border-b border-ink bg-paper">
        <div className="mx-auto max-w-3xl px-6 py-24">
          <div>
            <Eyebrow data-reveal>
              Questions
            </Eyebrow>
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
      <section className="surface-inverse">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-6 py-24 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 data-split className="max-w-2xl font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
              Your notes already have the answers. <span className="text-brand">Learn them properly.</span>
            </h2>
            <p data-reveal className="mt-4 text-on-ink/60">Free for everyone. Bring a file, a paper ID, or an exam date.</p>
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
      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-on-ink bg-on-ink px-6 py-3 text-base font-medium text-ink transition duration-200 ease-fluid hover:-translate-y-px hover:shadow-[3px_3px_0_0_var(--brand)] active:translate-y-0"
    >
      {user ? "Go to your library" : "Create your free account"} →
    </Link>
  );
}

// Real counts and GitHub stars. Hidden when there's nothing honest to show.
async function Proof() {
  const stats = await siteStats();
  const fmt = (n: number) => new Intl.NumberFormat("en", { notation: n >= 10_000 ? "compact" : "standard" }).format(n);
  const rows: { n: number | null; label: string }[] = [
    { n: stats.students, label: "students" },
    { n: stats.sessions, label: "study sessions" },
    { n: stats.answers, label: "questions answered" },
    { n: stats.stars, label: "stars on GitHub" },
  ];
  const items = rows.filter((r): r is { n: number; label: string } => typeof r.n === "number" && r.n > 0);
  if (!items.length) return null;
  return (
    <section aria-label="Confu in numbers" className="border-b border-ink bg-paper">
      <ul className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-center gap-x-12 gap-y-4 px-6 py-8 text-center">
        {items.map(({ n, label }) => (
          <li key={label}>
            <span className="block font-serif text-3xl">{fmt(n)}</span>
            <span className="text-sm text-muted">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

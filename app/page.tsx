import Link from "next/link";
import { Logo } from "@/components/AppHeader";
import { buttonClass, eyebrowClass, ghostButtonClass } from "@/components/ui";

const steps = [
  { title: "Set a goal", body: "Say what you want to be able to do and by when. Draft it with any AI if you like: the goal drives everything." },
  { title: "Bring your material", body: "Upload the PDF you're learning from and list your lectures. The plan uses the PDF where it helps and fills the gaps with outside resources." },
  { title: "Highlight and ask", body: "Select text to ask a doubt, summarize, or see its context. Drag over a figure or equation and a vision model reads it." },
  { title: "It remembers", body: "Your tutor tracks what you understand and where you struggle, builds on it, and keeps you moving toward the goal." },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-panel">
      <nav className="flex items-center justify-between border-b border-ink px-6 py-4">
        <Logo />
        <div className="flex gap-2">
          <Link href="/login" className={ghostButtonClass}>
            Sign in
          </Link>
          <Link href="/signup" className={buttonClass}>
            Get started
          </Link>
        </div>
      </nav>

      <section className="mx-auto w-full max-w-5xl px-6 py-20 sm:py-28">
        <p className={`${eyebrowClass} animate-enter`}>A tutor for serious learning</p>
        <h1
          className="animate-enter mt-4 max-w-3xl font-serif text-5xl leading-[1.05] tracking-tight sm:text-6xl"
          style={{ animationDelay: "60ms" }}
        >
          Understand it deeply, <span className="bg-[linear-gradient(transparent_62%,#fde047_62%)]">not just skim it.</span>
        </h1>
        <p className="animate-enter mt-6 max-w-xl text-lg leading-relaxed text-muted" style={{ animationDelay: "120ms" }}>
          Set a goal and a deadline. Confu plans the path across your PDF and beyond it, answers the doubts you highlight, and
          remembers what you&apos;ve mastered so it never just repeats itself.
        </p>
        <div className="animate-enter mt-9 flex gap-3" style={{ animationDelay: "180ms" }}>
          <Link href="/signup" className={`${buttonClass} px-6 py-3 text-base`}>
            Start learning
          </Link>
          <Link href="/login" className={`${ghostButtonClass} px-6 py-3 text-base`}>
            I have an account
          </Link>
        </div>
      </section>

      <section className="border-t border-ink bg-paper">
        <div className="mx-auto grid w-full max-w-5xl gap-px border-x border-ink bg-ink sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <div key={s.title} className="animate-enter bg-paper p-6" style={{ animationDelay: `${240 + i * 70}ms` }}>
              <p className="font-mono text-xs text-muted">0{i + 1}</p>
              <h2 className="mt-3 font-serif text-xl">{s.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, LegalPage, Section } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Terms & Disclaimer — Confu",
  description: "The rules for using Confu, and the limits of AI-generated study help.",
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="Terms & Disclaimer"
      updated="November 3, 2026"
      summary={
        <Bullets
          items={[
            <>Confu is a study aid. Its answers, plans and suggested resources are AI-generated and can be wrong.</>,
            <>Double-check anything important against your course material, instructors or other trusted sources.</>,
            <>Only upload material you have the right to use, and use Confu to learn, not to cheat.</>,
            <>Confu is free and open source under the MIT License. Its AI runs on an account you bring, and that provider&apos;s terms and prices apply.</>,
            <>
              We only use your API key to run your requests. See the{" "}
              <Link href="/privacy" className="underline underline-offset-4">
                Privacy Policy
              </Link>
              .
            </>,
          ]}
        />
      }
    >
      <Section title="AI disclaimer">
        <p>
          Confu uses large language models to explain material, build study plans, describe figures and estimate your
          progress. These models can make mistakes, misread a page or figure, cite the wrong page, or state things
          confidently that aren&apos;t true.
        </p>
        <Bullets
          items={[
            <>Verify important facts, formulas and conclusions yourself.</>,
            <>
              Study plans, schedules, mastery estimates and suggested resources are guidance, not guarantees. Suggested
              resources are search links; check that you&apos;ve found the right material.
            </>,
            <>
              Confu is not professional advice. Don&apos;t rely on it for medical, legal, financial, safety or other
              high-stakes decisions.
            </>,
            <>Using Confu doesn&apos;t guarantee any grade, exam result or outcome.</>,
          ]}
        />
      </Section>

      <Section title="Your account">
        <p>
          Keep your login details secure. You&apos;re responsible for activity on your account. Tell us if you think
          someone else has accessed it.
        </p>
      </Section>

      <Section title="Your content">
        <Bullets
          items={[
            <>
              You keep ownership of the PDFs and anything else you upload. You let us store and process them only to
              provide Confu to you.
            </>,
            <>
              Only upload material you have the right to use, such as your own notes or documents you&apos;re licensed to
              read. Don&apos;t upload material that infringes others&apos; rights, is illegal, or contains other
              people&apos;s sensitive personal data.
            </>,
          ]}
        />
      </Section>

      <Section title="Your AI provider and costs">
        <p>
          Confu doesn&apos;t sell anything: there are no plans or subscriptions. Its AI features run on the AI you connect: an API
          key from a provider (such as Groq, OpenAI, Anthropic or Google), your OpenRouter account, or a model server you
          choose. You&apos;re responsible for that account and any usage or charges under its provider&apos;s terms. New accounts
          may get a few free prompts on our own keys to try Confu first. We use your key only to run the requests you make in
          Confu, as described in the{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>

      <Section title="Invites">
        <p>Invite links are for real people who want to study. Don&apos;t use them to spam.</p>
      </Section>

      <Section title="Sharing: study packs, Wrapped and rooms">
        <Bullets
          items={[
            <>
              You&apos;re responsible for what you publish. A study pack shares links, paper identifiers, your plan and, if you
              choose, your highlights and notes; never files. A roadmap is that same page, with the plan shown as a path.
              Only share highlights and notes you&apos;re happy to make public, and don&apos;t include other people&apos;s personal
              information.
            </>,
            <>
              Threads are visible to people signed in. A subject space is too. A space you create is visible only to people
              with its link. Don&apos;t post someone else&apos;s personal information, and don&apos;t post anything you wouldn&apos;t say in a
              class. If a post states something wrong, Confu may show a labelled correction. The original stays.
            </>,
            <>
              When someone copies your pack, the copy is theirs. Unpublishing your pack doesn&apos;t remove copies already made.
            </>,
            <>
              In study rooms, use a name you&apos;re comfortable showing and keep what you write respectful. In a private
              room&apos;s voice, don&apos;t record the others without them agreeing. Voice isn&apos;t recorded by Confu. A screen
              share is the same: live between the browsers, and not recorded by Confu.
            </>,
            <>
              A sitting card and a page pin follow the same rule: don&apos;t publish other people&apos;s personal information.
              A sitting shares a score, not the questions. A pin shares a passage and one answer, not a chat.
            </>,
            <>
              A section hand-in stays private. A sitting card exists only if that person chooses to share one. A miss map
              shows topic names and counts, not names of people. A crib shows objectives and pages, not a file. A library
              hour doesn&apos;t record who came. A reading list is titles and links, not files, and Confu doesn&apos;t fetch NCERT
              textbooks. A section page after the paper is counts, labelled as copies, not a ranking.
            </>,
            <>
              Course-link requests count opens of a link, not people, and they don&apos;t store an IP address. Cite mode drops
              a reply that doesn&apos;t cite a page in that session. An explain-back gap stays on the account that made it
              and comes back in review.
            </>,
            <>We may remove packs, roadmaps, threads, spaces, shared pages, sitting cards, pins, miss maps, cribs, reading lists, library hours, section pages or rooms that break these terms.</>,
          ]}
        />
      </Section>

      <Section title="Acceptable use">
        <Bullets
          items={[
            <>Use Confu to learn. Follow your school&apos;s or employer&apos;s rules on AI tools and academic honesty.</>,
            <>Don&apos;t try to access other users&apos; data, overload the service, or misuse it.</>,
            <>Don&apos;t use Confu to create harmful, illegal or deceptive content.</>,
          ]}
        />
        <p>We may suspend accounts that break these rules.</p>
      </Section>

      <Section title="The service">
        <p>
          Confu is provided as is and as available. We work to keep it reliable, but we can&apos;t promise it will
          always be available or error-free, and features may change. To the extent the law allows, we aren&apos;t liable
          for indirect losses arising from your use of Confu or from AI-generated content. Keep your own copies of
          important files.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We may update these terms. We&apos;ll change the date at the top and show significant changes in the app.
          Continuing to use Confu means you accept the updated terms.
        </p>
      </Section>
    </LegalPage>
  );
}

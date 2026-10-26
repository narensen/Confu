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
      updated="October 26, 2026"
      summary={
        <Bullets
          items={[
            <>Confu is a study aid. Its answers, plans and suggested resources are AI-generated and can be wrong.</>,
            <>Double-check anything important against your course material, instructors or other trusted sources.</>,
            <>Only upload material you have the right to use, and use Confu to learn, not to cheat.</>,
            <>Pro renews monthly until you cancel; cancel any time, and ask for a refund within 7 days of a payment.</>,
            <>
              We only use your Groq key to run your requests. See the{" "}
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

      <Section title="Your Groq API key and costs">
        <p>
          Unless your account has been given access to ours, Confu&apos;s AI features run on your own Groq API key.
          You&apos;re responsible for your Groq account and any usage or charges under Groq&apos;s terms. We use your key
          only to run the requests you make in Confu, as described in the{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>

      <Section title="Pro subscriptions and billing" id="billing">
        <Bullets
          items={[
            <>
              Pro is sold through Lemon Squeezy, our reseller and merchant of record, which processes the payment, adds any
              sales tax, VAT or GST, and sends your receipts. Its terms apply to the purchase.
            </>,
            <>
              Pro renews automatically every month at the price shown at checkout until you cancel. Cancel any time from
              Settings → Plan → Manage billing; Pro stays on until the end of the month you&apos;ve paid for.
            </>,
            <>
              <b>Refunds:</b> if Pro isn&apos;t for you, email us within 7 days of a payment and we&apos;ll refund it in full.
            </>,
            <>
              Pro includes a generous daily allowance of AI use on our keys, shown in your account menu; it exists so the
              service stays fast and fair for everyone.
            </>,
            <>
              Prices can vary by country. If we change the price, we&apos;ll tell you at least 30 days before it applies to your
              next renewal.
            </>,
            <>
              If a payment fails, Pro stays on while it&apos;s retried; if it can&apos;t be collected, your account returns to
              Free. Nothing is deleted either way.
            </>,
          ]}
        />
      </Section>

      <Section title="Invites">
        <p>
          Inviting friends earns weeks of Pro for both of you, within the limits shown in Settings. Invites are for real
          people who want to study: rewards from fake or duplicate accounts may be removed.
        </p>
      </Section>

      <Section title="Sharing: study packs, Wrapped and rooms">
        <Bullets
          items={[
            <>
              You&apos;re responsible for what you publish. A study pack shares links, paper identifiers, your plan and, if you
              choose, your highlights and notes; never files. Only share highlights and notes you&apos;re happy to make public,
              and don&apos;t include other people&apos;s personal information.
            </>,
            <>
              When someone copies your pack, the copy is theirs. Unpublishing your pack doesn&apos;t remove copies already made.
            </>,
            <>
              In study rooms, use a name you&apos;re comfortable showing and keep what you write respectful.
            </>,
            <>We may remove packs, shared pages or rooms that break these terms.</>,
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

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
      summary={
        <Bullets
          items={[
            <>Confu is a study aid. Its answers, plans and suggested resources are AI-generated and can be wrong.</>,
            <>Double-check anything important against your course material, instructors or other trusted sources.</>,
            <>Only upload material you have the right to use, and use Confu to learn, not to cheat.</>,
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

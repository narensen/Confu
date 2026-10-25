import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, LegalPage, Section } from "@/components/legal/LegalPage";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy — Confu",
  description: "What Confu stores, why, who processes it, and how your Groq API key is protected.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy Policy"
      updated="October 25, 2026"
      summary={
        <Bullets
          items={[
            <>We store only what the app needs to work: your account, the PDFs you upload, and your study data.</>,
            <>
              <b>Your Groq API key is used only to run the requests you make in Confu.</b> We never use it for anything
              else, never share or sell it, never log it, and store it encrypted.
            </>,
            <>We don&apos;t sell your data, show ads, or use tracking or analytics cookies.</>,
            <>
              We measure how Confu is used with our own analytics, kept in our own database. No third-party trackers, and
              we honour Do Not Track.
            </>,
            <>We don&apos;t train AI models on your PDFs, questions or study data.</>,
            <>You can delete your sessions and your key at any time.</>,
          ]}
        />
      }
    >
      <Section title="What we collect">
        <Bullets
          items={[
            <>
              <b>Account:</b> your email, name and a password. Passwords are handled by our authentication provider and
              stored hashed; we never see them.
            </>,
            <>
              <b>Your materials:</b> the PDFs you upload, the text extracted from them, and images of regions you capture.
            </>,
            <>
              <b>Study data:</b> your goals, plans, highlights, conversations with the tutor, and the tutor&apos;s notes on
              your progress (what you understand, what you&apos;re working on).
            </>,
            <>
              <b>Your Groq API key</b>, if you add one (see below).
            </>,
            <>
              <b>Usage and diagnostics:</b> which Confu pages and features are used, how fast pages load and respond, and
              error reports when something breaks. Page addresses are stored without ids (for example /session/:id), and
              never with the text of your PDFs, questions or notes. This stays in our own database; there are no
              third-party trackers. If your browser sends Do Not Track or Global Privacy Control, we don&apos;t record
              usage (error reports, which contain no personal content, still help us fix bugs).
            </>,
            <>
              <b>Feedback you send us</b> from the app, with the page you sent it from.
            </>,
          ]}
        />
        <p>We don&apos;t collect your location, contacts, or browsing activity outside Confu.</p>
      </Section>

      <Section title="Your Groq API key">
        <p>If you add your own Groq API key, here is exactly how it is handled:</p>
        <Bullets
          items={[
            <>
              <b>Only for your requests.</b> It is used solely to send the AI requests you trigger in Confu: tutor answers,
              study plans, figure reading, and the progress notes the tutor updates after each answer. Nothing runs on your
              key in the background or for anyone else.
            </>,
            <>
              <b>Never shared, sold or logged.</b> Your key is not shared with anyone other than Groq, the service it
              belongs to, and it is never written to our logs.
            </>,
            <>
              <b>Encrypted at rest.</b> It is checked with Groq, then encrypted (AES-256-GCM) on our server before
              it&apos;s stored, and tied to your account so it can&apos;t be decrypted for anyone else. We never show it
              again; you&apos;ll only see its last four characters.
            </>,
            <>
              <b>Yours to remove.</b> Replace or delete it any time in{" "}
              <Link href="/settings" className="underline underline-offset-4">
                Settings
              </Link>
              . Deleting it removes it from our database.
            </>,
            <>
              <b>Billing.</b> Requests made with your key count toward your Groq account&apos;s usage and limits.
            </>,
          ]}
        />
      </Section>

      <Section title="How we use your data">
        <Bullets
          items={[
            <>To run the app: store your PDFs, build your plan, answer your questions and remember your progress.</>,
            <>To keep your account secure and the service working.</>,
            <>To understand which features help people learn, and to find and fix what breaks.</>,
          ]}
        />
        <p>That&apos;s it. We don&apos;t use your data for advertising or sell it to anyone.</p>
      </Section>

      <Section title="Who processes it">
        <p>Confu relies on a few service providers, who process data only to provide their service to us:</p>
        <Bullets
          items={[
            <>
              <b>Supabase</b>: authentication, database and file storage. Your PDFs are kept in private storage that only
              your account can access.
            </>,
            <>
              <b>Groq</b>: runs the AI models. To answer you, the relevant excerpts of your PDFs, your question, captured
              images and your study context are sent to Groq. Groq&apos;s own privacy policy and terms apply to that
              processing.
            </>,
            <>
              <b>Vercel</b>: hosts the website.
            </>,
          ]}
        />
      </Section>

      <Section title="Cookies and local storage">
        <p>
          We use cookies only to keep you signed in. Your browser also stores a few interface preferences, like your
          panel width, your reading theme and whether you&apos;ve seen the guide, plus a random anonymous id that lets us
          count visits before you sign up. We don&apos;t use advertising or analytics cookies.
        </p>
      </Section>

      <Section title="Keeping and deleting your data">
        <Bullets
          items={[
            <>Your data is kept while your account exists.</>,
            <>
              Deleting a session permanently removes its PDFs, extracted text, highlights, captured images, plan,
              conversation and progress notes.
            </>,
            <>Removing a PDF from a session deletes that file and its highlights.</>,
            <>Deleting your account also deletes your usage records and the feedback you sent.</>,
            <>
              To delete your whole account and everything in it, email us at{" "}
              <a href={`mailto:${SITE.contactEmail}`} className="underline underline-offset-4">
                {SITE.contactEmail}
              </a>
              .
            </>,
          ]}
        />
      </Section>

      <Section title="Security">
        <p>
          Every request is tied to your signed-in account, and the database only lets you read and change your own data.
          Files are private, connections are encrypted, and API keys are encrypted at rest. No system is perfectly
          secure, but we work to protect your information and keep only what&apos;s needed.
        </p>
      </Section>

      <Section title="Children">
        <p>Confu isn&apos;t intended for children under 13, and we don&apos;t knowingly collect their data.</p>
      </Section>

      <Section title="Changes">
        <p>If we change this policy, we&apos;ll update the date at the top. Significant changes will be shown in the app.</p>
      </Section>
    </LegalPage>
  );
}

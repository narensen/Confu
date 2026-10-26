import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, LegalPage, Section } from "@/components/legal/LegalPage";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy — Confu",
  description: "What Confu stores, why, who processes it, how your Groq API key is protected, and how Confu uses Google user data.",
};

const link = "underline underline-offset-4";

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy Policy"
      updated="October 26, 2026"
      summary={
        <Bullets
          items={[
            <>We store only what the app needs to work: your account, the material you add, and your study data.</>,
            <>
              <b>Your Groq API key is used only to run the requests you make in Confu.</b> We never use it for anything
              else, never share or sell it, never log it, and store it encrypted.
            </>,
            <>
              <b>Google Drive:</b> Confu only sees the files you pick (or ask it to convert), only to bring them into your
              sessions. We never sell Google data, use it for ads, or train AI on it.
            </>,
            <>Payments are handled by Lemon Squeezy. We never see your card number.</>,
            <>Nothing you make is public unless you choose to share it (a study pack or a Wrapped page), and you can take it down any time.</>,
            <>We don&apos;t sell your data, show ads, or use tracking or analytics cookies, and we don&apos;t train AI models on your material.</>,
          ]}
        />
      }
    >
      <Section title="What we collect">
        <Bullets
          items={[
            <>
              <b>Account:</b> your email, name and a password, or, if you sign in with Google, the name and email address
              Google shares with us. Passwords are handled by our authentication provider and stored hashed; we never see them.
            </>,
            <>
              <b>Your materials:</b> the PDFs you upload or import (from web pages, YouTube lectures, Google Drive or
              Zotero), the text extracted from them, and images of regions you capture.
            </>,
            <>
              <b>Study data:</b> your goals, plans, highlights, paper notes, practice answers, review progress,
              conversations with the tutor, and the tutor&apos;s notes on your progress.
            </>,
            <>
              <b>Your Groq API key</b>, if you add one (see below).
            </>,
            <>
              <b>Paper details:</b> for research papers in your sessions, their public identifiers (DOI, arXiv and OpenAlex
              ids) and the citation map we build from public databases.
            </>,
            <>
              <b>Billing:</b> if you subscribe to Pro, the status of your subscription, its renewal or end date, and the card
              brand and last four digits that our payment provider reports. We never receive your full card number.
            </>,
            <>
              <b>Invites:</b> who invited whom, so both of you get your weeks of Pro.
            </>,
            <>
              <b>Usage and diagnostics:</b> which Confu pages and features are used, how fast pages load and respond, and
              error reports when something breaks. Page addresses are stored without ids or private links (for example
              /session/:id), and never with the text of your material, questions or notes. This stays in our own database;
              there are no third-party trackers. If your browser sends Do Not Track or Global Privacy Control, we don&apos;t
              record usage (error reports, which contain no personal content, still help us fix bugs).
            </>,
            <>
              <b>Feedback you send us</b> from the app, with the page you sent it from.
            </>,
            <>
              <b>Reminders, if you keep them on:</b> your time zone, your email, notification and study-time choices, and, if
              you turn on notifications, your browser&apos;s push address. Turn any of them off in Settings, or with the
              unsubscribe link in every email.
            </>,
          ]}
        />
        <p>We don&apos;t collect your location, contacts, or browsing activity outside Confu.</p>
      </Section>

      <Section title="Google user data" id="google">
        <p>Confu uses Google in two ways, and only when you choose to:</p>
        <Bullets
          items={[
            <>
              <b>Signing in with Google.</b> We receive your name and email address to create and identify your account,
              and nothing else from your Google account.
            </>,
            <>
              <b>Google Drive.</b> With your permission, Confu asks Google for access to <i>only the files you pick</i> in
              Google&apos;s file picker, and to files Confu itself creates (the{" "}
              <code className="font-mono text-[0.85em]">drive.file</code> permission). It can&apos;t see the rest of your Drive.
            </>,
          ]}
        />
        <p>What happens with Drive files:</p>
        <Bullets
          items={[
            <>
              <b>Importing:</b> the files you pick are downloaded in your browser (Google Docs, Slides and Sheets are
              exported as PDFs) and added to your session, where they&apos;re stored like any PDF you upload.
            </>,
            <>
              <b>Converting:</b> when you upload a PowerPoint or Word file and ask Confu to convert it, it&apos;s uploaded to
              your own Drive as a temporary Google Slides or Docs file, exported as a PDF, and the temporary file is deleted
              straight away.
            </>,
            <>
              <b>Access stays in your browser.</b> Google&apos;s access token is kept only in your browser for up to an hour.
              It is never sent to or stored on Confu&apos;s servers, and we keep no copy of anything in your Drive other than
              the files you import.
            </>,
            <>
              <b>How it&apos;s used:</b> only to provide Confu&apos;s features to you. For example, when you ask the tutor about
              an imported file, the relevant text is sent to our AI provider, Groq, to answer you. We never sell Google
              data, use it for advertising, share it for any other purpose, let people read it except where you ask us to
              (for support) or the law requires, or use it to train AI models.
            </>,
            <>
              <b>Removing access:</b> remove Confu at{" "}
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" className={link}>
                myaccount.google.com/permissions
              </a>{" "}
              at any time. Files you imported stay in your sessions until you delete them.
            </>,
          ]}
        />
        <p>
          Confu&apos;s use and transfer of information received from Google APIs to any other app will adhere to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer" className={link}>
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </Section>

      <Section title="Your Groq API key">
        <p>If you add your own Groq API key, here is exactly how it is handled:</p>
        <Bullets
          items={[
            <>
              <b>Only for your requests.</b> It is used solely to send the AI requests you trigger in Confu: tutor answers,
              study plans, figure reading, paper tools, and the progress notes the tutor updates after each answer. Nothing
              runs on your key in the background or for anyone else.
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
              <Link href="/settings" className={link}>
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

      <Section title="What you choose to share">
        <p>Everything in Confu is private to your account, except what you explicitly share:</p>
        <Bullets
          items={[
            <>
              <b>Study packs.</b> Publishing a session as a pack makes a page with its title and description, its sources (as
              links and paper identifiers, never your uploaded files), its plan, and, if you choose, your highlights and the
              notes on them, plus your first name if you choose. Your conversations, pass notes and answers are never
              included. Unlisted packs are only reachable with their link; listed ones appear in the gallery. Unpublish at
              any time; copies people already made stay theirs.
            </>,
            <>
              <b>Class progress.</b> When you copy a pack in class mode, you can choose to share your progress with its
              author: your first name, topics done, mastery estimates, days active, reading time and when you were last
              active. Never your notes, answers or conversations. Stop sharing at any time from the session.
            </>,
            <>
              <b>Wrapped.</b> Sharing your month creates a page with that month&apos;s numbers, the title of the session you
              studied most, and your first name if you choose. Unshare at any time.
            </>,
            <>
              <b>Study rooms.</b> While you&apos;re in a room, the others in it see your first name and, if you write it, what
              you&apos;re working on.
            </>,
          ]}
        />
      </Section>

      <Section title="How we use your data">
        <Bullets
          items={[
            <>To run the app: store your material, build your plan, answer your questions and remember your progress.</>,
            <>To keep your account secure and the service working.</>,
            <>To manage your subscription and the Pro weeks you earn through invites.</>,
            <>To understand which features help people learn, and to find and fix what breaks.</>,
            <>
              To send the reminders and weekly summaries you&apos;ve chosen (through our email provider, Resend), and your study
              plan&apos;s calendar feed, which is only reachable with your private link.
            </>,
          ]}
        />
        <p>That&apos;s it. We don&apos;t use your data for advertising or sell it to anyone.</p>
      </Section>

      <Section title="Who processes it">
        <p>Confu relies on a few service providers, who process data only to provide their service to us:</p>
        <Bullets
          items={[
            <>
              <b>Supabase</b>: authentication, database and file storage. Your files are kept in private storage that only
              your account can access.
            </>,
            <>
              <b>Groq</b>: runs the AI models. To answer you, the relevant excerpts of your material, your question,
              captured images and your study context are sent to Groq. Groq&apos;s own privacy policy and terms apply to that
              processing.
            </>,
            <>
              <b>Lemon Squeezy</b>: our payment provider and the merchant of record for Pro. It processes your payment
              details, taxes and receipts under its own privacy policy.
            </>,
            <>
              <b>Resend</b>: sends our emails.
            </>,
            <>
              <b>Vercel</b>: hosts the website.
            </>,
            <>
              <b>Public research databases</b> (OpenAlex, Semantic Scholar, arXiv and Crossref): to find papers and map
              their citations, we send them paper titles and identifiers, including the first lines of a PDF&apos;s first page
              when checking whether it&apos;s a research paper. Nothing that identifies you is sent.
            </>,
            <>
              <b>Sources you import from</b>: when you import a web page, a YouTube lecture or a paper&apos;s PDF, our server
              fetches it from that site. Zotero is reached directly from your browser, with your own key.
            </>,
          ]}
        />
      </Section>

      <Section title="Cookies and local storage">
        <p>
          We use cookies to keep you signed in, and a short-lived one to remember an invite link until you sign up. Your
          browser also stores a few interface preferences, like your panel width, your reading theme, your sound volume and
          the study room you&apos;re in, plus a random anonymous id that lets us count visits before you sign up. We don&apos;t
          use advertising or analytics cookies.
        </p>
      </Section>

      <Section title="Keeping and deleting your data">
        <Bullets
          items={[
            <>Your data is kept while your account exists.</>,
            <>
              Deleting a session permanently removes its files, extracted text, highlights, captured images, plan,
              conversation and progress notes. Archiving a session hides it but keeps everything.
            </>,
            <>Removing a file from a session deletes that file and its highlights.</>,
            <>
              Deleting your account, from{" "}
              <Link href="/settings#danger" className={link}>
                Settings
              </Link>
              , deletes everything in it, including your usage records, feedback, packs, shared pages and rooms. Lemon
              Squeezy keeps its own payment records as the law requires.
            </>,
            <>
              You can also ask us to delete your account at{" "}
              <a href={`mailto:${SITE.contactEmail}`} className={link}>
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

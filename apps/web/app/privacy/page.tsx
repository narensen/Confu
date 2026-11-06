import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, LegalPage, Section } from "@/components/legal/LegalPage";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy — Confu",
  description: "What Confu stores, why, who processes it, how your AI API key is protected, and how Confu uses Google user data.",
};

const link = "underline underline-offset-4";

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy Policy"
      updated="November 3, 2026"
      summary={
        <Bullets
          items={[
            <>We store only what the app needs to work: your account, the material you add, and your study data.</>,
            <>
              <b>Your AI API key (or OpenRouter connection) is used only to run the requests you make in Confu.</b> We never
              use it for anything else, never share or sell it, never log it, and store it encrypted.
            </>,
            <>
              <b>Google Drive:</b> Confu only sees the files you pick (or ask it to convert), only to bring them into your
              sessions. We never sell Google data, use it for ads, or train AI on it.
            </>,
            <>Confu sells nothing and takes no payments. The AI provider you connect bills you directly, under its own terms.</>,
            <>Nothing you make is public unless you choose to share it (a study pack, a Wrapped page, a sitting card, a miss map, a crib, a reading list, a library hour, or a section page), and you can take it down any time.</>,
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
              Zotero), a photo of a board, which becomes a page you uploaded, the text extracted from them, and images of
              regions you capture.
            </>,
            <>
              <b>Study data:</b> your goals, plans, highlights, paper notes, practice answers, review progress,
              conversations with the tutor, and the tutor&apos;s notes on your progress. An explain-back keeps only the
              score and the gap, never the audio or the words you said.
            </>,
            <>
              <b>Your AI connection</b>: the API key you add, or the key OpenRouter gives Confu when you connect your OpenRouter
              account, with the provider and models you picked (see below).
            </>,
            <>
              <b>Paper details:</b> for research papers in your sessions, their public identifiers (DOI, arXiv and OpenAlex
              ids) and the citation map we build from public databases.
            </>,
            <>
              <b>Invites:</b> who invited whom, so you can see how many friends joined with your link.
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
              an imported file, the relevant text is sent to the AI provider you connected, to answer you. We never sell Google
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

      <Section title="Your AI API key">
        <p>
          If you add an API key (from Groq, OpenAI, Anthropic, Google, OpenRouter or a server you choose), or connect your
          OpenRouter account, which gives Confu a key of its own, here is exactly how it is handled:
        </p>
        <Bullets
          items={[
            <>
              <b>Only for your requests.</b> It is used solely to send the AI requests you trigger in Confu: tutor answers,
              study plans, figure reading, paper tools, and the progress notes the tutor updates after each answer. Nothing
              runs on your key in the background or for anyone else.
            </>,
            <>
              <b>Never shared, sold or logged.</b> Your key is not shared with anyone other than the provider it belongs
              to, and it is never written to our logs.
            </>,
            <>
              <b>Encrypted at rest.</b> It is checked with its provider, then encrypted (AES-256-GCM) on our server before
              it&apos;s stored, and tied to your account so it can&apos;t be decrypted for anyone else. We never show it
              again; you&apos;ll only see its last four characters.
            </>,
            <>
              <b>On your own devices.</b> When you open the on-device app (/app) while signed in, your key is sent once, over an
              encrypted connection, to that browser, so the app there can use it without connecting again. It is kept on that
              device, encrypted, and sent only to its provider. Removing it there doesn&apos;t remove it from your account.
            </>,
            <>
              <b>Yours to remove.</b> Replace or delete it any time in{" "}
              <Link href="/settings" className={link}>
                Settings
              </Link>
              . Deleting it removes it from our database.
            </>,
            <>
              <b>Billing.</b> Requests made with your key count toward that account&apos;s usage, limits and charges, under the
              provider&apos;s own terms. Confu adds nothing on top.
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
            <>
              <b>Friends.</b> People you accept as friends see your first name, whether you&apos;re online, and when you&apos;re in
              voice. They see which room you&apos;re in if it&apos;s public, or if it&apos;s a private room they were invited to or
              already share with you. Otherwise they only see that you&apos;re in a private room. A request can be sent to your
              email address or your friend code.
            </>,
            <>
              <b>Voice.</b> In a private study room, voice goes directly between the browsers of the people who joined it. Confu
              does not record it or store the audio. A screen share is the same: live, between those browsers, and not
              recorded by Confu. Joining still works from the room link, the same as before.
            </>,
            <>
              <b>Threads.</b> A question you post on Threads, and the replies, are visible to people signed in to Confu, with
              your first name. Confu may check a post for a clear mistake. If it finds one, readers see a short note and,
              on a reply, a corrected version labelled as such. Your original stays, one click away. Remove your own posts
              any time.
            </>,
            <>
              <b>Notifications.</b> A friend request, an accepted request, a room invite, a reply, an accepted answer, or a
              note on your post is stored for you and shown only to you. Read ones are deleted after 60 days.
            </>,
            <>
              <b>Learning spaces.</b> A subject space (Mathematics, Law, and the others) is visible to anyone signed in.
              A space you create is private to people with its link. Members see the space&apos;s name, your first name, and
              the questions posted there. A private space isn&apos;t listed publicly.
            </>,
            <>
              <b>Roadmaps.</b> Sharing a session as a roadmap publishes the same page as a study pack, with the plan shown as a
              path. The same rules apply: links and the plan, never your files or conversations.
            </>,
            <>
              <b>Page pins.</b> A pin stores the passage, your question, and one answer written from that page. Classmates
              see it only when you and they both share class progress on the same pack. Your chats are never included.
            </>,
            <>
              <b>Explain-back.</b> Saying a page back stores the score and the one-line gap. The audio isn&apos;t recorded,
              and the words you said aren&apos;t kept. The gap stays on your account and comes back in review. It isn&apos;t
              on a miss map, a crib, or a section page.
            </>,
            <>
              <b>A sitting card.</b> Sharing a timed paper stores the score, the minutes, the weak topics, an optional band
              when the exam is close, and your first name if you choose. Not the questions or your answers.
            </>,
            <>
              <b>Course-link requests.</b> Opening a course link counts as a request for that code, that day. It isn&apos;t a
              person. We don&apos;t store an IP address or a user-agent.
            </>,
            <>
              <b>A section paper.</b> The questions and the key stay in the owner&apos;s account. A hand-in stores the score,
              the minutes, and the missed topic names. That row isn&apos;t public. A classmate sees the score in the response.
              A sitting card, with an optional first name, exists only if they click share. Choices aren&apos;t kept.
            </>,
            <>
              <b>A miss map.</b> Topic names and how many people missed them, for a pack whose copiers chose to share
              progress. No names and no questions. Anyone with the link can see it.
            </>,
            <>
              <b>A crib.</b> Objectives and page references from the published plan. No files and no excerpts.
            </>,
            <>
              <b>A library hour.</b> The time, a place name the owner typed, and a topic. Not who attended.
            </>,
            <>
              <b>A reading list (door card).</b> The titles and URLs the owner entered, and a plan only if they generated one. No files.
              Confu doesn&apos;t fetch NCERT textbooks. A file you already have can still be uploaded into your own session.
            </>,
            <>
              <b>A section page after the paper.</b> Counts and topic names. The copy line is how many times the pack was
              copied, not how many people. No ranking and no names.
            </>,
            <>
              <b>Cite mode.</b> A switch on the session. When part of a reply can&apos;t cite a page in the session, that part is
              still shown, with a note that it isn&apos;t cited. The saved message is the one you see.
            </>,
          ]}
        />
      </Section>

      <Section title="How we use your data">
        <Bullets
          items={[
            <>To run the app: store your material, build your plan, answer your questions and remember your progress.</>,
            <>To keep your account secure and the service working.</>,
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
              <b>The AI provider you connect</b> (for example Groq, OpenAI, Anthropic, Google or OpenRouter, and through
              OpenRouter the model&apos;s own provider): runs the AI models. To answer you, the relevant excerpts of your
              material, your question, captured images and your study context are sent to it. Its own privacy policy and
              terms apply to that processing. Free prompts, before you connect anything, run on Groq.
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
              , deletes everything in it, including your usage records, feedback, packs, shared pages, friends, rooms, threads and learning spaces.
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

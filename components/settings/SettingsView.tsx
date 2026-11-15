import Link from "next/link";
import { LocalTime } from "@/components/LocalTime";
import { TourButton } from "@/components/onboarding/TourButton";
import { KeyManager } from "@/components/keys/KeyManager";
import { ghostButtonClass } from "@/components/ui";
import { UsageSection, type UsageKey } from "@/components/usage/UsageSection";
import { MODELS } from "@/lib/groq";
import type { KeyInfo } from "@/lib/groq-keys";
import { SITE } from "@/lib/site";
import { DeleteAccount, EmailField, NameField, PasswordForm, ResetLinkButton, SignOutEverywhereButton } from "./AccountForms";
import { AppearanceSection } from "./AppearanceSection";
import { RemindersSection } from "./RemindersSection";
import { Row, Section } from "./Section";
import { SettingsNav, type NavItem } from "./SettingsNav";

export const SETTINGS_GRID = "lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-14";

export type SettingsData = {
  user: { email: string | null; name: string | null };
  owner: boolean;
  pendingEmail: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  providers: string[]; // how they can sign in: "email" (password), "google"…
  account: KeyInfo | null;
  sessionKeys: { id: string; sessionId: string; last4: string; title: string }[];
  usageKeys: UsageKey[];
};

// The Settings page, laid out like a publication's account settings: a
// section menu on the left, serif section headings, "label · hint · action" rows.
export function SettingsView(d: SettingsData) {
  const nav: NavItem[] = [
    { id: "profile", label: "Profile" },
    { id: "appearance", label: "Appearance" },
    { id: "security", label: "Sign-in & security" },
    { id: "ai", label: "Your AI" },
    ...(d.owner ? [] : [{ id: "api-key", label: "API key" }]),
    { id: "usage", label: "Usage" },
    { id: "reminders", label: "Reminders & calendar" },
    { id: "help", label: "Help & legal" },
    { id: "data", label: "Your data" },
    { id: "danger", label: "Delete account", danger: true },
  ];

  return (
    <>
      <p className="animate-enter mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" style={{ animationDelay: "40ms" }}>
        <span>
          Signed in as <span className="text-ink">{d.user.email}</span>
        </span>
        {d.owner && (
          <>
            <span aria-hidden>·</span>
            <span className="rounded border border-ink/30 px-1.5 py-px text-xs">Owner</span>
          </>
        )}
      </p>

      <div className={`mt-8 ${SETTINGS_GRID}`}>
        <SettingsNav items={nav} />

        <div className="animate-enter mt-8 space-y-16 lg:mt-0" style={{ animationDelay: "80ms" }}>
          <Section id="profile" title="Profile" description="How you appear in Confu.">
            <Row label="Name" hint="Shown in the header and your account menu.">
              <NameField name={d.user.name ?? ""} />
            </Row>
            <Row label="Email" hint="You sign in with it. A change takes effect once you confirm it from your inbox.">
              <EmailField email={d.user.email ?? ""} pending={d.pendingEmail} />
            </Row>
            {d.createdAt && (
              <Row label="Member since">
                <span className="text-sm">
                  <LocalTime iso={d.createdAt} />
                </span>
              </Row>
            )}
          </Section>

          <AppearanceSection />

          <Section id="security" title="Sign-in & security">
            {d.providers.includes("google") && (
              <Row label="Google" hint="You can sign in with your Google account.">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/50 px-2.5 py-0.5 text-xs text-ok">Connected</span>
              </Row>
            )}
            {d.providers.includes("email") ? (
              <>
                <Row label="Password" hint="You'll need your current password to set a new one.">
                  <PasswordForm />
                </Row>
                <Row label="Forgot your password?" hint={<>We&apos;ll email a link to {d.user.email} so you can choose a new one.</>}>
                  <ResetLinkButton />
                </Row>
              </>
            ) : (
              <Row
                label="Password"
                hint={<>You sign in with Google, so there&apos;s no password yet. Set one to also sign in with {d.user.email} and a password.</>}
              >
                <ResetLinkButton label="Email me a link to set one" />
              </Row>
            )}
            {d.lastSignInAt && (
              <Row label="Last sign-in">
                <span className="text-sm">
                  <LocalTime iso={d.lastSignInAt} withTime />
                </span>
              </Row>
            )}
            <Row label="Sign out everywhere" hint="Ends your session in every browser and on every device, including this one.">
              <SignOutEverywhereButton />
            </Row>
          </Section>

          <Section
            id="ai"
            title="Your AI"
            description="Confu is free and open source. The tutor runs on an AI you bring, so there's nothing to pay Confu for."
          >
            <Row label="A Groq API key" hint="Free at console.groq.com. Add it below and every session uses it. Groq's free tier has daily limits; see Usage.">
              <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className={`${ghostButtonClass} py-1 text-xs`}>
                Get a key
              </a>
            </Row>
            <Row
              label="An AI on your computer"
              hint="Signed in to Claude, ChatGPT (Codex), Gemini or Grok on a Mac, Windows or Linux computer? Pick it from Tutors in any session. Confu asks once, then connects by itself."
            >
              <span className="text-sm text-muted">In a session</span>
            </Row>
            {d.owner && (
              <Row label="Server keys" hint="You run this deployment, so your requests use the server's GROQ_API_KEYS.">
                <span className="text-sm">On</span>
              </Row>
            )}
          </Section>

          {!d.owner && (
            <Section id="api-key" title="API key" description="Your Groq key, encrypted at rest. Only its last four characters are ever shown.">
              <KeyManager initialAccount={d.account} initialOverrides={d.sessionKeys} />
            </Section>
          )}

          <Section id="usage" title="Usage" description="Tokens used by your requests over the last 24 hours and 7 days.">
            <UsageSection
              keys={d.usageKeys}
              modelLabels={{
                [MODELS.chat]: "Tutor, plans, practice",
                [MODELS.fast]: "Progress notes",
                [MODELS.vision]: "Scans and figures",
              }}
            />
          </Section>

          <RemindersSection />

          <Section id="help" title="Help & legal">
            <Row label="Welcome" hint="The short welcome. Tips appear the first time you open a PDF and the first time you get a plan.">
              <TourButton label="Open the welcome" className="py-1 text-xs" />
            </Row>
            <Row label="Privacy Policy" hint="What we store, why, and who processes it.">
              <Link href="/privacy" className={`${ghostButtonClass} py-1 text-xs`}>
                Read
              </Link>
            </Row>
            <Row label="Terms & disclaimer" hint="The rules, and what AI answers can and can't promise.">
              <Link href="/terms" className={`${ghostButtonClass} py-1 text-xs`}>
                Read
              </Link>
            </Row>
            <Row label="Contact" hint="Questions about your account or your data.">
              <a href={`mailto:${SITE.contactEmail}`} className="text-sm font-medium underline underline-offset-4">
                {SITE.contactEmail}
              </a>
            </Row>
          </Section>

          <Section id="data" title="Your data" description="It's yours. Take a copy whenever you like.">
            <Row
              label="Export your data"
              hint="A JSON file with your sessions, plans, notes, highlights, conversations and usage. PDFs aren't included (they're in your sessions), and API keys never are."
            >
              <a href="/api/export" download className={`${ghostButtonClass} py-1 text-xs`}>
                Download
              </a>
            </Row>
          </Section>

          <Section
            id="danger"
            title="Delete account"
            danger
            description="Permanently deletes your account and everything in it: sessions, files, notes, highlights, conversations and saved keys. Export your data first if you want a copy."
          >
            <Row label="Delete your account" hint="This can't be undone.">
              <DeleteAccount />
            </Row>
          </Section>
        </div>
      </div>
    </>
  );
}

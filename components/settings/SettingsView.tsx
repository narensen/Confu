import Link from "next/link";
import { LocalTime } from "@/components/LocalTime";
import { TourButton } from "@/components/onboarding/TourButton";
import { KeyManager } from "@/components/keys/KeyManager";
import { ghostButtonClass } from "@/components/ui";
import { UsageSection, type UsageKey } from "@/components/usage/UsageSection";
import { PRO_DAILY_TOKENS } from "@/lib/ai-access";
import { formatTokens } from "@/lib/format-usage";
import { MODELS } from "@/lib/groq";
import type { KeyInfo } from "@/lib/groq-keys";
import { PLANS, type Plan } from "@/lib/plans";
import { SITE } from "@/lib/site";
import { DeleteAccount, EmailField, NameField, PasswordForm, RequestProButton, ResetLinkButton, SignOutEverywhereButton } from "./AccountForms";
import { ProMembers, type ProMember } from "./ProMembers";
import { RemindersSection } from "./RemindersSection";
import { Row, Section } from "./Section";
import { SettingsNav, type NavItem } from "./SettingsNav";

export const SETTINGS_GRID = "lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-14";

export type SettingsData = {
  user: { email: string | null; name: string | null };
  plan: Plan;
  owner: boolean;
  pendingEmail: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  providers: string[]; // how they can sign in: "email" (password), "google"…
  requestedAt: string | null; // when this Free account asked for Pro
  account: KeyInfo | null;
  sessionKeys: { id: string; sessionId: string; last4: string; title: string }[];
  usageKeys: UsageKey[];
  members: ProMember[] | null; // owner only
  membersError?: string;
};

// The Settings page, laid out like a publication's account settings: a
// section menu on the left, serif section headings, "label · hint · action" rows.
export function SettingsView(d: SettingsData) {
  const pro = d.plan === "pro";
  const nav: NavItem[] = [
    { id: "profile", label: "Profile" },
    { id: "security", label: "Sign-in & security" },
    { id: "plan", label: "Plan" },
    ...(pro ? [] : [{ id: "api-key", label: "API key" }]),
    { id: "usage", label: "Usage" },
    { id: "reminders", label: "Reminders & calendar" },
    ...(d.members ? [{ id: "members", label: "Pro members", badge: d.members.filter((m) => m.role !== "pro").length }] : []),
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
        <span aria-hidden>·</span>
        {pro ? (
          <span className="rounded border border-ink bg-yellow-300 px-1.5 py-px font-mono text-[11px] font-medium text-ink uppercase">
            {d.owner ? "Admin" : "Pro"}
          </span>
        ) : (
          <span className="rounded border border-ink/30 px-1.5 py-px font-mono text-[11px] uppercase">Free</span>
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
            id="plan"
            title="Plan"
            description={pro ? "You're on Pro: Confu's AI runs on our keys, no setup needed." : "Free runs on your own Groq key. Pro runs on ours."}
          >
            <PlanCards plan={d.plan} owner={d.owner} requestedAt={d.requestedAt} used={d.usageKeys[0]?.allowance?.used ?? 0} />
          </Section>

          {!pro && (
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
                [MODELS.vision]: "Figure reading",
              }}
            />
          </Section>

          {d.members && (
            <Section id="members" title="Pro members" description="Only you can see this. Approve requests, or give Pro to anyone with a Confu account.">
              <ProMembers members={d.members} unavailable={d.membersError} />
            </Section>
          )}

          <RemindersSection />

          <Section id="help" title="Help & legal">
            <Row label="Guide" hint="A two-minute walkthrough: sessions, highlighting, figure capture, the tutor, paper sessions and exam prep.">
              <TourButton label="Open the guide" className="py-1 text-xs" />
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
            description="Permanently deletes your account and everything in it: sessions, PDFs, notes, highlights, conversations and saved keys. Export your data first if you want a copy."
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

function PlanCards({ plan, owner, requestedAt, used }: { plan: Plan; owner: boolean; requestedAt: string | null; used: number }) {
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
      {(["free", "pro"] as const).map((p) => {
        const current = p === plan;
        return (
          <div
            key={p}
            className={`flex flex-col rounded-xl border p-5 ${current ? "border-ink bg-panel shadow-hard-sm max-sm:order-first" : "border-line bg-paper"}`}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="font-serif text-2xl">
                {PLANS[p].name}
                {p === "pro" && <span className="text-yellow-500">.</span>}
              </p>
              {current ? (
                <span className="rounded-full bg-ink px-2.5 py-0.5 text-[11px] font-medium text-white">{owner ? "Current · Admin" : "Current plan"}</span>
              ) : p === "pro" ? (
                <span className="rounded-full border border-ink/30 bg-yellow-200 px-2.5 py-0.5 text-[11px] font-medium">Early access</span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted">{PLANS[p].tagline}</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {PLANS[p].features.map((f) => (
                <li key={f} className="flex gap-2">
                  <svg viewBox="0 0 16 16" aria-hidden className="mt-0.5 size-4 shrink-0">
                    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5">
              {p === "pro" && plan === "free" && <RequestProButton requestedAt={requestedAt} />}
              {p === "pro" && plan === "pro" && (
                <p className="text-xs leading-relaxed text-muted">
                  {owner
                    ? "No daily allowance on admin accounts."
                    : `Allowance: ${formatTokens(PRO_DAILY_TOKENS)} tokens per rolling 24 hours (${formatTokens(used)} used). It frees up gradually as usage passes 24 hours.`}
                </p>
              )}
              {p === "free" && plan === "free" && (
                <p className="text-xs leading-relaxed text-muted">Free to use. Groq&apos;s own free tier has daily limits; see Usage below.</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

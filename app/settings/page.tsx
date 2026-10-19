import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { KeyManager } from "@/components/keys/KeyManager";
import { TourButton } from "@/components/onboarding/TourButton";
import { UsageSection, type UsageKey } from "@/components/usage/UsageSection";
import { SERVER_KEY_REF, userKeyRef } from "@/lib/ai-access";
import { MODELS } from "@/lib/groq";
import { usageSummary } from "@/lib/usage-summary";
import { eyebrowClass } from "@/components/ui";
import { getCurrentRole, requireUser } from "@/lib/dal";
import { getKeyInfo } from "@/lib/groq-keys";
import { createClient } from "@/lib/supabase/server";

export default function SettingsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <div className="animate-enter">
          <p className={eyebrowClass}>Settings</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight">Your account</h1>
        </div>
        <Suspense fallback={<div className="skeleton mt-8 h-64 rounded-xl border border-ink/20" />}>
          <SettingsContent />
        </Suspense>
      </main>
    </div>
  );
}

async function SettingsContent() {
  const user = await requireUser();
  const supabase = await createClient();
  const [role, account, overrides] = await Promise.all([
    getCurrentRole(),
    getKeyInfo(supabase, user.id, null),
    supabase.from("groq_keys").select("id, session_id, last4, study_sessions(title)").eq("user_id", user.id).not("session_id", "is", null),
  ]);

  const sessionKeys = ((overrides.data ?? []) as unknown as { id: string; session_id: string; last4: string; study_sessions: { title: string } | null }[]).map(
    (o) => ({ id: o.id, sessionId: o.session_id, last4: o.last4, title: o.study_sessions?.title ?? "Untitled session" }),
  );

  // Usage is per actual key: the keys that exist now.
  const keyList: Omit<UsageKey, "usage">[] = [
    ...(role === "admin" ? [{ keyRef: SERVER_KEY_REF, label: "Server key (admin)", sessionId: null }] : []),
    ...(account ? [{ keyRef: userKeyRef(account.id), label: `Your account key …${account.last4}`, sessionId: null }] : []),
    ...sessionKeys.map((k) => ({ keyRef: userKeyRef(k.id), label: `Session key …${k.last4} · ${k.title}`, sessionId: k.sessionId })),
  ];
  const usage = await usageSummary(supabase, user.id, keyList.map((k) => k.keyRef));
  const usageKeys: UsageKey[] = keyList.map((k) => ({ ...k, usage: usage.find((u) => u.keyRef === k.keyRef) }));

  return (
    <div className="mt-8 space-y-6">
      <section className="animate-enter rounded-xl border border-ink bg-panel p-6" style={{ animationDelay: "60ms" }}>
        <p className={eyebrowClass}>Profile</p>
        <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Name</dt>
          <dd>{user.name ?? "—"}</dd>
          <dt className="text-muted">Email</dt>
          <dd>{user.email ?? "—"}</dd>
          <dt className="text-muted">Role</dt>
          <dd>{role === "admin" ? <span className="rounded border border-ink px-1.5 py-px font-mono text-[11px] uppercase">Admin</span> : "Member"}</dd>
        </dl>
      </section>

      <KeyManager isAdmin={role === "admin"} initialAccount={account} initialOverrides={sessionKeys} />

      <UsageSection
        keys={usageKeys}
        modelLabels={{
          [MODELS.chat]: "Tutor, plans, practice",
          [MODELS.fast]: "Progress notes",
          [MODELS.vision]: "Figure reading",
        }}
      />

      <section className="animate-enter rounded-xl border border-ink bg-panel p-6" style={{ animationDelay: "180ms" }}>
        <p className={eyebrowClass}>Help</p>
        <h2 className="mt-1 font-serif text-2xl">Guide</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          A two-minute walkthrough of sessions, goals and plans, highlighting, figure capture, the tutor, and paper sessions.
        </p>
        <TourButton label="Open the guide" className="mt-4 py-1.5 text-xs" />
      </section>

      <p className="text-center text-xs text-muted">
        <Link href="/privacy" className="hover:text-ink">
          Privacy Policy
        </Link>
        <span className="mx-2">·</span>
        <Link href="/terms" className="hover:text-ink">
          Terms &amp; disclaimer
        </Link>
      </p>
    </div>
  );
}

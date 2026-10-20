import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import type { ProMember } from "@/components/settings/ProMembers";
import { SETTINGS_GRID, SettingsView } from "@/components/settings/SettingsView";
import { eyebrowClass } from "@/components/ui";
import type { UsageKey } from "@/components/usage/UsageSection";
import { PRO_DAILY_TOKENS, PRO_KEY_REF, userKeyRef } from "@/lib/ai-access";
import { getCurrentRole, requireUser } from "@/lib/dal";
import { getKeyInfo } from "@/lib/groq-keys";
import { isOwner, planOf } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { usageSummary } from "@/lib/usage-summary";

export const metadata: Metadata = { title: "Settings — Confu" };

export default function SettingsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-10 pb-28 sm:pt-14">
        <div className="animate-enter">
          <p className={eyebrowClass}>Settings</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight sm:text-5xl">Your account</h1>
        </div>
        <Suspense fallback={<SettingsSkeleton />}>
          <SettingsContent />
        </Suspense>
      </main>
    </div>
  );
}

async function SettingsContent() {
  const user = await requireUser();
  const supabase = await createClient();
  const [role, account, overrides, auth, profile] = await Promise.all([
    getCurrentRole(),
    getKeyInfo(supabase, user.id, null),
    supabase.from("groq_keys").select("id, session_id, last4, study_sessions(title)").eq("user_id", user.id).not("session_id", "is", null),
    supabase.auth.getUser(),
    // "*": pro_requested_at only exists once migration 0012 has run.
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
  ]);
  const plan = planOf(role);
  const owner = isOwner(role);
  const me = auth.data.user;

  const sessionKeys = ((overrides.data ?? []) as unknown as { id: string; session_id: string; last4: string; study_sessions: { title: string } | null }[]).map(
    (o) => ({ id: o.id, sessionId: o.session_id, last4: o.last4, title: o.study_sessions?.title ?? "Untitled session" }),
  );

  // Usage per actual key: Pro runs on the plan's pool; Free on the keys saved now.
  const keyList: Omit<UsageKey, "usage">[] =
    plan === "pro"
      ? [{ keyRef: PRO_KEY_REF, label: owner ? "Admin" : "Pro plan", sessionId: null }]
      : [
          ...(account ? [{ keyRef: userKeyRef(account.id), label: `Your account key …${account.last4}`, sessionId: null }] : []),
          ...sessionKeys.map((k) => ({ keyRef: userKeyRef(k.id), label: `Session key …${k.last4} · ${k.title}`, sessionId: k.sessionId })),
        ];

  const [usage, members] = await Promise.all([
    usageSummary(supabase, user.id, keyList.map((k) => k.keyRef)),
    owner ? supabase.rpc("pro_members") : null,
  ]);

  const usageKeys: UsageKey[] = keyList.map((k) => {
    const u = usage.find((x) => x.keyRef === k.keyRef);
    if (k.keyRef !== PRO_KEY_REF) return { ...k, usage: u };
    const used = (u?.models ?? []).reduce((sum, m) => sum + m.used24h, 0);
    return { ...k, usage: u, allowance: { used, cap: owner ? null : PRO_DAILY_TOKENS } };
  });

  return (
    <SettingsView
      user={{ email: user.email, name: user.name }}
      plan={plan}
      owner={owner}
      pendingEmail={me?.new_email ?? null}
      createdAt={me?.created_at ?? null}
      lastSignInAt={me?.last_sign_in_at ?? null}
      providers={(me?.app_metadata?.providers as string[] | undefined) ?? [me?.app_metadata?.provider ?? "email"]}
      requestedAt={(profile.data as { pro_requested_at?: string | null } | null)?.pro_requested_at ?? null}
      account={account}
      sessionKeys={sessionKeys}
      usageKeys={usageKeys}
      members={members ? ((members.data ?? []) as ProMember[]) : null}
      membersError={
        members?.error ? (/pro_members/.test(members.error.message) ? "Run migration 0012 to manage Pro from here." : members.error.message) : undefined
      }
    />
  );
}

function SettingsSkeleton() {
  return (
    <div className={`mt-10 ${SETTINGS_GRID}`}>
      <div className="hidden space-y-3 lg:block">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton h-5 w-32 rounded" />
        ))}
      </div>
      <div className="space-y-5">
        <div className="skeleton h-8 w-40 rounded" />
        <div className="skeleton h-56 rounded-2xl border border-ink/20" />
        <div className="skeleton h-8 w-56 rounded" />
        <div className="skeleton h-44 rounded-2xl border border-ink/20" />
      </div>
    </div>
  );
}

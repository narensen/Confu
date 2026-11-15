import type { Metadata } from "next";
import { Suspense } from "react";
import { SETTINGS_GRID, SettingsView } from "@/components/settings/SettingsView";
import { Eyebrow } from "@/components/ui";
import type { UsageKey } from "@/components/usage/UsageSection";
import { POOL_KEY_REF, userKeyRef } from "@/lib/ai-access";
import { getCurrentRole, requireUser } from "@/lib/dal";
import { getKeyInfo } from "@/lib/groq-keys";
import { isOwner } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { usageSummary } from "@/lib/usage-summary";

export const metadata: Metadata = { title: "Settings — Confu" };

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-10 pb-28 sm:pt-14">
      <div className="animate-enter">
        <Eyebrow>Settings</Eyebrow>
        <h1 className="mt-1 font-serif text-4xl tracking-tight sm:text-5xl">Your account</h1>
      </div>
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsContent />
      </Suspense>
    </main>
  );
}

async function SettingsContent() {
  const user = await requireUser();
  const supabase = await createClient();
  const [role, account, overrides, auth] = await Promise.all([
    getCurrentRole(),
    getKeyInfo(supabase, user.id, null),
    supabase.from("groq_keys").select("id, session_id, last4, study_sessions(title)").eq("user_id", user.id).not("session_id", "is", null),
    supabase.auth.getUser(),
  ]);
  const owner = isOwner(role);
  const me = auth.data.user;

  const sessionKeys = ((overrides.data ?? []) as unknown as { id: string; session_id: string; last4: string; study_sessions: { title: string } | null }[]).map(
    (o) => ({ id: o.id, sessionId: o.session_id, last4: o.last4, title: o.study_sessions?.title ?? "Untitled session" }),
  );

  // Usage per actual key: the owner runs on the server's pool; everyone else
  // on the keys saved now.
  const keyList: Omit<UsageKey, "usage">[] =
    owner
      ? [{ keyRef: POOL_KEY_REF, label: "Server keys", sessionId: null }]
      : [
          ...(account ? [{ keyRef: userKeyRef(account.id), label: `Your account key …${account.last4}`, sessionId: null }] : []),
          ...sessionKeys.map((k) => ({ keyRef: userKeyRef(k.id), label: `Session key …${k.last4} · ${k.title}`, sessionId: k.sessionId })),
        ];

  const usage = await usageSummary(supabase, user.id, keyList.map((k) => k.keyRef));

  const usageKeys: UsageKey[] = keyList.map((k) => {
    const u = usage.find((x) => x.keyRef === k.keyRef);
    if (k.keyRef !== POOL_KEY_REF) return { ...k, usage: u };
    const used = (u?.models ?? []).reduce((sum, m) => sum + m.used24h, 0);
    return { ...k, usage: u, allowance: { used, cap: null } };
  });

  return (
    <SettingsView
      user={{ email: user.email, name: user.name }}
      owner={owner}
      pendingEmail={me?.new_email ?? null}
      createdAt={me?.created_at ?? null}
      lastSignInAt={me?.last_sign_in_at ?? null}
      providers={(me?.app_metadata?.providers as string[] | undefined) ?? [me?.app_metadata?.provider ?? "email"]}
      account={account}
      sessionKeys={sessionKeys}
      usageKeys={usageKeys}
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

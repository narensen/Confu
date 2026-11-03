import type { Metadata } from "next";
import { Suspense } from "react";
import { SETTINGS_GRID, SettingsView } from "@/components/settings/SettingsView";
import { eyebrowClass } from "@/components/ui";
import type { UsageKey } from "@/components/usage/UsageSection";
import { SERVER_KEY_REF, serverKeysReady, userKeyRef } from "@/lib/ai-access";
import { keyLabel, PROVIDERS } from "@/lib/ai/providers";
import { getKeyInfo, sessionKeyInfos, type KeyInfo } from "@/lib/ai-keys";
import { getCurrentRole, requireUser } from "@/lib/dal";
import { isOwner } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { usageSummary } from "@/lib/usage-summary";

export const metadata: Metadata = { title: "Settings — Confu" };

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-10 pb-28 sm:pt-14">
      <div className="animate-enter">
        <p className={eyebrowClass}>Settings</p>
        <h1 className="mt-1 font-serif text-4xl tracking-tight sm:text-5xl">Your account</h1>
      </div>
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsContent />
      </Suspense>
    </main>
  );
}

const MODEL_LABELS = { chat: "Tutor, plans, practice", fast: "Progress notes", vision: "Scans and figures" };

// What each model a key uses is for, by name.
function labelsFor(k: KeyInfo | null): Record<string, string> {
  const m = k?.models ?? PROVIDERS.groq.defaults;
  return { [m.vision]: MODEL_LABELS.vision, [m.fast]: MODEL_LABELS.fast, [m.chat]: MODEL_LABELS.chat };
}

async function SettingsContent() {
  const user = await requireUser();
  const supabase = await createClient();
  const [role, account, sessionKeys, auth] = await Promise.all([
    getCurrentRole(),
    getKeyInfo(supabase, user.id, null),
    sessionKeyInfos(supabase, user.id),
    supabase.auth.getUser(),
  ]);
  const owner = isOwner(role);
  const me = auth.data.user;
  const serverKeys = owner && serverKeysReady();

  // Usage per actual key: the keys saved now, and the server's keys for the owner.
  const keyList: (Omit<UsageKey, "usage" | "modelLabels"> & { info: KeyInfo | null })[] = [
    ...(account ? [{ keyRef: userKeyRef(account.id), label: `Your account's AI · ${PROVIDERS[account.provider].name} ${keyLabel(account.provider, account.last4, account.via)}`, sessionId: null, info: account }] : []),
    ...sessionKeys.map((k) => ({ keyRef: userKeyRef(k.id), label: `Session key · ${PROVIDERS[k.provider].name} ${keyLabel(k.provider, k.last4, k.via)} · ${k.title}`, sessionId: k.sessionId, info: k as KeyInfo })),
    ...(serverKeys ? [{ keyRef: SERVER_KEY_REF, label: "The server's keys (owner)", sessionId: null, info: null, server: true }] : []),
  ];
  const groqKeys = keyList.filter((k) => k.info?.provider === "groq").map((k) => k.keyRef);
  const usage = await usageSummary(supabase, user.id, keyList.map((k) => k.keyRef), groqKeys);
  const usageKeys: UsageKey[] = keyList.map(({ info, ...k }) => ({
    ...k,
    usage: usage.find((x) => x.keyRef === k.keyRef),
    modelLabels: labelsFor(info),
  }));

  return (
    <SettingsView
      user={{ email: user.email, name: user.name }}
      owner={owner}
      serverKeys={serverKeys}
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

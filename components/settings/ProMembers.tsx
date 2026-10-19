"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setPro, type ActionResult } from "@/app/settings/account-actions";
import { LocalTime } from "@/components/LocalTime";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";

export type ProMember = {
  id: string;
  email: string;
  full_name: string | null;
  role: string | null; // 'pro', or null while only requested
  requested_at: string | null;
};

// Owner only: approve requests, give Pro by email, move people back to Free.
export function ProMembers({ members, unavailable }: { members: ProMember[]; unavailable?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  function change(target: string, pro: boolean, key: string) {
    setBusy(key);
    start(async () => {
      const res = await setPro(target, pro);
      setResult(res);
      setBusy(null);
      if (res.ok) {
        if (key === "form") setEmail("");
        router.refresh();
      }
    });
  }

  const requests = members.filter((m) => m.role !== "pro");
  const pro = members.filter((m) => m.role === "pro");

  return (
    <div className="px-5 py-5 sm:px-6">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) change(email, true, "form");
        }}
      >
        <label htmlFor="pro-email" className="sr-only">
          Email of the account to put on Pro
        </label>
        <input id="pro-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@university.edu" className={inputClass} />
        <button disabled={busy !== null || !email.trim()} className={`${buttonClass} shrink-0`}>
          {busy === "form" ? "Adding…" : "Give Pro"}
        </button>
      </form>
      {result && <p className={`animate-pop mt-2 text-sm ${result.ok ? "text-ok" : "text-danger"}`}>{result.ok ? result.message : result.error}</p>}
      {unavailable && <p className="mt-3 text-sm text-danger">{unavailable}</p>}

      <Group title="Waiting for approval" empty="No requests right now.">
        {requests.map((m) => (
          <MemberRow key={m.id} m={m} note={m.requested_at ? <>Asked <LocalTime iso={m.requested_at} /></> : null}>
            <button type="button" disabled={busy !== null} onClick={() => change(m.email, true, m.id)} className={`${buttonClass} py-1 text-xs`}>
              {busy === m.id ? "…" : "Approve"}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => change(m.email, false, m.id)} className={`${ghostButtonClass} py-1 text-xs`}>
              Decline
            </button>
          </MemberRow>
        ))}
      </Group>

      <Group title={`On Pro${pro.length ? ` · ${pro.length}` : ""}`} empty="Nobody yet.">
        {pro.map((m) => (
          <MemberRow key={m.id} m={m}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                if (confirm(`Move ${m.email} back to Free? They'll need their own Groq key again.`)) change(m.email, false, m.id);
              }}
              className="rounded-lg px-3 py-1 text-xs text-muted transition hover:bg-danger/10 hover:text-danger"
            >
              {busy === m.id ? "…" : "Remove Pro"}
            </button>
          </MemberRow>
        ))}
      </Group>
    </div>
  );
}

function Group({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="mt-6">
      <p className={eyebrowClass}>{title}</p>
      {children.length ? <ul className="mt-2 divide-y divide-line rounded-lg border border-line">{children}</ul> : <p className="mt-2 text-sm text-muted">{empty}</p>}
    </div>
  );
}

function MemberRow({ m, note, children }: { m: ProMember; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{m.full_name || m.email}</p>
        <p className="truncate text-xs text-muted">
          {m.full_name ? m.email : null}
          {m.full_name && note ? " · " : null}
          {note}
        </p>
      </div>
      <div className="flex gap-2">{children}</div>
    </li>
  );
}

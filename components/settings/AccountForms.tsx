"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  changeEmail,
  changePassword,
  deleteAccount,
  requestPro,
  sendPasswordResetLink,
  signOutEverywhere,
  updateName,
  type ActionResult,
} from "@/app/settings/account-actions";
import { LocalTime } from "@/components/LocalTime";
import { buttonClass, ghostButtonClass, inputClass } from "@/components/ui";

function Feedback({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return result.ok ? (
    result.message ? <p className="animate-pop mt-2 text-sm text-ok">{result.message}</p> : null
  ) : (
    <p className="animate-pop mt-2 text-sm text-danger">{result.error}</p>
  );
}

// Click "Edit" → inline field → Save / Cancel.
function EditableField({
  label,
  value,
  type = "text",
  placeholder,
  onSave,
  display,
}: {
  label: string;
  value: string;
  type?: string;
  placeholder?: string;
  onSave: (v: string) => Promise<ActionResult>;
  display?: React.ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <div>
        <div className="flex items-center justify-between gap-4">
          <span className="min-w-0 truncate text-sm">{display ?? (value || <span className="text-muted">Not set</span>)}</span>
          <button
            type="button"
            onClick={() => {
              setDraft(value);
              setResult(null);
              setEditing(true);
            }}
            className={`${ghostButtonClass} shrink-0 py-1 text-xs`}
          >
            Edit
          </button>
        </div>
        <Feedback result={result} />
      </div>
    );
  }
  return (
    <form
      className="w-full sm:w-80"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await onSave(draft);
          setResult(res);
          if (res.ok) {
            setEditing(false);
            router.refresh();
          }
        });
      }}
    >
      <label className="sr-only">{label}</label>
      <input autoFocus type={type} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} className={inputClass} />
      <div className="mt-2 flex gap-2">
        <button disabled={pending || !draft.trim()} className={`${buttonClass} py-1 text-xs`}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={pending} className={`${ghostButtonClass} py-1 text-xs`}>
          Cancel
        </button>
      </div>
      <Feedback result={result} />
    </form>
  );
}

export function NameField({ name }: { name: string }) {
  return <EditableField label="Name" value={name} placeholder="Your name" onSave={updateName} />;
}

export function EmailField({ email, pending }: { email: string; pending: string | null }) {
  return (
    <EditableField
      label="Email"
      type="email"
      value={email}
      placeholder="you@example.com"
      onSave={changeEmail}
      display={
        <>
          {email}
          {pending && <span className="ml-2 rounded border border-warn/50 px-1.5 py-px text-[11px] text-warn">Confirming {pending}</span>}
        </>
      }
    />
  );
}

export function PasswordForm() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <div>
        <button type="button" onClick={() => {
            setResult(null);
            setOpen(true);
          }} className={`${ghostButtonClass} py-1 text-xs`}>
          Change password
        </button>
        <Feedback result={result} />
      </div>
    );
  }
  return (
    <form
      className="grid w-full gap-2 sm:w-80"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const res = await changePassword(String(f.get("current")), String(f.get("next")), String(f.get("confirm")));
          setResult(res);
          if (res.ok) setOpen(false);
        });
      }}
    >
      <input name="current" type="password" required autoComplete="current-password" placeholder="Current password" className={inputClass} />
      <input name="next" type="password" required minLength={8} autoComplete="new-password" placeholder="New password (8+ characters)" className={inputClass} />
      <input name="confirm" type="password" required minLength={8} autoComplete="new-password" placeholder="Confirm new password" className={inputClass} />
      <div className="flex gap-2">
        <button disabled={pending} className={`${buttonClass} py-1 text-xs`}>
          {pending ? "Changing…" : "Change password"}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className={`${ghostButtonClass} py-1 text-xs`}>
          Cancel
        </button>
      </div>
      <Feedback result={result} />
    </form>
  );
}

export function ResetLinkButton() {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <button type="button" disabled={pending} onClick={() => start(async () => setResult(await sendPasswordResetLink()))} className={`${ghostButtonClass} py-1 text-xs`}>
        {pending ? "Sending…" : "Email me a reset link"}
      </button>
      <Feedback result={result} />
    </div>
  );
}

export function SignOutEverywhereButton() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm("Sign out of Confu on every device, including this one?")) start(() => signOutEverywhere());
      }}
      className={`${ghostButtonClass} py-1 text-xs`}
    >
      {pending ? "Signing out…" : "Sign out everywhere"}
    </button>
  );
}

export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-danger px-3 py-1 text-xs font-medium text-danger transition hover:bg-danger hover:text-white">
        Delete account
      </button>
    );
  }
  return (
    <form
      className="grid w-full gap-2 sm:w-80"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await deleteAccount(text)));
      }}
    >
      <p className="text-sm">
        This permanently deletes your account, every session, PDF, note, highlight and conversation. It can&apos;t be undone. Type{" "}
        <b className="font-mono">DELETE</b> to confirm.
      </p>
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="DELETE" className={`${inputClass} font-mono`} />
      <div className="flex gap-2">
        <button disabled={pending || text.trim() !== "DELETE"} className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40">
          {pending ? "Deleting…" : "Delete my account"}
        </button>
        <button type="button" onClick={() => {
            setOpen(false);
            setText("");
          }} disabled={pending} className={`${ghostButtonClass} py-1 text-xs`}>
          Cancel
        </button>
      </div>
      <Feedback result={result} />
    </form>
  );
}

export function RequestProButton({ requestedAt }: { requestedAt: string | null }) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  if (requestedAt) {
    return (
      <p className="rounded-lg border border-dashed border-ink/40 bg-paper px-3 py-2 text-xs leading-relaxed text-muted">
        <span className="font-medium text-ink">Requested</span> on <LocalTime iso={requestedAt} />. Pro turns on as soon as it&apos;s approved.
      </p>
    );
  }
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await requestPro();
            setResult(res);
            if (res.ok) router.refresh();
          })
        }
        className={`${buttonClass} w-full`}
      >
        {pending ? "Requesting…" : "Request Pro"}
      </button>
      <Feedback result={result} />
    </div>
  );
}

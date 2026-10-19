"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { login, requestPasswordReset, signup, updatePassword, type AuthState } from "@/app/(auth)/actions";
import { buttonClass, inputClass, labelClass } from "@/components/ui";

function Status({ state, urlError }: { state: AuthState; urlError?: string | null }) {
  const error = state?.error ?? urlError;
  if (error) return <p role="alert" className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>;
  if (state?.message) return <p role="status" className="animate-pop rounded-lg border border-ok/40 bg-ok/5 px-3 py-2 text-sm text-ok">{state.message}</p>;
  return null;
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input className={inputClass} {...props} />
    </label>
  );
}

export function LoginForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={params.get("next") ?? "/dashboard"} />
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <div>
        <Field label="Password" name="password" type="password" autoComplete="current-password" required minLength={8} />
        <Link href="/forgot-password" className="mt-1.5 inline-block text-xs text-muted hover:text-ink">
          Forgot password?
        </Link>
      </div>
      <Status state={state} urlError={params.get("error")} />
      <button className={`${buttonClass} w-full py-2.5`} disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined);
  if (state?.message) return <Status state={state} />;
  return (
    <form action={action} className="space-y-4">
      <Field label="Name" name="fullName" autoComplete="name" required />
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={8} placeholder="At least 8 characters" />
      <Status state={state} />
      <button className={`${buttonClass} w-full py-2.5`} disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Status state={state} />
      <button className={`${buttonClass} w-full py-2.5`} disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="New password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      <Status state={state} />
      <button className={`${buttonClass} w-full py-2.5`} disabled={pending}>
        {pending ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}

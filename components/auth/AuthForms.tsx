"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useSyncExternalStore } from "react";
import { login, requestPasswordReset, resendConfirmation, signup, updatePassword, type AuthState } from "@/app/(auth)/actions";
import { buttonClass, inputClass, labelClass } from "@/components/ui";
import { safeNext } from "@/lib/safe-next";
import { HEARD_FROM, OCCUPATIONS, PURPOSES } from "@/lib/signup-survey";
import { useCaptcha } from "./Captcha";
import { GoogleButton, OrDivider } from "./GoogleButton";

// Where to go, and any error or invite flag, from the address bar.
// useSearchParams() would hide this form behind Suspense. Chrome's password
// manager only attaches to a password field that was in the first HTML, so
// the server snapshot stays empty and the real query is read after hydration.
type AuthQuery = { next: string; error: string | null; invited: boolean };
const SERVER_QUERY: AuthQuery = { next: "/dashboard", error: null, invited: false };
let cachedSearch = "";
let cachedQuery: AuthQuery = SERVER_QUERY;

function subscribeToQuery(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function readQuery(): AuthQuery {
  const search = window.location.search;
  if (search === cachedSearch) return cachedQuery;
  cachedSearch = search;
  const params = new URLSearchParams(search);
  const next = safeNext(params.get("next"));
  const error = params.get("error");
  const invited = Boolean(params.get("ref"));
  cachedQuery = next === SERVER_QUERY.next && error == null && !invited ? SERVER_QUERY : { next, error, invited };
  return cachedQuery;
}

function useAuthQuery() {
  return useSyncExternalStore(subscribeToQuery, readQuery, () => SERVER_QUERY);
}

// The obvious next step after an error: resend the confirmation, reset the
// password, or switch between sign-in and sign-up.
function NextStep({ state, email }: { state: AuthState; email: string }) {
  const [resendState, resend, sending] = useActionState(resendConfirmation, undefined);
  const captcha = useCaptcha();
  const resetCaptcha = captcha.reset;
  useEffect(() => resetCaptcha(), [resendState, resetCaptcha]);
  if (!state?.action) return null;
  if (state.action === "resend") {
    return (
      <form action={resend} className="mt-3 space-y-2">
        <input type="hidden" name="email" value={state.email ?? email} />
        {captcha.field}
        <button disabled={sending || !captcha.ready} className="w-full rounded-lg border border-ink px-3 py-2 text-sm font-medium transition hover:bg-ink hover:text-white disabled:opacity-50">
          {sending ? "Sending…" : "Resend the confirmation email"}
        </button>
        <Status state={resendState} />
      </form>
    );
  }
  const links = {
    reset: { href: "/forgot-password", label: "Reset your password" },
    signin: { href: "/login", label: "Sign in instead" },
    signup: { href: "/signup", label: "Create an account" },
  } as const;
  const l = links[state.action];
  return (
    <Link href={l.href} className="mt-3 block w-full rounded-lg border border-ink px-3 py-2 text-center text-sm font-medium transition hover:bg-ink hover:text-white">
      {l.label}
    </Link>
  );
}

function Status({ state, urlError }: { state: AuthState; urlError?: string | null }) {
  const error = state?.error ?? urlError;
  if (error)
    return (
      <p role="alert" className="animate-pop rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
        {error}
      </p>
    );
  if (state?.message)
    return (
      <p role="status" className="animate-pop rounded-lg border border-ok/40 bg-ok/5 px-3 py-2 text-sm text-ok">
        {state.message}
      </p>
    );
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
  const query = useAuthQuery();
  const [state, action, pending] = useActionState(login, undefined);
  const [email, setEmail] = useState("");
  const captcha = useCaptcha();
  const resetCaptcha = captcha.reset;
  useEffect(() => resetCaptcha(), [state, resetCaptcha]); // a captcha token works once
  return (
    <>
      <GoogleButton next={query.next} />
      <OrDivider />
      <form action={action} autoComplete="on" className="space-y-4">
        <input type="hidden" name="next" value={query.next} />
        {/* Uncontrolled on purpose. A controlled value is wiped when Chrome
            fills or the user pastes, because that write often skips onChange. */}
        <Field
          label="Email"
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          onInput={(e) => setEmail(e.currentTarget.value)}
        />
        <div>
          <Field
            label="Password"
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            minLength={8}
          />
          <Link href="/forgot-password" className="mt-1.5 inline-block text-xs text-muted hover:text-ink">
            Forgot password?
          </Link>
        </div>
        {captcha.field}
        <Status state={state} urlError={query.error} />
        <button type="submit" className={`${buttonClass} w-full py-2.5`} disabled={pending || !captcha.ready}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <NextStep state={state} email={email} />
    </>
  );
}

export function SignupForm() {
  const query = useAuthQuery();
  const [state, action, pending] = useActionState(signup, undefined);
  const captcha = useCaptcha();
  const resetCaptcha = captcha.reset;
  useEffect(() => resetCaptcha(), [state, resetCaptcha]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const v = state?.values ?? {};
  if (state?.message) return <CheckInbox email={v.email} />;
  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <>
      {query.invited && (
        <p className="mb-4 rounded-lg border border-ink bg-yellow-100 px-3 py-2.5 text-sm leading-relaxed">
          <span className="font-medium">You were invited.</span> Sign up and your friend will see you joined.
        </p>
      )}
      <GoogleButton label="Sign up with Google" next={query.next} />
      <OrDivider />
      {/* Keyed by the returned answers so they're refilled after an error. */}
      <form key={JSON.stringify(v)} action={action} autoComplete="on" className="space-y-4">
        <input type="hidden" name="next" value={query.next} />
        <Field label="Name" id="name" name="fullName" autoComplete="name" required defaultValue={v.fullName} />
        <Field
          label="Email"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          defaultValue={v.email}
        />
        <Field
          label="Password"
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          minLength={8}
          placeholder="At least 8 characters"
          defaultValue={password}
          onInput={(e) => setPassword(e.currentTarget.value)}
        />
        <div>
          <Field
            label="Confirm password"
            id="confirm-password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            minLength={8}
            defaultValue={confirm}
            onInput={(e) => setConfirm(e.currentTarget.value)}
            aria-invalid={mismatch}
          />
          {mismatch && <p className="animate-pop mt-1.5 text-xs text-danger">Passwords don&apos;t match yet.</p>}
        </div>

        <div className="space-y-4 border-t border-line pt-5">
          <p className="text-sm text-muted">Three quick questions so we can build Confu for you.</p>
          <Select label="How did you hear about Confu?" name="heardFrom" options={HEARD_FROM} defaultValue={v.heardFrom} />
          <Select label="What describes you best?" name="occupation" options={OCCUPATIONS} defaultValue={v.occupation} />
          <Select label="What will you mainly use Confu for?" name="purpose" options={PURPOSES} defaultValue={v.purpose} />
          <label className="block">
            <span className={labelClass}>
              Anything more about your goal? <span className="font-normal text-muted">(optional)</span>
            </span>
            <textarea
              name="purposeDetail"
              rows={2}
              maxLength={500}
              defaultValue={v.purposeDetail}
              placeholder="e.g. Passing my linear algebra final in May"
              className={`${inputClass} resize-none`}
            />
          </label>
        </div>

        {captcha.field}
        <Status state={state} />
        <button type="submit" className={`${buttonClass} w-full py-2.5`} disabled={pending || mismatch || !captcha.ready}>
          {pending ? "Creating account…" : "Create account"}
        </button>
        <p className="text-center text-xs leading-relaxed text-muted">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-ink">
            Terms &amp; disclaimer
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
      <NextStep state={state} email={v.email ?? ""} />
    </>
  );
}

function Select({ label, name, options, defaultValue }: { label: string; name: string; options: readonly string[]; defaultValue?: string }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <select name={name} required defaultValue={defaultValue ?? ""} className={`${inputClass} cursor-pointer`}>
        <option value="" disabled>
          Choose one
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  const [email, setEmail] = useState("");
  const captcha = useCaptcha();
  const resetCaptcha = captcha.reset;
  useEffect(() => resetCaptcha(), [state, resetCaptcha]);
  return (
    <form action={action} className="space-y-4">
      <Field label="Email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      {captcha.field}
      <Status state={state} />
      <button className={`${buttonClass} w-full py-2.5`} disabled={pending || !captcha.ready}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, undefined);
  return (
    <form action={action} autoComplete="on" className="space-y-4">
      <Field label="New password" id="password" name="password" type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} required minLength={8} />
      <Field label="Confirm password" id="confirm-password" name="confirm" type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} required minLength={8} />
      <Status state={state} />
      <button type="submit" className={`${buttonClass} w-full py-2.5`} disabled={pending}>
        {pending ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}

// After sign-up: where the confirmation email went, and where else to look.
function CheckInbox({ email }: { email?: string }) {
  return (
    <div role="status" className="animate-pop space-y-4">
      <div className="flex size-12 items-center justify-center rounded-full border border-ink bg-yellow-200">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      </div>
      <div>
        <p className="font-serif text-2xl leading-tight">Check your inbox</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          We sent a confirmation link to {email ? <b className="text-ink">{email}</b> : "your email"}. Click it to finish creating your account.
        </p>
      </div>
      <div className="rounded-lg border border-dashed border-ink/40 bg-paper px-4 py-3 text-sm leading-relaxed">
        <p className="font-medium">Can&apos;t find it?</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted">
          <li>
            Check your <b className="text-ink">Spam</b>, <b className="text-ink">Junk</b> or <b className="text-ink">Promotions</b> folder. It comes from
            “ConfuAI”.
          </li>
          <li>If it&apos;s there, mark it “Not spam” so our next emails reach your inbox.</li>
          <li>It can take a minute or two to arrive.</li>
        </ul>
      </div>
      <p className="text-xs text-muted">
        Wrong email?{" "}
        <a href="/signup" className="underline underline-offset-2 hover:text-ink">
          Sign up again
        </a>
      </p>
    </div>
  );
}

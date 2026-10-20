// Supabase auth errors, in plain words. Matched on the error code first, then
// on the message (older endpoints only send a message).

type AuthLikeError = { code?: string; message?: string; status?: number } | null | undefined;

export type FriendlyError = { error: string; action?: "resend" | "reset" | "signin" | "signup" };

export function friendlyAuthError(err: AuthLikeError, context: "signin" | "signup" | "reset" | "update" | "link" = "signin"): FriendlyError {
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").toLowerCase();
  const has = (...words: string[]) => words.some((w) => msg.includes(w));

  if (code === "invalid_credentials" || has("invalid login credentials"))
    return { error: "That email and password don't match. Check for typos, or reset your password.", action: "reset" };
  if (code === "email_not_confirmed" || has("email not confirmed"))
    return { error: "You haven't confirmed your email yet. Check your inbox (and Spam) for the link, or send it again.", action: "resend" };
  if (code === "user_already_exists" || code === "email_exists" || has("already registered", "already been registered"))
    return { error: "There's already an account with this email. Sign in instead, or reset your password.", action: "signin" };
  if (code === "captcha_failed" || has("captcha"))
    return { error: "We couldn't verify you're human. Complete the check below and try again." };
  if (code === "over_email_send_rate_limit" || has("email rate limit", "for security purposes, you can only request this"))
    return { error: "We've just sent you an email. Wait a minute before asking for another." };
  if (code === "over_request_rate_limit" || err?.status === 429 || has("rate limit", "too many requests"))
    return { error: "Too many attempts. Wait a minute, then try again." };
  if (code === "weak_password" || has("password should", "weak password"))
    return { error: "Choose a stronger password: at least 8 characters, mixing letters and numbers." };
  if (code === "same_password" || has("should be different from the old"))
    return { error: "That's your current password. Choose a new one." };
  if (code === "email_address_invalid" || has("invalid email", "unable to validate email"))
    return { error: "That email address doesn't look right. Check it and try again." };
  if (code === "signup_disabled" || has("signups not allowed"))
    return { error: "New sign-ups are paused right now. Please try again later." };
  if (code === "otp_expired" || has("expired", "invalid or has expired"))
    return context === "link"
      ? { error: "That link has expired or was already used. Sign in, or ask for a new link.", action: "signin" }
      : { error: "That code has expired. Ask for a new one." };
  // PKCE: the link was opened in another browser/app, or used twice.
  if (code === "bad_code_verifier" || code === "flow_state_not_found" || code === "flow_state_expired" || has("code verifier", "code challenge", "flow state"))
    return {
      error: "That link opened in a different browser from the one you started in (email apps often do this). If you were confirming your email, it's done: just sign in. Otherwise, start again here.",
      action: "signin",
    };
  if (has("fetch failed", "network"))
    return { error: "We couldn't reach the server. Check your connection and try again." };
  if (context === "link") return { error: "That link didn't work. Sign in, or ask for a new link.", action: "signin" };
  return { error: err?.message || "Something went wrong. Please try again." };
}

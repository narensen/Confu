"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { HEARD_FROM, OCCUPATIONS, PURPOSES } from "@/lib/signup-survey";
import { createClient } from "@/lib/supabase/server";

// `values` hands the sign-up answers back on an error, so the form keeps them.
export type AuthState = { error?: string; message?: string; values?: Record<string, string> } | undefined;

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  // Only allow same-site relative paths.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

async function origin() {
  const h = await headers();
  return h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

const Credentials = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function login(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = Credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: error.message };

  redirect(safeNext(formData.get("next")));
}

const Signup = Credentials.extend({
  fullName: z.string().trim().min(1, "Enter your name").max(100),
  confirm: z.string(),
  heardFrom: z.enum(HEARD_FROM, "Tell us how you heard about Confu"),
  occupation: z.enum(OCCUPATIONS, "Tell us what describes you best"),
  purpose: z.enum(PURPOSES, "Tell us what you'll use Confu for"),
  purposeDetail: z.string().trim().max(500, "Keep it under 500 characters"),
}).refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });

export async function signup(_: AuthState, formData: FormData): Promise<AuthState> {
  const raw = Object.fromEntries(
    ["fullName", "email", "password", "confirm", "heardFrom", "occupation", "purpose", "purposeDetail"].map((k) => [k, String(formData.get(k) ?? "")]),
  );
  // Everything but the passwords goes back to the form on an error.
  const values = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "password" && k !== "confirm"));
  const parsed = Signup.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
        heard_from: parsed.data.heardFrom,
        occupation: parsed.data.occupation,
        purpose: parsed.data.purpose,
        purpose_detail: parsed.data.purposeDetail || null,
      },
      emailRedirectTo: `${await origin()}/auth/confirm?next=/dashboard`,
    },
  });
  if (error) return { error: error.message, values };

  // With email confirmation disabled, Supabase returns a session immediately.
  if (data.session) redirect("/dashboard");
  return { message: "Check your email for a confirmation link to finish signing up." };
}

export async function requestPasswordReset(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = z.email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Enter a valid email" };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${await origin()}/auth/confirm?next=/reset-password`,
  });
  if (error) return { error: error.message };
  return { message: "If an account exists for that email, a reset link is on its way." };
}

export async function updatePassword(_: AuthState, formData: FormData): Promise<AuthState> {
  const password = z.string().min(8).safeParse(formData.get("password"));
  if (!password.success) return { error: "Password must be at least 8 characters" };
  if (formData.get("password") !== formData.get("confirm")) return { error: "Passwords don't match" };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) return { error: error.message };
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentRole, requireUser } from "@/lib/dal";
import { isOwner } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function origin() {
  const h = await headers();
  return h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export async function updateName(raw: string): Promise<ActionResult> {
  const user = await requireUser();
  const name = z.string().trim().min(1, "Enter your name").max(100, "That's too long").safeParse(raw);
  if (!name.success) return { ok: false, error: name.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ data: { full_name: name.data } });
  if (error) return { ok: false, error: error.message };
  await supabase.from("profiles").update({ full_name: name.data }).eq("id", user.id);
  // The name is read from the session token; refresh it so it shows everywhere now.
  await supabase.auth.refreshSession();
  return { ok: true, message: "Name updated." };
}

export async function changeEmail(raw: string): Promise<ActionResult> {
  const user = await requireUser();
  const email = z.email("Enter a valid email").safeParse(String(raw).trim());
  if (!email.success) return { ok: false, error: email.error.issues[0].message };
  if (email.data.toLowerCase() === user.email?.toLowerCase()) return { ok: false, error: "That's already your email." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email: email.data }, { emailRedirectTo: `${await origin()}/auth/confirm?next=/settings` });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Check ${email.data} (and your current inbox) for a confirmation link. The change applies once you confirm.` };
}

export async function changePassword(current: string, next: string, confirm: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.email) return { ok: false, error: "Your account has no email to verify with." };
  if (String(next).length < 8) return { ok: false, error: "The new password must be at least 8 characters." };
  if (next !== confirm) return { ok: false, error: "The new passwords don't match." };
  if (next === current) return { ok: false, error: "Choose a password different from your current one." };

  const supabase = await createClient();
  // Prove it's really you before changing it.
  const check = await supabase.auth.signInWithPassword({ email: user.email, password: String(current) });
  if (check.error) return { ok: false, error: "Your current password is incorrect." };

  const { error } = await supabase.auth.updateUser({ password: String(next) });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Password changed." };
}

export async function sendPasswordResetLink(): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.email) return { ok: false, error: "Your account has no email." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: `${await origin()}/auth/confirm?next=/reset-password` });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `We've sent a reset link to ${user.email}.` };
}

export async function signOutEverywhere() {
  await requireUser();
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}

// Remove every file the user stored (PDFs and captured figures), then the
// account; the database cascade removes all their rows.
export async function deleteAccount(confirmText: string): Promise<ActionResult> {
  const user = await requireUser();
  if (confirmText.trim() !== "DELETE") return { ok: false, error: 'Type DELETE to confirm.' };
  const supabase = await createClient();
  const bucket = supabase.storage.from("documents");

  for (const folder of [user.id, `${user.id}/highlights`]) {
    for (;;) {
      const { data, error } = await bucket.list(folder, { limit: 100 });
      if (error) return { ok: false, error: `Couldn't remove your files: ${error.message}` };
      const files = (data ?? []).filter((f) => f.id).map((f) => `${folder}/${f.name}`);
      if (!files.length) break;
      const removed = await bucket.remove(files);
      if (removed.error) return { ok: false, error: `Couldn't remove your files: ${removed.error.message}` };
    }
  }

  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    return {
      ok: false,
      error: /delete_my_account/.test(error.message) ? "Account deletion isn't set up yet (migration 0012)." : error.message,
    };
  }
  await supabase.auth.signOut();
  redirect("/?account=deleted");
}

// Ask for Pro. The owner sees requests in Settings → Pro members.
export async function requestPro(): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_pro");
  if (error) return { ok: false, error: /request_pro/.test(error.message) ? "Pro requests aren't set up yet (migration 0012)." : error.message };
  return { ok: true, message: "Requested. Pro turns on as soon as it's approved; you'll see it here and in your account menu." };
}

// Owner only: put an account on Pro, or back on Free (also answers a request).
export async function setPro(rawEmail: string, pro: boolean): Promise<ActionResult> {
  await requireUser();
  if (!isOwner(await getCurrentRole())) return { ok: false, error: "Only the owner can change plans." };
  const email = z.email("Enter a valid email").safeParse(String(rawEmail).trim());
  if (!email.success) return { ok: false, error: email.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_pro", { target_email: email.data, pro });
  if (error) return { ok: false, error: /set_pro/.test(error.message) ? "Plan changes aren't set up yet (migration 0012)." : error.message };
  return { ok: true, message: pro ? `${email.data} is on Pro.` : `${email.data} is on Free.` };
}

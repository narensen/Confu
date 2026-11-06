import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Invite links (/r/<code>) leave the code in a cookie; the new account claims
// it once it's signed in for the first time (claim_referral, migration 0023).
export const INVITE_COOKIE = "confu_ref";
export const FLASH_COOKIE = "confu_flash"; // a one-off message for the next page (see FlashToast)
export const INVITE_CODE = /^[a-z0-9]{6,12}$/;

export async function claimInvite(supabase: SupabaseClient) {
  const jar = await cookies();
  const code = jar.get(INVITE_COOKIE)?.value?.toLowerCase();
  if (!code) return;
  jar.delete(INVITE_COOKIE);
  if (!INVITE_CODE.test(code)) return;
  const { data } = await supabase.rpc("claim_referral", { p_code: code });
  if (data === "ok") jar.set(FLASH_COOKIE, "invite", { path: "/", maxAge: 600, sameSite: "lax" });
}

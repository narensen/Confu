import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { friendlyAuthError } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/server";

// Landing route for links in Supabase auth emails (confirm sign-up, reset
// password, magic link) and for OAuth/PKCE `code` redirects.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const rawNext = searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  const supabase = await createClient();
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  let failure: { code?: string; message?: string } | null = { message: "Invalid or expired link" };
  if (tokenHash && type) {
    const res = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    failure = res.error;
  } else if (code) {
    const res = await supabase.auth.exchangeCodeForSession(code);
    failure = res.error;
  }
  // A link tapped twice, or one that finished in another tab, fails here even
  // though they're signed in already: just carry on.
  if (failure && (await supabase.auth.getClaims()).data?.claims) failure = null;
  const error = failure ? friendlyAuthError(failure, "link").error : null;

  const url = request.nextUrl.clone();
  url.search = "";
  if (error) {
    url.pathname = "/login";
    url.searchParams.set("error", error);
  } else {
    url.pathname = next;
  }
  return NextResponse.redirect(url);
}

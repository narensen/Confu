import { NextResponse, type NextRequest } from "next/server";
import { billingConfigured, createCheckout, currentRegion, STUDENT_CODE } from "@/lib/billing";
import { logError } from "@/lib/log";
import { isAcademicEmail } from "@/lib/pricing";
import { SITE } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

// "Get Pro": a Lemon Squeezy checkout for this account, at the visitor's
// regional price, with the student discount for college emails. A plain link
// (GET) so it works from anywhere; it only ever opens a checkout for yourself.
export async function GET(request: NextRequest) {
  const back = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) return back("/signup?next=/pricing");
  if (!billingConfigured) return back("/pricing?billing=unavailable");

  // Already paying: manage the plan instead of starting a second one.
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", claims.sub).maybeSingle();
  const paidUntil = (profile as { paid_until?: string | null } | null)?.paid_until;
  if (paidUntil && Date.parse(paidUntil) > Date.now()) return back("/api/billing/portal");

  const email = (claims.email as string | undefined) ?? null;
  const name = ((claims.user_metadata ?? {}) as { full_name?: string }).full_name ?? null;
  try {
    const url = await createCheckout({
      userId: claims.sub,
      email,
      name,
      region: await currentRegion(request.nextUrl.searchParams.get("region")),
      discountCode: STUDENT_CODE && isAcademicEmail(email) ? STUDENT_CODE : null,
      returnUrl: `${SITE.url}/settings?billing=success#plan`,
    });
    return NextResponse.redirect(url, 303);
  } catch (err) {
    logError("checkout failed", err);
    return back("/pricing?billing=error");
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { billingConfigured, portalUrl } from "@/lib/billing";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

// "Manage billing": Lemon Squeezy's customer portal for this account's latest
// subscription (cancel, resume, change card, invoices).
export async function GET(request: NextRequest) {
  const back = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return back("/login?next=/settings");
  if (!billingConfigured) return back("/settings#plan");

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("user_id", auth.claims.sub)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return back("/pricing");
  try {
    const url = await portalUrl(sub.id as string);
    if (url) return NextResponse.redirect(url, 303);
  } catch (err) {
    logError("billing portal failed", err);
  }
  // Lemon Squeezy's own page for finding your orders by email.
  return NextResponse.redirect("https://app.lemonsqueezy.com/my-orders", 303);
}

import { accessUntil, regionOfVariant, storeId, verifySignature } from "@/lib/billing";
import { logError } from "@/lib/log";
import { adminClient } from "@/lib/supabase/admin";

// Lemon Squeezy → Confu: subscription changes (created, renewed, cancelled,
// resumed, paused, expired, payment failed…). Each one is stored, and the
// account's Pro is set to run until the latest of its subscriptions allows.
// Signed with LEMONSQUEEZY_WEBHOOK_SECRET; anything unsigned is refused.

type Attributes = {
  store_id: number;
  customer_id: number;
  variant_id: number;
  status: string;
  renews_at: string | null;
  ends_at: string | null;
  card_brand: string | null;
  card_last_four: string | null;
  updated_at: string | null;
  test_mode?: boolean;
  user_email?: string;
};
type Event = { meta?: { event_name?: string; custom_data?: { user_id?: string } }; data?: { type?: string; id?: string; attributes?: Attributes } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-signature"))) return new Response("Invalid signature", { status: 401 });
  let event: Event;
  try {
    event = JSON.parse(raw) as Event;
  } catch {
    return new Response("Invalid body", { status: 400 });
  }
  const name = event.meta?.event_name ?? "";
  const sub = event.data;
  const a = sub?.attributes;
  // Only subscription objects change access (invoices and orders come with their own events).
  if (sub?.type !== "subscriptions" || !sub.id || !a) return Response.json({ ok: true, ignored: name });
  if (storeId && String(a.store_id) !== storeId) return Response.json({ ok: true, ignored: "other store" });

  const admin = adminClient();
  if (!admin) return new Response("SUPABASE_SERVICE_ROLE_KEY isn't set", { status: 500 });

  const { data: existing } = await admin.from("subscriptions").select("user_id, provider_updated_at").eq("id", sub.id).maybeSingle();
  const userId = existing?.user_id ?? event.meta?.custom_data?.user_id;
  if (!userId || !UUID.test(userId)) {
    logError("billing webhook without a user", new Error(`${name} for subscription ${sub.id}`));
    return Response.json({ ok: true, ignored: "no user" });
  }
  // Webhooks can arrive out of order: keep the newest state.
  if (existing?.provider_updated_at && a.updated_at && Date.parse(a.updated_at) < Date.parse(existing.provider_updated_at)) {
    return Response.json({ ok: true, ignored: "stale" });
  }

  const row = {
    id: sub.id,
    user_id: userId,
    customer_id: String(a.customer_id),
    variant_id: String(a.variant_id),
    region: regionOfVariant(a.variant_id),
    status: a.status,
    renews_at: a.renews_at,
    ends_at: a.ends_at,
    card_brand: a.card_brand || null,
    card_last_four: a.card_last_four || null,
    provider_updated_at: a.updated_at,
    test_mode: Boolean(a.test_mode),
  };
  const saved = await admin.from("subscriptions").upsert(row, { onConflict: "id" });
  if (saved.error) {
    logError("billing webhook save failed", saved.error);
    return new Response("Couldn't save", { status: 500 }); // Lemon Squeezy retries
  }

  // Pro runs until the latest any of their subscriptions allows (someone may resubscribe).
  const { data: subs } = await admin.from("subscriptions").select("status, renews_at, ends_at").eq("user_id", userId);
  const now = Date.now();
  const until = Math.max(now, ...((subs ?? []) as { status: string; renews_at: string | null; ends_at: string | null }[]).map((s) => accessUntil(s, now)));
  const updated = await admin.from("profiles").update({ paid_until: new Date(until).toISOString() }).eq("id", userId);
  if (updated.error) {
    logError("billing webhook profile update failed", updated.error);
    return new Response("Couldn't update", { status: 500 });
  }
  return Response.json({ ok: true, event: name, status: a.status });
}

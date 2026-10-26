import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { regionOf, type Region } from "@/lib/pricing";

// Paid Pro through Lemon Squeezy, the merchant of record: it runs the
// checkout, charges, sales tax and invoices; we only hear about the
// subscription (webhook) and switch Pro on and off. Off until these are set:
//   LEMONSQUEEZY_API_KEY          Settings → API in Lemon Squeezy
//   LEMONSQUEEZY_STORE_ID         the store's number
//   LEMONSQUEEZY_VARIANT_INTL     the "Pro" variant at $6/month
//   LEMONSQUEEZY_VARIANT_INDIA    optional: the India variant (≈ ₹299/month in USD)
//   LEMONSQUEEZY_WEBHOOK_SECRET   the signing secret of the webhook to /api/billing/webhook
//   STUDENT_DISCOUNT_CODE         optional: a discount code applied for college emails

const API = "https://api.lemonsqueezy.com/v1";
const KEY = process.env.LEMONSQUEEZY_API_KEY?.trim();
const STORE = process.env.LEMONSQUEEZY_STORE_ID?.trim();
const VARIANTS: Record<Region, string | undefined> = {
  intl: process.env.LEMONSQUEEZY_VARIANT_INTL?.trim(),
  india: process.env.LEMONSQUEEZY_VARIANT_INDIA?.trim(),
};
const SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim();
export const STUDENT_CODE = process.env.STUDENT_DISCOUNT_CODE?.trim() || null;

export const billingConfigured = Boolean(KEY && STORE && VARIANTS.intl);
export const storeId = STORE ?? null;

// The visitor's pricing region. Locally there's no country header; ?region=india previews it.
export async function currentRegion(preview?: string | null): Promise<Region> {
  if (preview === "india" && process.env.NODE_ENV !== "production") return "india";
  return regionOf((await headers()).get("x-vercel-ip-country"), Boolean(VARIANTS.india));
}

export const regionOfVariant = (variantId: string | number | null | undefined): Region =>
  variantId != null && VARIANTS.india && String(variantId) === VARIANTS.india ? "india" : "intl";

async function ls<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json", Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Lemon Squeezy answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export async function createCheckout(o: { userId: string; email: string | null; name: string | null; region: Region; discountCode?: string | null; returnUrl: string }) {
  const variant = VARIANTS[o.region] ?? VARIANTS.intl;
  const body = {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          ...(o.email ? { email: o.email } : {}),
          ...(o.name ? { name: o.name } : {}),
          ...(o.discountCode ? { discount_code: o.discountCode } : {}),
          ...(o.region === "india" ? { billing_address: { country: "IN" } } : {}),
          custom: { user_id: o.userId },
        },
        checkout_options: { embed: false, media: false, logo: true },
        product_options: { enabled_variants: [Number(variant)], redirect_url: o.returnUrl },
      },
      relationships: {
        store: { data: { type: "stores", id: STORE } },
        variant: { data: { type: "variants", id: variant } },
      },
    },
  };
  const j = await ls<{ data: { attributes: { url: string } } }>("/checkouts", { method: "POST", body: JSON.stringify(body) });
  return j.data.attributes.url;
}

// A fresh, pre-signed link to the customer portal (cancel, change card, invoices). Valid 24 hours.
export async function portalUrl(subscriptionId: string): Promise<string | null> {
  const j = await ls<{ data: { attributes: { urls?: { customer_portal?: string | null } } } }>(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  return j.data.attributes.urls?.customer_portal ?? null;
}

export function verifySignature(raw: string, signature: string | null): boolean {
  if (!SECRET || !signature) return false;
  const digest = Buffer.from(createHmac("sha256", SECRET).update(raw).digest("hex"), "utf8");
  const given = Buffer.from(signature, "utf8");
  return digest.length === given.length && timingSafeEqual(digest, given);
}

const DAY = 86_400_000;

// How long a subscription keeps Pro on. Renewals get a few days' grace while
// the payment goes through; failed payments keep access while Lemon Squeezy
// retries (about two weeks); a cancelled plan runs to the end of what was paid.
export function accessUntil(s: { status: string; renews_at: string | null; ends_at: string | null }, now = Date.now()): number {
  const at = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  switch (s.status) {
    case "active":
    case "on_trial":
    case "past_due": {
      const renews = at(s.renews_at);
      return (Number.isFinite(renews) ? renews : now + 31 * DAY) + 3 * DAY;
    }
    case "cancelled": {
      const ends = at(s.ends_at);
      return Number.isFinite(ends) ? ends : now;
    }
    default: // paused, unpaid, expired
      return now;
  }
}

import "server-only";
import webpush from "web-push";
import { SITE } from "@/lib/site";

// Browser push (Web Push with VAPID keys). Off until
// NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set.
const PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
export const pushConfigured = Boolean(PUBLIC && PRIVATE);
if (pushConfigured) webpush.setVapidDetails(`mailto:${SITE.contactEmail}`, PUBLIC!, PRIVATE!);

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

// Returns "sent", or "gone" when the browser dropped the subscription.
export async function sendPush(t: PushTarget, payload: { title: string; body: string; url: string }): Promise<"sent" | "gone" | "failed"> {
  try {
    await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(payload), { TTL: 12 * 3600 });
    return "sent";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? "gone" : "failed";
  }
}

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SITE } from "@/lib/site";

// Email through Resend's API. Off until RESEND_API_KEY and EMAIL_FROM are set
// (EMAIL_FROM like "Confu <hello@mail.confu.lol>", on a domain verified in Resend).

const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM;
export const emailConfigured = Boolean(KEY && FROM);

export type EmailKind = "digest" | "reminder";

// Signed unsubscribe links: no login needed, can't be forged for someone else.
function sign(userId: string, kind: EmailKind) {
  const secret = process.env.KEY_ENCRYPTION_SECRET ?? "";
  return createHmac("sha256", secret).update(`unsubscribe:${userId}:${kind}`).digest("base64url").slice(0, 32);
}
export function unsubscribeUrl(userId: string, kind: EmailKind) {
  return `${SITE.url}/api/email/unsubscribe?u=${userId}&k=${kind}&t=${sign(userId, kind)}`;
}
export function verifyUnsubscribe(userId: string, kind: string, token: string) {
  if (kind !== "digest" && kind !== "reminder") return false;
  const want = Buffer.from(sign(userId, kind));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function sendEmail(o: { to: string; subject: string; html: string; text: string; unsubscribe?: string }) {
  if (!emailConfigured) throw new Error("Email isn't configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      from: FROM,
      to: [o.to],
      subject: o.subject,
      html: o.html,
      text: o.text,
      ...(o.unsubscribe ? { headers: { "List-Unsubscribe": `<${o.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

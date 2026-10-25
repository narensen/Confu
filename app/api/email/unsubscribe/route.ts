import { verifyUnsubscribe } from "@/lib/notify/email";
import { SITE } from "@/lib/site";
import { adminClient } from "@/lib/supabase/admin";

// One-click unsubscribe from the links in Confu's emails (and the
// List-Unsubscribe header). Signed per person and per kind of email.
async function unsubscribe(request: Request) {
  const q = new URL(request.url).searchParams;
  const user = q.get("u") ?? "";
  const kind = q.get("k") ?? "";
  const ok = /^[0-9a-f-]{36}$/.test(user) && verifyUnsubscribe(user, kind, q.get("t") ?? "");
  const admin = adminClient();
  if (ok && admin) await admin.from("profiles").update(kind === "digest" ? { email_digest: false } : { email_reminders: false }).eq("id", user);
  const what = kind === "digest" ? "weekly summary emails" : "review reminder emails";
  const body = ok && admin ? `You won't get ${what} any more.` : "That unsubscribe link isn't valid. Change your email settings in Confu instead.";
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width"><title>Unsubscribe · Confu</title>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f6f3;color:#0d0d0c;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px">
<div style="max-width:420px;background:#fff;border:1px solid #0d0d0c;border-radius:14px;padding:28px">
<p style="font-family:Georgia,serif;font-size:22px;font-weight:600;margin:0 0 12px">Confu<span style="color:#eab308">.</span></p>
<p style="margin:0 0 16px;line-height:1.6">${body}</p>
<a href="${SITE.url}/settings#reminders" style="color:#0d0d0c;font-weight:600">Email settings →</a></div></body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export const GET = unsubscribe;
export const POST = unsubscribe;

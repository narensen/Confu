import { emailConfigured, sendEmail, unsubscribeUrl } from "@/lib/notify/email";
import { pushConfigured, sendPush, type PushTarget } from "@/lib/notify/push";
import { digestEmail, reminderEmail } from "@/lib/notify/templates";
import { logError } from "@/lib/log";
import { SITE } from "@/lib/site";
import { adminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

// Once a day (Vercel Cron, vercel.json): review reminders by email and push
// for people with reviews waiting; on Sundays, the weekly summary email.
// Vercel sends "Authorization: Bearer $CRON_SECRET".
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const admin = adminClient();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY isn't set" }, { status: 500 });

  const url = new URL(request.url);
  const result = { reminders: { emails: 0, pushes: 0, people: 0 }, digests: 0, errors: 0, email: emailConfigured, push: pushConfigured };

  // Review reminders
  const { data: due, error } = await admin.rpc("reminder_batch");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  for (const r of ((due ?? []) as { user_id: string; email: string; name: string | null; due: number; email_ok: boolean; push_ok: boolean }[]).slice(0, 400)) {
    let sent = false;
    if (r.email_ok && emailConfigured && r.email) {
      try {
        const unsubscribe = unsubscribeUrl(r.user_id, "reminder");
        await sendEmail({ to: r.email, unsubscribe, ...reminderEmail({ name: r.name, due: r.due, unsubscribe }) });
        result.reminders.emails++;
        sent = true;
        await pause(550); // Resend's rate limit
      } catch (err) {
        result.errors++;
        logError("reminder email failed", err);
      }
    }
    if (r.push_ok && pushConfigured) {
      const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", r.user_id);
      for (const s of (subs ?? []) as (PushTarget & { id: number })[]) {
        const status = await sendPush(s, { title: `${r.due} reviews are due`, body: "A few minutes now and it sticks. Tap to start.", url: `${SITE.url}/review` });
        if (status === "sent") {
          result.reminders.pushes++;
          sent = true;
        } else if (status === "gone") await admin.from("push_subscriptions").delete().eq("id", s.id);
      }
    }
    if (sent) {
      result.reminders.people++;
      await admin.from("notification_log").insert({ user_id: r.user_id, kind: "reminder" });
    }
  }

  // Weekly summary on Sundays (UTC), or on demand with ?digest=1.
  if (emailConfigured && (new Date().getUTCDay() === 0 || url.searchParams.get("digest") === "1")) {
    const { data: rows } = await admin.rpc("digest_batch");
    for (const d of ((rows ?? []) as {
      user_id: string;
      email: string;
      name: string | null;
      minutes: number;
      active_days: number;
      topics_done: number;
      reviews: number;
      due: number;
      sessions: { id: string; title: string }[];
    }[]).slice(0, 400)) {
      if (!d.email) continue;
      try {
        const unsubscribe = unsubscribeUrl(d.user_id, "digest");
        await sendEmail({
          to: d.email,
          unsubscribe,
          ...digestEmail({ name: d.name, minutes: d.minutes, activeDays: d.active_days, topicsDone: d.topics_done, reviews: d.reviews, due: d.due, sessions: d.sessions, unsubscribe }),
        });
        await admin.from("notification_log").insert({ user_id: d.user_id, kind: "digest" });
        result.digests++;
        await pause(550);
      } catch (err) {
        result.errors++;
        logError("digest email failed", err);
      }
    }
  }

  return Response.json(result);
}

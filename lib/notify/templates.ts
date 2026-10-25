import "server-only";
import { SITE } from "@/lib/site";

// Plain, branded emails that read well in any client (inline styles only).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const first = (name: string | null) => (name?.trim().split(/\s+/)[0] ? esc(name.trim().split(/\s+/)[0]) : "there");

function layout(body: string, unsubscribe: string, why: string) {
  return `<!doctype html><html><body style="margin:0;background:#f6f6f3;padding:24px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0d0d0c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #0d0d0c;border-radius:14px">
<tr><td style="padding:26px 28px 8px;font-family:Georgia,serif;font-size:22px;font-weight:600">Confu<span style="color:#eab308">.</span></td></tr>
<tr><td style="padding:8px 28px 26px;font-size:15px;line-height:1.6">${body}</td></tr>
</table>
<p style="max-width:520px;font-size:12px;line-height:1.5;color:#62625d;margin:16px auto 0">${why} <a href="${unsubscribe}" style="color:#62625d">Unsubscribe</a> · <a href="${SITE.url}/settings#reminders" style="color:#62625d">Email settings</a></p>
</td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;margin-top:14px;background:#0d0d0c;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:9px">${label}</a>`;

export function reminderEmail(o: { name: string | null; due: number; unsubscribe: string }) {
  const n = o.due;
  const subject = `${n} reviews are due: about ${Math.max(2, Math.round(n * 0.75))} minutes`;
  const html = layout(
    `<p style="margin:0 0 10px">Hi ${first(o.name)},</p>
<p style="margin:0">You have <b>${n} things to review</b>: topics you finished, passages you asked about and questions you missed. Recalling them now, just as they start to fade, is what makes them stick.</p>
${button(`${SITE.url}/review`, "Start review")}`,
    o.unsubscribe,
    "You get this when reviews have been waiting for a while.",
  );
  const text = `Hi ${o.name?.split(" ")[0] ?? "there"},\n\nYou have ${n} things to review. Start here: ${SITE.url}/review\n\nUnsubscribe: ${o.unsubscribe}`;
  return { subject, html, text };
}

export function digestEmail(o: {
  name: string | null;
  minutes: number;
  activeDays: number;
  topicsDone: number;
  reviews: number;
  due: number;
  sessions: { id: string; title: string }[];
  unsubscribe: string;
}) {
  const time = o.minutes >= 60 ? `${Math.floor(o.minutes / 60)}h ${o.minutes % 60}m` : `${o.minutes} min`;
  const stat = (v: string, l: string) =>
    `<td style="padding:10px 8px;border:1px solid #e4e3de;border-radius:10px;text-align:center"><div style="font-size:22px;font-weight:700">${v}</div><div style="font-size:12px;color:#62625d">${l}</div></td>`;
  const quiet = o.minutes === 0 && o.reviews === 0 && o.topicsDone === 0;
  const subject = quiet ? "Your week in Confu: pick up where you left off" : `Your week in Confu: ${time} studied, ${o.activeDays} ${o.activeDays === 1 ? "day" : "days"} active`;
  const sessions = o.sessions.length
    ? `<p style="margin:18px 0 6px;font-size:13px;color:#62625d">Pick up where you left off</p>${o.sessions
        .map((s) => `<a href="${SITE.url}/session/${s.id}" style="display:block;color:#0d0d0c;font-weight:600;padding:4px 0">${esc(s.title)} →</a>`)
        .join("")}`
    : "";
  const html = layout(
    `<p style="margin:0 0 12px">Hi ${first(o.name)}, here's your week.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>${stat(time, "studied")}${stat(String(o.activeDays), "active days")}${stat(String(o.topicsDone), "topics done")}${stat(String(o.reviews), "reviews")}</tr></table>
${o.due ? `<p style="margin:14px 0 0">${o.due} reviews are due by tomorrow.</p>${button(`${SITE.url}/review`, "Review now")}` : ""}
${sessions}`,
    o.unsubscribe,
    "Your weekly summary, sent on Sundays.",
  );
  const text = `Your week in Confu: ${time} studied, ${o.activeDays} active days, ${o.topicsDone} topics done, ${o.reviews} reviews. ${o.due ? `${o.due} reviews due: ${SITE.url}/review` : ""}\n\nUnsubscribe: ${o.unsubscribe}`;
  return { subject, html, text };
}

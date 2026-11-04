import "server-only";
import { SITE } from "@/lib/site";

// Branded emails that hold up in any client: tables and inline styles only,
// no images, a light colour scheme. The card's hard shadow is a dark table
// behind it, which works where box-shadow doesn't (Gmail, Outlook).

const INK = "#0d0d0c";
const MUTED = "#62625d";
const LINE = "#e4e3de";
const PAPER = "#f4f3ee";
const YELLOW = "#facc15";
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || "";
const hello = (name: string | null) => (firstName(name) ? esc(firstName(name)) : "there");
const duration = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);

function layout(o: { label: string; preheader: string; body: string; why: string; unsubscribe: string }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>Confu</title></head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER}">${esc(o.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:28px 14px 36px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 4px 14px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-family:${SERIF};font-size:22px;font-weight:700;color:${INK}"><a href="${SITE.url}" style="color:${INK};text-decoration:none">Confu<span style="color:#eab308">.</span></a></td>
        <td align="right" style="font-family:${MONO};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED}">${o.label}</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:${INK};border-radius:18px;padding:0 6px 6px 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${INK};border-radius:16px">
        <tr><td style="padding:32px 32px 30px;font-family:${SANS};font-size:15px;line-height:1.6;color:${INK}">${o.body}</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:18px 6px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED}">
      ${o.why}<br><a href="${o.unsubscribe}" style="color:${MUTED}">Unsubscribe</a> &nbsp;·&nbsp; <a href="${SITE.url}/settings#reminders" style="color:${MUTED}">Email settings</a> &nbsp;·&nbsp; <a href="${SITE.url}" style="color:${MUTED}">confu.lol</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const eyebrow = (text: string) =>
  `<p style="margin:0 0 8px;font-family:${MONO};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED}">${text}</p>`;
const headline = (text: string) => `<h1 style="margin:0;font-family:${SERIF};font-size:30px;line-height:1.2;font-weight:400;color:${INK}">${text}</h1>`;
const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px"><tr><td style="background:${YELLOW};border-radius:10px;padding:0 4px 4px 0"><a href="${href}" style="display:inline-block;background:${INK};color:#ffffff;font-family:${SANS};font-size:15px;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:9px;border:1px solid ${INK}">${label} &rarr;</a></td></tr></table>`;

/* ------------------------------------------------------------ reminder */

export function reminderEmail(o: { name: string | null; due: number; unsubscribe: string; paperOver?: boolean }) {
  const n = o.due;
  const minutes = Math.max(2, Math.round(n * 0.75));
  const over = "The paper is over. What you missed comes back today, in three days, and in seven.";
  const subject = `${n} reviews are waiting (about ${minutes} minutes)`;
  const html = layout({
    label: "Review",
    preheader: `About ${minutes} minutes. Recall them now, just as they start to fade.`,
    body: `${eyebrow(`Hi ${hello(o.name)}`)}
${headline(`${n} reviews are waiting.`)}
<p style="margin:14px 0 0">Topics you finished, passages you asked about and questions you missed. Recalling them now, just as they start to fade, is what makes them stick.</p>
${o.paperOver ? `<p style="margin:10px 0 0">${over}</p>` : ""}
<p style="margin:10px 0 0;color:${MUTED}">About ${minutes} minutes. You answer from memory, then check.</p>
${button(`${SITE.url}/review`, "Start review")}`,
    why: "You get this when reviews have been waiting a while, at most every few days.",
    unsubscribe: o.unsubscribe,
  });
  const text = `Hi ${firstName(o.name) || "there"},

${n} reviews are waiting: about ${minutes} minutes. Recalling them now, just as they start to fade, is what makes them stick.
${o.paperOver ? `\n${over}\n` : ""}
Start review: ${SITE.url}/review

Unsubscribe: ${o.unsubscribe}`;
  return { subject, html, text };
}

/* -------------------------------------------------------------- digest */

// Minutes per day as bars (one series, ink; only the best day is labelled).
function weekChart(days: { day: string; minutes: number }[]) {
  if (!days.length) return "";
  const H = 72;
  const max = Math.max(...days.map((d) => d.minutes));
  const best = max > 0 ? days.findIndex((d) => d.minutes === max) : -1;
  const letter = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return "SMTWTFS"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  };
  const bars = days
    .map((d, i) => {
      const h = d.minutes > 0 && max > 0 ? Math.max(6, Math.round((d.minutes / max) * H)) : 3;
      const label = i === best ? `<div style="font-family:${MONO};font-size:11px;color:${INK};padding-bottom:4px">${duration(d.minutes)}</div>` : "";
      return `<td valign="bottom" align="center" style="padding:0 3px;height:${H + 22}px">${label}<div style="width:26px;height:${h}px;background:${d.minutes > 0 ? INK : LINE};border-radius:4px 4px 1px 1px;font-size:0;line-height:0">&nbsp;</div></td>`;
    })
    .join("");
  const labels = days
    .map((d, i) => `<td align="center" style="padding:6px 3px 0;font-family:${MONO};font-size:11px;color:${i === days.length - 1 ? INK : MUTED}">${letter(d.day)}</td>`)
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px" aria-label="Minutes studied each day this week"><tr>${bars}</tr><tr>${labels}</tr></table>`;
}

const stat = (value: string, label: string, first = false) =>
  `<td width="33%" style="padding:12px 0 2px ${first ? "0" : "16px"};${first ? "" : `border-left:1px solid ${LINE};`}vertical-align:top"><div style="font-family:${SERIF};font-size:26px;line-height:1.1;color:${INK}">${value}</div><div style="font-size:12px;color:${MUTED};padding-top:3px">${label}</div></td>`;

export function digestEmail(o: {
  name: string | null;
  minutes: number;
  activeDays: number;
  topicsDone: number;
  reviews: number;
  due: number;
  sessions: { id: string; title: string }[];
  days: { day: string; minutes: number }[];
  alerts?: { title: string; url: string | null; authors: string[]; year: number | null }[]; // new papers citing theirs
  unsubscribe: string;
}) {
  const quiet = o.minutes === 0 && o.reviews === 0 && o.topicsDone === 0 && o.activeDays === 0;
  const name = firstName(o.name);
  const top = o.sessions[0];
  const range = (() => {
    if (o.days.length < 2) return "Your week";
    const fmt = (iso: string) => {
      const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    };
    return `${fmt(o.days[0].day)} – ${fmt(o.days[o.days.length - 1].day)}`;
  })();

  const subject = quiet
    ? `${name ? `${name}, ` : ""}ten minutes today keeps it going`
    : `Your week: ${duration(o.minutes)} studied, ${o.activeDays} ${o.activeDays === 1 ? "day" : "days"} active`;

  const summary = quiet
    ? `${headline(`A quiet week${name ? `, ${esc(name)}` : ""}.`)}
<p style="margin:14px 0 0">Nothing logged this week, and that's fine. Ten minutes today is enough to pick the thread back up${top ? ` in <b>${esc(top.title)}</b>` : ""}.</p>
${top ? button(`${SITE.url}/session/${top.id}`, "Continue") : button(`${SITE.url}/dashboard`, "Open Confu")}`
    : `${headline(`Your week${name ? `, ${esc(name)}` : ""}.`)}
<p style="margin:18px 0 0;font-family:${SERIF};font-size:44px;line-height:1;color:${INK}">${duration(o.minutes)}</p>
<p style="margin:6px 0 0;font-size:13px;color:${MUTED}">studied this week</p>
${weekChart(o.days)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid ${LINE}"><tr>
${stat(`${o.activeDays}<span style="font-size:15px;color:${MUTED}">/7</span>`, "days active", true)}${stat(String(o.topicsDone), o.topicsDone === 1 ? "topic done" : "topics done")}${stat(String(o.reviews), o.reviews === 1 ? "review" : "reviews")}
</tr></table>`;

  const due = o.due
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;background:#fef9c3;border:1px solid ${INK};border-radius:12px"><tr><td style="padding:18px 20px">
<p style="margin:0;font-weight:600">${o.due} ${o.due === 1 ? "review is" : "reviews are"} due by tomorrow</p>
<p style="margin:4px 0 0;font-size:14px;color:#3f3f3b">About ${Math.max(2, Math.round(o.due * 0.75))} minutes. Recall them before they fade.</p>
${button(`${SITE.url}/review`, "Review now")}
</td></tr></table>`
    : "";

  const sessions =
    !quiet && o.sessions.length
      ? `<p style="margin:26px 0 4px;font-family:${MONO};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED}">Pick up where you left off</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${o.sessions
          .map(
            (s) =>
              `<tr><td style="border-top:1px solid ${LINE};padding:11px 0"><a href="${SITE.url}/session/${s.id}" style="color:${INK};text-decoration:none;font-weight:600">${esc(s.title)}</a></td><td align="right" style="border-top:1px solid ${LINE};padding:11px 0;width:24px"><a href="${SITE.url}/session/${s.id}" style="color:${INK};text-decoration:none">&rarr;</a></td></tr>`,
          )
          .join("")}</table>`
      : "";

  const alerts = o.alerts?.length
    ? `<p style="margin:26px 0 4px;font-family:${MONO};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED}">New papers citing what you read</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${o.alerts
        .map(
          (a) =>
            `<tr><td style="border-top:1px solid ${LINE};padding:11px 0">${a.url ? `<a href="${esc(a.url)}" style="color:${INK};text-decoration:none;font-weight:600">${esc(a.title)}</a>` : `<span style="font-weight:600">${esc(a.title)}</span>`}<div style="font-size:12px;color:${MUTED};padding-top:2px">${esc([a.authors.join(", "), a.year].filter(Boolean).join(" · "))}</div></td></tr>`,
        )
        .join("")}</table>`
    : "";

  // In a month's first week: last month's Wrapped is ready.
  const today = new Date();
  const lastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const wrapped =
    today.getUTCDate() <= 7
      ? `<p style="margin:24px 0 0;font-size:14px"><a href="${SITE.url}/wrapped?m=${lastMonth.toISOString().slice(0, 7)}" style="color:${INK};font-weight:600">Your ${lastMonth.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} in Confu is ready &rarr;</a></p>`
      : "";

  const html = layout({
    label: "Weekly summary",
    preheader: quiet ? "Ten minutes today is enough to get going again." : `${duration(o.minutes)} studied, ${o.activeDays} of 7 days active.`,
    body: `${eyebrow(range)}${summary}${due}${sessions}${alerts}${wrapped}`,
    why: "Your weekly summary from Confu, sent once a week.",
    unsubscribe: o.unsubscribe,
  });

  const text = [
    quiet ? `A quiet week${name ? `, ${name}` : ""}. Ten minutes today is enough to pick the thread back up.` : `Your week${name ? `, ${name}` : ""}: ${duration(o.minutes)} studied, ${o.activeDays} of 7 days active, ${o.topicsDone} topics done, ${o.reviews} reviews.`,
    o.due ? `${o.due} reviews are due by tomorrow: ${SITE.url}/review` : "",
    top ? `Continue ${top.title}: ${SITE.url}/session/${top.id}` : "",
    o.alerts?.length ? `New papers citing what you read:\n${o.alerts.map((a) => `- ${a.title}${a.url ? ` ${a.url}` : ""}`).join("\n")}` : "",
    `Unsubscribe: ${o.unsubscribe}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, html, text };
}

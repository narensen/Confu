import { createClient } from "@supabase/supabase-js";
import { SITE } from "@/lib/site";

// A private calendar feed of the student's study plans (open topics on their
// due dates), for Google Calendar, Apple Calendar or Outlook to subscribe to.
// The token in the URL is the only key; it can be reset in Settings.

type Row = { topic_id: string; title: string; due_date: string; est_minutes: number; page_start: number | null; page_end: number | null; session_id: string; session_title: string; status: string; document_id?: string | null };

// Opens the session on the topic's page, with the tutor folded for that visit.
function sessionLink(r: Row) {
  const q = new URLSearchParams({ tutor: "closed" });
  if (r.page_start && r.page_start >= 1) q.set("page", String(r.page_start));
  if (r.document_id) q.set("doc", r.document_id);
  return `${SITE.url}/session/${r.session_id}?${q}`;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// Lines over 75 bytes are folded, as the format requires.
function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 74) {
      out.push(cur);
      cur = " " + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}
const day = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const nextDay = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};

// Study blocks: a local time in the student's time zone, as UTC.
function tzOffset(at: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - at;
}
function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - tzOffset(guess, tz);
  return guess - tzOffset(first, tz); // right on either side of a clock change
}
const utcStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const BLOCK_DAYS = 28;

export async function GET(_req: Request, ctx: RouteContext<"/api/calendar/[token]">) {
  const token = (await ctx.params).token.replace(/\.ics$/, "");
  if (!/^[0-9a-f]{32}$/.test(token)) return new Response("Not found", { status: 404 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const [{ data, error }, blocks] = await Promise.all([supabase.rpc("calendar_feed", { p_token: token }), supabase.rpc("calendar_blocks", { p_token: token })]);
  if (error) return new Response("Calendar unavailable", { status: 503 });

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Confu//Study plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Confu study plan",
    "X-WR-CALDESC:Your study plan topics from Confu",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const r of (data ?? []) as Row[]) {
    const done = r.status === "completed";
    const pages = r.page_start ? (r.page_start === r.page_end ? `p. ${r.page_start}` : `pp. ${r.page_start}–${r.page_end}`) : "";
    const link = sessionLink(r);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.topic_id}@confu`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(r.due_date)}`,
      `DTEND;VALUE=DATE:${nextDay(r.due_date)}`,
      fold(`SUMMARY:${esc(`${done ? "✓ " : ""}Study: ${r.title} (~${r.est_minutes} min)`)}`),
      fold(`DESCRIPTION:${esc(`${r.session_title}${pages ? ` · ${pages}` : ""}\nOpen in Confu: ${link}`)}`),
      fold(`URL:${link}`),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  // Daily study blocks (migration 0025), named after the topic that's next.
  const pref = ((blocks.data ?? []) as { timezone: string | null; study_time: string | null; study_minutes: number | null; study_days: number[] | null }[])[0];
  if (pref?.study_time && pref.study_days?.length) {
    let tz = pref.timezone || "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      tz = "UTC";
    }
    const [hh, mm] = pref.study_time.split(":").map(Number);
    const minutes = pref.study_minutes ?? 45;
    const open = ((data ?? []) as Row[]).filter((r) => r.status !== "completed").sort((a, b) => a.due_date.localeCompare(b.due_date));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const [y0, m0, d0] = today.split("-").map(Number);
    for (let i = 0; i < BLOCK_DAYS; i++) {
      const date = new Date(Date.UTC(y0, m0 - 1, d0 + i));
      if (!pref.study_days.includes(date.getUTCDay())) continue;
      const iso = date.toISOString().slice(0, 10);
      const topic = open.find((r) => r.due_date >= iso) ?? open[open.length - 1];
      const start = zonedToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hh, mm, tz);
      const link = topic ? sessionLink(topic) : `${SITE.url}/dashboard`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:block-${iso.replace(/-/g, "")}@confu`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${utcStamp(start)}`,
        `DTEND:${utcStamp(start + minutes * 60_000)}`,
        fold(`SUMMARY:${esc(topic ? `Study: ${topic.title}` : "Study time")}`),
        fold(`DESCRIPTION:${esc(`${topic ? `${topic.session_title}\n` : ""}Your study time from Confu. Open: ${link}`)}`),
        fold(`URL:${link}`),
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:Study time",
        "TRIGGER:-PT10M",
        "END:VALARM",
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="confu-study-plan.ics"', "Cache-Control": "public, max-age=900" },
  });
}

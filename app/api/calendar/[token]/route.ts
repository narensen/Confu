import { createClient } from "@supabase/supabase-js";
import { SITE } from "@/lib/site";

// A private calendar feed of the student's study plans (open topics on their
// due dates), for Google Calendar, Apple Calendar or Outlook to subscribe to.
// The token in the URL is the only key; it can be reset in Settings.

type Row = { topic_id: string; title: string; due_date: string; est_minutes: number; page_start: number | null; page_end: number | null; session_id: string; session_title: string; status: string };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
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

export async function GET(_req: Request, ctx: RouteContext<"/api/calendar/[token]">) {
  const token = (await ctx.params).token.replace(/\.ics$/, "");
  if (!/^[0-9a-f]{32}$/.test(token)) return new Response("Not found", { status: 404 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("calendar_feed", { p_token: token });
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
    const link = `${SITE.url}/session/${r.session_id}`;
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
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="confu-study-plan.ics"', "Cache-Control": "public, max-age=900" },
  });
}

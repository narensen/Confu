import { createClient as createAnon } from "@supabase/supabase-js";
import { SITE } from "@/lib/site";

type Hour = {
  token: string;
  topic: string;
  place: string;
  starts_at: string;
  ends_at: string;
  course_code: string | null;
  pack_slug: string | null;
  room_slug: string | null;
};

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

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

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

// One event. No attendance, no RSVP. The token is the secret.
export async function GET(_req: Request, ctx: RouteContext<"/api/library-hour/[token]">) {
  const token = (await ctx.params).token.replace(/\.ics$/, "");
  if (!/^[0-9a-f]{32}$/.test(token)) return new Response("Not found", { status: 404 });
  const anon = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.rpc("get_library_hour", { p_token: token });
  const hour = ((data ?? []) as Hour[])[0];
  if (error || !hour) return new Response("Not found", { status: 404 });

  const where = hour.course_code ? `${SITE.url}/c/${hour.course_code}` : `${SITE.url}/api/library-hour/${hour.token}`;
  const description = [hour.place, hour.topic, where, hour.room_slug ? `Room ${hour.room_slug}` : ""].filter(Boolean).map(esc).join("\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Confu//Library hour//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${esc(`Confu · ${hour.topic}`)}`),
    "BEGIN:VEVENT",
    `UID:${hour.token}@confu`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(hour.starts_at)}`,
    `DTEND:${stamp(hour.ends_at)}`,
    fold(`SUMMARY:${esc(hour.topic)}`),
    fold(`LOCATION:${esc(hour.place)}`),
    fold(`DESCRIPTION:${description}`),
    fold(`URL:${esc(where)}`),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="library-hour.ics"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}

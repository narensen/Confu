import { CHANGELOG } from "@/lib/changelog";
import { SITE } from "@/lib/site";

// What's new, as RSS 2.0.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function GET() {
  const items = CHANGELOG.map((r, i) => {
    const html = `<p>${esc(r.summary)}</p><ul>${r.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    return `<item>
  <title>${esc(r.title)}</title>
  <link>${SITE.url}/changelog</link>
  <guid isPermaLink="false">confu-${r.date}-${CHANGELOG.length - i}</guid>
  <pubDate>${new Date(`${r.date}T12:00:00Z`).toUTCString()}</pubDate>
  <description>${esc(html)}</description>
</item>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Confu: what's new</title>
  <link>${SITE.url}/changelog</link>
  <description>New in Confu, the AI tutor that works from your own material.</description>
  <language>en</language>
${items}
</channel>
</rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

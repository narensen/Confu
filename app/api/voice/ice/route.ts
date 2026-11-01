import { createHmac } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

// ICE servers for voice. STUN alone can't get through many school, office and
// mobile networks; a TURN relay can. Credentials are made per request and
// expire, so nothing long-lived reaches the browser. Configure one of:
//
//   Cloudflare TURN   CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN
//   coturn (REST)     TURN_URLS + TURN_SECRET   (use-auth-secret / static-auth-secret)
//   static            TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL
//
// With none, voice uses public STUN only (works on most home networks).
const STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
const TTL = 6 * 3600;

type Ice = { urls: string | string[]; username?: string; credential?: string };

// Browsers block port 53, so a TURN URL on it only times out.
function usable(servers: Ice[]): Ice[] {
  return servers
    .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => s.urls.length > 0);
}

async function cloudflare(keyId: string, token: string): Promise<Ice[] | null> {
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: TTL }),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { iceServers?: Ice | Ice[] };
  const servers = Array.isArray(json.iceServers) ? json.iceServers : json.iceServers ? [json.iceServers] : [];
  return servers.length ? servers : null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });

  const headers = { "Cache-Control": "no-store" };
  const { CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN, TURN_URLS, TURN_SECRET, TURN_USERNAME, TURN_CREDENTIAL } = process.env;
  const urls = (TURN_URLS ?? "").split(/[\s,]+/).filter(Boolean);

  try {
    if (CLOUDFLARE_TURN_KEY_ID && CLOUDFLARE_TURN_API_TOKEN) {
      const servers = await cloudflare(CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN);
      if (servers) return Response.json({ iceServers: usable(servers), relay: true }, { headers });
    }
    if (urls.length && TURN_SECRET) {
      // coturn's REST scheme: the username is when it expires; the password is its HMAC.
      const username = `${Math.floor(Date.now() / 1000) + TTL}:${userId}`;
      const credential = createHmac("sha1", TURN_SECRET).update(username).digest("base64");
      return Response.json({ iceServers: usable([...STUN, { urls, username, credential }]), relay: true }, { headers });
    }
    if (urls.length && TURN_USERNAME && TURN_CREDENTIAL) {
      return Response.json({ iceServers: usable([...STUN, { urls, username: TURN_USERNAME, credential: TURN_CREDENTIAL }]), relay: true }, { headers });
    }
  } catch {}
  return Response.json({ iceServers: STUN, relay: false }, { headers });
}

import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { isPrivateAddress } from "@confu/ai/net";

// Fetch a URL a user gave us without letting it reach our own infrastructure
// (SSRF): only http(s) on standard ports, every hostname (and every redirect)
// must resolve to public addresses, with a timeout and a size cap.
// Remaining gap: DNS could change between our check and the connection
// (rebinding); the window is small and we never send credentials.

// blocked: the site turned us away (a login, or a bot check). The student
// can still bring the page in by pasting it from their own browser.
export class ImportError extends Error {
  constructor(
    message: string,
    readonly blocked = false,
  ) {
    super(message);
  }
}

const BLOCKED = "That site only lets people in through a browser (it blocks automated reading or needs a login), so Confu can't fetch it.";

// Bot checks that answer with a normal-looking page: Anubis, Cloudflare,
// DDoS-Guard, Vercel. We don't try to get past them; they're the site's call.
export function isBotCheck(html: string) {
  return (
    html.length < 400_000 &&
    /id="anubis_challenge"|\/\.within\.website\/x\/cmd\/anubis|Making sure you(?:&#39;|'|’)re not a bot|cf-chl-|challenge-platform\/h\/|<title>Just a moment\.\.\.<\/title>|Checking your browser before accessing|ddos-guard|Vercel Security Checkpoint/i.test(html)
  );
}
export const botCheckError = () => new ImportError(BLOCKED, true);

export { isPrivateAddress };

export const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Confu/1.0 (+https://confu.lol)";

export async function safeFetch(
  rawUrl: string,
  { accept = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", maxBytes = 5_000_000, timeoutMs = 15_000 } = {},
): Promise<{ url: string; contentType: string; body: Uint8Array }> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new ImportError("That doesn't look like a link. Paste the full address, starting with https://");
  }
  for (let hop = 0; hop < 6; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new ImportError("Only http and https links can be imported.");
    if (url.username || url.password) throw new ImportError("Links with a username or password can't be imported.");
    if (url.port && url.port !== "80" && url.port !== "443") throw new ImportError("That link uses an unusual port, so it can't be imported.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const hostName = host.toLowerCase().replace(/\.$/, "");
    if (hostName === "ncert.nic.in" || hostName.endsWith(".ncert.nic.in")) {
      throw new ImportError("Confu doesn't fetch NCERT textbooks. If you already have the file, upload it.");
    }
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new ImportError("That address isn't reachable from Confu.");
    const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (!addrs.length) throw new ImportError("Couldn't find that website. Check the link.");
    if (addrs.some((a) => isPrivateAddress(a.address))) throw new ImportError("That address isn't reachable from Confu.");

    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": BROWSER_UA, Accept: accept, "Accept-Language": "en;q=0.9,*;q=0.5" },
      });
    } catch {
      throw new ImportError("That website didn't respond in time. Try again, or try another page.");
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const next = res.headers.get("location");
      if (!next) throw new ImportError("That link redirects nowhere.");
      url = new URL(next, url);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw botCheckError();
    // Cloudflare and DDoS-Guard challenges also come back as 429/503.
    if ((res.status === 429 || res.status === 503) && (res.headers.has("cf-mitigated") || /cloudflare|ddos-guard/i.test(res.headers.get("server") ?? ""))) throw botCheckError();
    if (res.status === 404) throw new ImportError("That page wasn't found (404). Check the link.");
    if (!res.ok || !res.body) throw new ImportError(`That website answered with an error (${res.status}).`);

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new ImportError("That file is too large to import.");
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ImportError("That page is too large to import.");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      body.set(c, offset);
      offset += c.byteLength;
    }
    return { url: url.toString(), contentType: res.headers.get("content-type") ?? "", body };
  }
  throw new ImportError("That link redirects too many times.");
}

export function decodeHtml(body: Uint8Array, contentType: string) {
  const declared = /charset=([\w-]+)/i.exec(contentType)?.[1];
  const sniff = /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder("latin1").decode(body.slice(0, 2048)))?.[1];
  try {
    return new TextDecoder(declared ?? sniff ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

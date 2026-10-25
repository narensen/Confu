import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";

// Fetch a URL a user gave us without letting it reach our own infrastructure
// (SSRF): only http(s) on standard ports, every hostname (and every redirect)
// must resolve to public addresses, with a timeout and a size cap.
// Remaining gap: DNS could change between our check and the connection
// (rebinding); the window is small and we never send credentials.

export class ImportError extends Error {}

const PRIVATE_V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const v4 = (ip: string) => ip.split(".").reduce((a, b) => ((a << 8) + Number(b)) >>> 0, 0);

export function isPrivateAddress(addr: string): boolean {
  if (net.isIPv4(addr)) {
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (v4(addr) & mask) === (v4(base) & mask);
    });
  }
  const a = addr.toLowerCase();
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return a === "::" || a === "::1" || /^(fe[89ab]|fc|fd|ff)/.test(a) || a.startsWith("64:ff9b:") || a.startsWith("2001:db8:");
}

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
    if (res.status === 401 || res.status === 403) throw new ImportError("That page needs a login, or blocks automated reading. Try saving it as a PDF and uploading that.");
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

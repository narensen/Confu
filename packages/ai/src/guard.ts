import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { isPrivateAddress } from "./net";

// The server's check on a custom model server's address. Confu's server
// fetches it for a student, so it must not be made to reach private networks
// (server-side request forgery). Passed to the transport as its guard.

// Self-hosters can point Confu at a model server on their own network
// (Ollama, LM Studio). On a shared server that would let anyone make it
// fetch internal addresses, so it's off unless the operator turns it on.
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_AI_URLS === "1";

export class BaseUrlError extends Error {}

// A custom provider's address, checked: http(s), no credentials, and (unless
// private addresses are allowed) https on a host that resolves to public IPs.
export async function checkBaseUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BaseUrlError("That doesn't look like an address. It should start with https:// and usually end in /v1.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BaseUrlError("The address must start with https://");
  if (url.username || url.password) throw new BaseUrlError("Put the key in the key field, not in the address.");
  if (url.search || url.hash) throw new BaseUrlError("Leave out the ?… and #… parts of the address.");
  if (!ALLOW_PRIVATE) {
    if (url.protocol !== "https:") throw new BaseUrlError("The address must use https://");
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new BaseUrlError(PRIVATE_NOTE);
    const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (!addrs.length) throw new BaseUrlError("Couldn't find that server. Check the address.");
    if (addrs.some((a) => isPrivateAddress(a.address))) throw new BaseUrlError(PRIVATE_NOTE);
  }
  return url.toString().replace(/\/+$/, "");
}

const PRIVATE_NOTE =
  "That address is on a private network, which this Confu server doesn't reach. If you run Confu yourself, set ALLOW_PRIVATE_AI_URLS=1 to use a local model server.";


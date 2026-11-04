import net from "node:net";

// Whether an IP address is private, loopback, link-local, reserved or
// otherwise not on the public internet. Every place Confu fetches a URL a
// user gave it checks this first (server-side request forgery).

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

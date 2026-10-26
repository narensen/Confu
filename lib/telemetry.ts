// First-party usage analytics and error reports, stored in Confu's own
// database (migration 0018). No third-party trackers, no cookies: signed-out
// visitors get a random id in localStorage, and Do Not Track turns usage
// events off (error reports still go through, without personal data).
//
//   track("reader.search", { results: 12 })
//   reportClientError(error)

type Props = Record<string, string | number | boolean | null>;
type Event = { name: string; path: string; props?: Props };

const ENDPOINT = "/api/telemetry";
const queue: Event[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let anon: string | null = null;

// /session/2b0c…-…/x → /session/:id, so pages group together. Private links
// (shared Wrapped pages, private rooms, unlisted packs, invites) are masked too.
export function routeOf(pathname: string) {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/^\/w\/[^/]+/, "/w/:token")
    .replace(/^\/rooms\/r-[^/]+/, "/rooms/:room")
    .replace(/^\/p\/[^/]+/, "/p/:pack")
    .replace(/^\/r\/[^/]+/, "/r/:code")
    .slice(0, 300);
}

function anonId() {
  if (anon) return anon;
  try {
    anon = localStorage.getItem("confu:anon");
    if (!anon) {
      anon = crypto.randomUUID().replace(/-/g, "");
      localStorage.setItem("confu:anon", anon);
    }
  } catch {
    anon ??= Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  return anon;
}

function doNotTrack() {
  if (typeof navigator === "undefined") return false;
  const n = navigator as { doNotTrack?: string | null; globalPrivacyControl?: boolean };
  return n.doNotTrack === "1" || n.globalPrivacyControl === true;
}

function send(body: object, beacon: boolean) {
  const json = JSON.stringify(body);
  try {
    if (beacon && navigator.sendBeacon?.(ENDPOINT, new Blob([json], { type: "application/json" }))) return;
    void fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: json, keepalive: true }).catch(() => {});
  } catch {}
}

export function flush(beacon = false) {
  if (timer) clearTimeout(timer);
  timer = null;
  while (queue.length) send({ events: queue.splice(0, 50), anon: anonId() }, beacon);
}

export function track(name: string, props?: Props) {
  if (typeof window === "undefined" || doNotTrack()) return;
  queue.push({ name, path: routeOf(location.pathname), ...(props ? { props } : {}) });
  if (queue.length >= 20) flush();
  else timer ??= setTimeout(() => flush(), 4000);
}

// Browser noise that isn't Confu's fault: extensions, aborted requests, a
// harmless ResizeObserver warning, and opaque cross-origin "Script error."
const IGNORE = /ResizeObserver loop|^Script error\.?$|AbortError|The user aborted|Load failed|Failed to fetch|NetworkError/i;

let reported = 0;
export function reportClientError(err: unknown, extra?: { digest?: string }) {
  if (typeof window === "undefined" || reported >= 20) return; // a broken page shouldn't flood us
  const e = err as { message?: string; stack?: string; name?: string } | null;
  const message = `${e?.name && e.name !== "Error" ? `${e.name}: ` : ""}${e?.message ?? String(err)}`;
  if (IGNORE.test(message) || /(chrome|moz|safari)-extension:/.test(e?.stack ?? "")) return;
  reported++;
  send(
    {
      error: {
        message: message.slice(0, 1000),
        stack: e?.stack?.slice(0, 4000),
        path: routeOf(location.pathname),
        digest: extra?.digest,
      },
      anon: anonId(),
    },
    false,
  );
}

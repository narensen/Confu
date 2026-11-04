// Pure helpers for the friends page. No network, so they can be checked on their own.

export function formatFriendCode(code: string) {
  const clean = code.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (clean.length !== 8) return code.trim();
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

// What the add box is asking for. Null when it's empty or too long to be real.
export function classifyFriendQuery(raw: string): { kind: "email" | "code"; value: string } | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (trimmed.includes("@")) return { kind: "email", value: trimmed.toLowerCase() };
  const code = trimmed.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (code.length < 6) return null;
  return { kind: "code", value: code };
}

const SLUG = /^[A-Za-z0-9_-]{1,80}$/;

export function safeRoomSlug(value: unknown): string | null {
  return typeof value === "string" && SLUG.test(value) ? value : null;
}

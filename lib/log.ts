// Server error logging that can't leak secrets: only the error's name, status
// and message are written (never request objects or headers), and anything
// shaped like an API key or bearer token is masked.
const SECRET = /\b(gsk_|sk-|sb_secret_)[A-Za-z0-9_-]{6,}|Bearer\s+[A-Za-z0-9._-]+/g;

export function logError(label: string, err: unknown) {
  const e = err as { name?: string; status?: number; message?: string } | null;
  const parts = [e?.name, e?.status, e?.message ?? String(err)].filter((p) => p !== undefined && p !== "");
  console.error(`${label}: ${parts.join(" · ")}`.replace(SECRET, "[redacted]").slice(0, 1000));
}

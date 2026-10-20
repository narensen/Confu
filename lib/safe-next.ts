// Where to send someone after signing in: only same-site paths, never back to /welcome.
export function safeNext(raw: unknown) {
  const next = typeof raw === "string" ? raw : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/welcome") ? next : "/dashboard";
}

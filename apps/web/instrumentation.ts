import type { Instrumentation } from "next";
import { reportServerError } from "./lib/log";

// Uncaught server errors (pages, route handlers, server actions, proxy) go to
// Confu's own error log, shown in the admin dashboard. The route *pattern*
// (e.g. /session/[id]) is stored, never the URL, so no ids or query strings.
export const onRequestError: Instrumentation.onRequestError = async (err, _request, context) => {
  const e = err as { message?: string; name?: string; stack?: string; digest?: string } | null;
  const message = `${e?.name && e.name !== "Error" ? `${e.name}: ` : ""}${e?.message ?? String(err)}`;
  await reportServerError(`[${context.routeType}] ${message}`, {
    path: context.routePath,
    digest: e?.digest,
    stack: e?.stack,
  });
};

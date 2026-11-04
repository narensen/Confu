"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { useEffect } from "react";
import { flush, reportClientError, track } from "@/lib/telemetry";

type Metric = Parameters<Parameters<typeof useReportWebVitals>[0]>[0];

// A slow interaction's element, as tag + a couple of class names (never its
// text), so the dashboard can point at e.g. a slow Delete button.
function describe(el: Element | null | undefined) {
  if (!el) return null;
  const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter((c) => c && !c.includes(":")).slice(0, 3) : [];
  return [el.tagName.toLowerCase(), ...cls].join(".").slice(0, 80);
}

// Stable reference: the hook re-reports everything if the callback changes.
const onVital = (m: Metric) => {
  if (!["LCP", "INP", "CLS", "FCP", "TTFB"].includes(m.name)) return;
  const entry = m.entries?.[0] as (PerformanceEntry & { target?: Element | null }) | undefined;
  track(`vitals.${m.name.toLowerCase()}`, {
    value: m.name === "CLS" ? Math.round(m.value * 1000) / 1000 : Math.round(m.value),
    rating: m.rating,
    ...(m.name === "INP" ? { target: describe(entry?.target) } : {}),
  });
};

// Page views, page speed and uncaught browser errors (mounted once, in the root layout).
export function Telemetry() {
  const pathname = usePathname();
  useReportWebVitals(onVital);

  useEffect(() => {
    track("page.view");
  }, [pathname]);

  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError(e.error ?? new Error(e.message));
    const onRejection = (e: PromiseRejectionEvent) => reportClientError(e.reason);
    const onHide = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  return null;
}

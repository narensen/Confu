"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

// Browser only: it needs the device's storage and workers, and pdf.js
// touches `window` as soon as it loads.
const LocalApp = dynamic(() => import("@confu/app/LocalApp").then((m) => m.LocalApp), {
  ssr: false,
  loading: () => (
    <p className="flex flex-1 items-center justify-center py-24 font-mono text-xs text-muted" role="status">
      Opening your library…
    </p>
  ),
});

// The open session is ?s=<id>. pushState keeps it one page (the database
// stays open) while Back and Forward still work.
export function LocalRoute() {
  const sessionId = useSearchParams().get("s");
  useKeepOffline();
  return <LocalApp sessionId={sessionId} navigate={(id) => window.history.pushState(null, "", id ? `/app?s=${encodeURIComponent(id)}` : "/app")} homeHref="/" />;
}

// The service worker (public/sw.js, registered by AppShell) keeps build files
// as they load. On a first visit the page loaded before the worker was
// running, so tell it which files those were.
function useKeepOffline() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let live = true;
    navigator.serviceWorker.ready.then((reg) => {
      if (!live) return;
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => new URL(u).pathname.startsWith("/_next/static/"));
      reg.active?.postMessage({ type: "keep-offline", urls });
    });
    return () => {
      live = false;
    };
  }, []);
}

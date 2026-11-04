"use client";

import { useEffect } from "react";
import { captureInstallPrompt } from "@/lib/pwa/install";

// Registers the service worker (installable app, notifications) and keeps
// the browser's install prompt for later.
export function AppShell() {
  useEffect(() => {
    captureInstallPrompt();
    if ("serviceWorker" in navigator) {
      const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }
  }, []);
  return null;
}

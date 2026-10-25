"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// Time spent per page, for "Where it got hard" (page_time, migration 0019).
// Counts 5-second ticks on the page being read, only while the tab is visible
// and the student has moved, scrolled or typed in the last 90 seconds. Sent
// every 30 seconds and when the tab is hidden or the PDF closes.
export function useReadingTime(documentId: string | undefined, page: number) {
  const pending = useRef(new Map<number, { seconds: number; visits: number }>());
  const lastActive = useRef(0);
  const pageRef = useRef(page);

  useEffect(() => {
    pageRef.current = page;
    if (!documentId) return;
    const p = pending.current.get(page) ?? { seconds: 0, visits: 0 };
    p.visits += 1;
    pending.current.set(page, p);
  }, [page, documentId]);

  useEffect(() => {
    if (!documentId) return;
    const supabase = createClient();
    lastActive.current = Date.now();
    const active = () => (lastActive.current = Date.now());
    const events = ["mousemove", "keydown", "wheel", "scroll", "pointerdown", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, active, { passive: true, capture: true });

    const tick = window.setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - lastActive.current > 90_000) return;
      const p = pending.current.get(pageRef.current) ?? { seconds: 0, visits: 0 };
      p.seconds += 5;
      pending.current.set(pageRef.current, p);
    }, 5000);

    const flush = () => {
      if (!pending.current.size) return;
      const pages = [...pending.current].map(([n, v]) => ({ page: n, seconds: v.seconds, visits: v.visits })).filter((p) => p.seconds || p.visits);
      pending.current.clear();
      if (pages.length) void supabase.rpc("add_page_time", { p_document: documentId, p_pages: pages, p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    };
    const every = window.setInterval(flush, 30_000);
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      for (const e of events) window.removeEventListener(e, active, { capture: true });
      window.clearInterval(tick);
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [documentId]);
}

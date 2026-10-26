"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// Back from Lemon Squeezy's checkout: the payment is done, and Pro switches on
// as soon as its webhook arrives (usually a few seconds). Checks a few times.
export function BillingNotice() {
  const params = useSearchParams();
  const router = useRouter();
  const [visible, setVisible] = useState(params.get("billing") === "success");

  useEffect(() => {
    if (!visible) return;
    const timers = [3000, 8000, 15000].map((ms) => window.setTimeout(() => router.refresh(), ms));
    window.history.replaceState(null, "", `${window.location.pathname}#plan`);
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [visible, router]);

  if (!visible) return null;
  return (
    <div role="status" className="animate-pop flex items-start justify-between gap-3 border-b border-ink bg-yellow-100 px-5 py-4 sm:px-6">
      <p className="text-sm leading-relaxed">
        <span className="font-medium">Thank you, and welcome to Pro.</span> It switches on within a few seconds; this page updates by itself. Your receipt
        is on its way from Lemon Squeezy, our payment partner.
      </p>
      <button type="button" onClick={() => setVisible(false)} aria-label="Dismiss" className="shrink-0 rounded px-1 text-muted hover:text-ink">
        ✕
      </button>
    </div>
  );
}

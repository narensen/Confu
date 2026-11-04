"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// Cloudflare Turnstile, for when CAPTCHA protection is on in Supabase
// (Authentication → Attack Protection). Off when no site key is set.
// Usage: const captcha = useCaptcha(); put {captcha.field} in the form,
// disable submit until captcha.ready, and call captcha.reset() after each
// attempt (a token works once).
export function useCaptcha(): { field: ReactNode; ready: boolean; reset: () => void } {
  const [token, setToken] = useState("");
  const [loaded, setLoaded] = useState(() => typeof window !== "undefined" && Boolean(window.turnstile));
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY || !loaded || !box.current || !window.turnstile || widget.current) return;
    widget.current = window.turnstile.render(box.current, {
      sitekey: SITE_KEY,
      appearance: "interaction-only", // invisible unless Cloudflare needs a click
      callback: (t: string) => setToken(t),
      "expired-callback": () => setToken(""),
      "error-callback": () => setToken(""),
    });
    return () => {
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [loaded]);

  const reset = useCallback(() => {
    if (!SITE_KEY || !widget.current) return;
    setToken("");
    window.turnstile?.reset(widget.current);
  }, []);

  if (!SITE_KEY) return { field: null, ready: true, reset };
  return {
    ready: Boolean(token),
    reset,
    field: (
      <>
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={() => setLoaded(true)} />
        <input type="hidden" name="captchaToken" value={token} />
        <div ref={box} className="flex justify-center empty:hidden" />
      </>
    ),
  };
}

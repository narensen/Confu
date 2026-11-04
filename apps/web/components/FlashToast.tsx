"use client";

import { useEffect } from "react";
import { toast } from "@/components/dialogs";

// One-off messages the server leaves in a short-lived cookie for the next
// page (e.g. after joining from an invite, or connecting OpenRouter).
const MESSAGES: Record<string, string> = {
  invite: "Welcome! You joined from a friend's invite.",
  openrouter: "OpenRouter is connected. Confu now runs on your OpenRouter account; pick models in Settings → Your AI.",
  "openrouter-cancelled": "OpenRouter wasn't connected. You can try again any time.",
  "openrouter-failed": "Couldn't connect OpenRouter. Try again, or paste an OpenRouter key instead.",
};

export function FlashToast() {
  useEffect(() => {
    const m = /(?:^|;\s*)confu_flash=([^;]+)/.exec(document.cookie);
    if (!m) return;
    document.cookie = "confu_flash=; path=/; max-age=0; samesite=lax";
    const text = MESSAGES[decodeURIComponent(m[1])];
    if (text) window.setTimeout(() => toast(text), 600);
  }, []);
  return null;
}

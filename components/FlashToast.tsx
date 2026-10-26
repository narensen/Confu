"use client";

import { useEffect } from "react";
import { toast } from "@/components/dialogs";

// One-off messages the server leaves in a short-lived cookie for the next
// page (e.g. after claiming an invite during sign-in).
const MESSAGES: Record<string, string> = {
  invite: "Welcome! Your friend's invite gave you a week of Pro: no API key needed.",
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

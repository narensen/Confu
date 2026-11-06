"use client";

// The browser's "install this app" prompt arrives once, early, so it's kept
// here until the student asks to install (account menu, Settings).
type PromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function captureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}
export const subscribeInstall = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const canInstall = () => deferred !== null;
export async function promptInstall() {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  emit();
  return outcome === "accepted";
}
export const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);

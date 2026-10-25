"use client";

import { createClient } from "@/lib/supabase/client";

// Browser notifications for review reminders. The subscription is saved to
// push_subscriptions (migration 0020); the daily job sends through it.
const PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export const pushAvailable = () => typeof window !== "undefined" && Boolean(PUBLIC) && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription() {
  if (!pushAvailable()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(): Promise<"on" | "denied" | "unavailable"> {
  if (!pushAvailable()) return "unavailable";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC!) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const supabase = createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", json.endpoint);
  const { error } = await supabase.from("push_subscriptions").insert({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
  if (error) throw new Error("Couldn't save notification settings.");
  return "on";
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await createClient().from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

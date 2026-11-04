"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

// A date in the reader's own time zone and locale. The server knows neither,
// so it renders a neutral UTC date that's swapped in after hydration.
export function LocalTime({ iso, withTime = false }: { iso: string; withTime?: boolean }) {
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const date = new Date(iso);
  const text = hydrated
    ? date.toLocaleString(undefined, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" })
    : date.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
  return <time dateTime={iso}>{text}</time>;
}

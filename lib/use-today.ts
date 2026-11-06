"use client";

import { useSyncExternalStore } from "react";
import { toISODate } from "@/lib/schedule";

const noSubscribe = () => () => {};

// Today's date in the reader's time zone. Read in the browser only: the server
// renders at a different moment (and possibly zone), and Cache Components
// flags `new Date()` during render. Null until hydrated.
export function useToday(): string | null {
  return useSyncExternalStore(noSubscribe, () => toISODate(new Date()), () => null);
}

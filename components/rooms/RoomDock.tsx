"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { chime } from "@/components/pdf/FocusTimer";
import { clock, currentRoom, heartbeat, leaveRoom, roomState, subscribeRoom, timerNow, type RoomState } from "@/lib/rooms";

// The room you're in, following you around the app: its timer, how many are
// there, and a way out. Also keeps your presence fresh (every 30 seconds).
const SHOWN_ON = ["/dashboard", "/session", "/review", "/settings", "/rooms", "/wrapped"];

export function RoomDock() {
  const room = useSyncExternalStore(subscribeRoom, currentRoom, () => null);
  const pathname = usePathname();
  const [state, setState] = useState<RoomState | null>(null);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(0); // set once the room's state arrives (not during prerender)

  useEffect(() => {
    if (!room) return;
    let live = true;
    const sync = async () => {
      await heartbeat();
      const s = await roomState(room.slug).catch(() => null);
      if (!live) return;
      setState(s);
      setNow(Date.now());
      if (s) setSkew(Date.parse(s.now) - Date.now());
    };
    void sync();
    const beat = window.setInterval(sync, 30_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      live = false;
      window.clearInterval(beat);
      window.clearInterval(tick);
    };
  }, [room]);

  const t = room && state?.slug === room.slug ? timerNow(state, now, skew) : null;
  const phase = t?.phase ?? null;
  const lastPhase = useRef<string | null>(null);
  // Focus turned to break (or back) while away from the room page: a soft chime.
  useEffect(() => {
    if (lastPhase.current && phase && lastPhase.current !== phase && document.visibilityState === "visible" && !pathname.startsWith(`/rooms/${room?.slug}`)) chime();
    lastPhase.current = phase;
  }, [phase, pathname, room?.slug]);

  if (!room || !SHOWN_ON.some((p) => pathname.startsWith(p)) || pathname.startsWith(`/rooms/${room.slug}`)) return null;
  return (
    <div className="animate-pop fixed bottom-4 left-4 z-30 flex items-center gap-3 rounded-xl border border-ink bg-panel py-2 pr-2 pl-3 text-xs shadow-hard-sm">
      <span className={`size-2 rounded-full ${t?.phase === "focus" ? "bg-ink" : t?.phase === "break" ? "bg-yellow-400" : "bg-line"}`} aria-hidden />
      <Link href={`/rooms/${room.slug}`} className="min-w-0 hover:underline">
        <span className="block max-w-36 truncate font-medium">{room.name}</span>
        <span className="block font-mono text-[11px] text-muted tabular-nums">
          {t && t.phase !== "idle" ? `${t.phase === "focus" ? "Focus" : "Break"} ${clock(t.left)}` : "Timer not running"}
          {state ? ` · ${state.members.length} here` : ""}
        </span>
      </Link>
      <button type="button" onClick={() => void leaveRoom()} aria-label={`Leave ${room.name}`} title="Leave the room" className="rounded-md px-1.5 py-1 text-muted transition hover:bg-paper hover:text-ink">
        ✕
      </button>
    </div>
  );
}

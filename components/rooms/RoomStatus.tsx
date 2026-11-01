"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { chime } from "@/components/pdf/FocusTimer";
import { Mic, ScreenIcon } from "@/components/rooms/VoiceRoom";
import { touchPresence } from "@/lib/friends";
import { clock, currentRoom, heartbeat, leaveRoom, onRoomChange, roomState, stayIfJoined, subscribeRoom, timerNow, type RoomState } from "@/lib/rooms";
import { joinVoice, leaveVoice, setVoiceMuted, stopScreenShare, useVoice } from "@/lib/voice-store";

// The header's room slot: "Rooms" until you join one, then the room you're
// in with its timer ("Focus 23:41"), a link back to it, and a way out. Also
// keeps your presence fresh (every 30 seconds) and chimes when focus turns
// to break (or back) while you're elsewhere in the app. In voice, it carries
// the mic (mute with a click) and who's talking, on every page.
export function RoomStatus() {
  const room = useSyncExternalStore(subscribeRoom, currentRoom, () => null);
  const voice = useVoice();
  const pathname = usePathname();
  const [state, setState] = useState<RoomState | null>(null);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(0); // set once the room's state arrives (not during prerender)

  useEffect(() => {
    if (!room) return;
    let live = true;
    const apply = (s: RoomState | null) => {
      if (!live) return;
      setState(s);
      setNow(Date.now());
      if (s) setSkew(Date.parse(s.now) - Date.now());
      stayIfJoined(s);
    };
    const refresh = () => {
      void roomState(room.slug).then(apply).catch(() => {});
    };
    const sync = async () => {
      await heartbeat();
      void touchPresence();
      apply(await roomState(room.slug).catch(() => null));
    };
    void sync();
    // A reload's leave can land after the first check-in. Check in again.
    const timers = [1_500, 4_000, 8_000].map((ms) => window.setTimeout(() => void sync(), ms));
    const beat = window.setInterval(() => void sync(), 30_000);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 5_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const off = onRoomChange(room.slug, (left) => {
      refresh();
      if (!left) return;
      timers.push(window.setTimeout(refresh, 400), window.setTimeout(refresh, 1_200));
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      off();
      timers.forEach((id) => window.clearTimeout(id));
      window.clearInterval(beat);
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [room]);

  const t = room && state?.slug === room.slug ? timerNow(state, now, skew) : null;
  const phase = t?.phase ?? null;
  const lastPhase = useRef<string | null>(null);
  useEffect(() => {
    if (lastPhase.current && phase && lastPhase.current !== phase && document.visibilityState === "visible" && !pathname.startsWith(`/rooms/${room?.slug}`)) chime();
    lastPhase.current = phase;
  }, [phase, pathname, room?.slug]);

  if (!room) {
    return (
      <Link href="/rooms" className="mr-2 rounded-md px-2 py-1 text-sm font-medium text-muted transition hover:bg-paper hover:text-ink">
        Rooms
      </Link>
    );
  }
  const timer = t && t.phase !== "idle" ? `${t.phase === "focus" ? "Focus" : "Break"} ${clock(t.left)}` : null;
  const inVoice = voice.inVoice && voice.slug === room.slug;
  const talking = inVoice ? voice.people.filter((p) => p.speaking) : [];
  // Who's here: you first, then by who came first.
  const members = state ? [...state.members].sort((a, b) => Number(b.me) - Number(a.me) || a.joined_at.localeCompare(b.joined_at)) : [];
  return (
    <div className="group relative mr-2 flex shrink-0 items-center rounded-md border border-ink/30 text-xs">
      <Link
        href={`/rooms/${room.slug}`}
        aria-describedby="room-members"
        className="flex items-center gap-2 rounded-l-md py-1 pr-1.5 pl-2 transition hover:bg-paper"
      >
        <span
          aria-hidden
          className={`size-2 shrink-0 rounded-full ${phase === "focus" ? "animate-pulse bg-ink" : phase === "break" ? "bg-yellow-400" : "bg-line"}`}
        />
        <span className="hidden max-w-28 truncate font-medium sm:inline">In {room.name}</span>
        <span className="font-mono text-[11px] whitespace-nowrap text-muted tabular-nums">{timer ?? "In room"}</span>
        {state && (
          <span className="flex items-center gap-0.5 font-mono text-[11px] text-muted" aria-label={`${members.length} here`}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" />
            </svg>
            {members.length}
          </span>
        )}
      </Link>
      {inVoice && (
        <button
          type="button"
          onClick={() => setVoiceMuted(!voice.muted)}
          disabled={voice.deafened}
          aria-pressed={voice.muted || voice.deafened}
          title={voice.muted || voice.deafened ? "Unmute" : "Mute"}
          aria-label={voice.muted || voice.deafened ? "Unmute" : "Mute"}
          className={`flex items-center gap-1 self-stretch border-l border-ink/20 px-1.5 transition hover:bg-paper ${voice.muted || voice.deafened ? "text-danger" : talking.length ? "text-ok" : "text-ink"}`}
        >
          <Mic off={voice.muted || voice.deafened} size={13} />
          <span className="font-mono text-[11px] tabular-nums">{voice.people.length}</span>
        </button>
      )}
      {inVoice && voice.sharing && (
        <button
          type="button"
          onClick={() => stopScreenShare()}
          title="Stop sharing your screen"
          aria-label="Stop sharing your screen"
          className="flex items-center self-stretch border-l border-ink/20 px-1.5 text-danger transition hover:bg-paper"
        >
          <ScreenIcon size={13} />
        </button>
      )}
      {voice.resumable && voice.slug === room.slug && !inVoice && (
        <button
          type="button"
          onClick={() => void joinVoice(room.slug)}
          className="self-stretch border-l border-ink/20 px-2 text-[11px] font-medium text-ok transition hover:bg-paper"
          title="You were in voice before the page reloaded"
        >
          Rejoin voice
        </button>
      )}
      <button
        type="button"
        onClick={() => void leaveRoom()}
        aria-label={`Leave ${room.name}`}
        title="Leave the room"
        className="self-stretch rounded-r-md border-l border-ink/20 px-1.5 text-muted transition hover:bg-paper hover:text-ink"
      >
        ✕
      </button>

      {/* On hover (or keyboard focus): how many are here, and who. */}
      <div
        id="room-members"
        role="tooltip"
        className="invisible absolute top-full right-0 z-50 w-72 pt-2 opacity-0 transition duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        <div className="rounded-xl border border-ink bg-panel p-3 shadow-hard">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-medium">{room.name}</p>
            <p className="shrink-0 font-mono text-[11px] text-muted">
              {state ? `${members.length} ${members.length === 1 ? "person" : "people"} here` : "…"}
            </p>
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-muted">{timer ? `${timer} left` : "Timer not running"}</p>
          {inVoice && (
            <div className="mt-2.5 border-t border-line pt-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-ok">
                  <span className="size-1.5 animate-pulse rounded-full bg-ok" aria-hidden />
                  In voice · {voice.people.length}
                </p>
                <button type="button" onClick={() => void leaveVoice()} className="rounded-md border border-danger/40 px-2 py-0.5 text-[11px] font-medium text-danger transition hover:bg-danger/5">
                  Leave voice
                </button>
              </div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {voice.people.map((p) => (
                  <li
                    key={p.id}
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${p.speaking ? "border-ok text-ok" : "border-line"}`}
                  >
                    {(p.muted || p.deafened) && <Mic off size={10} />}
                    {p.me ? "You" : p.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {members.length > 0 && (
            <ul className="mt-2.5 max-h-60 space-y-1.5 overflow-y-auto border-t border-line pt-2.5">
              {members.slice(0, 12).map((m, i) => (
                <li key={`${m.name}-${i}`} className="flex items-start gap-2 text-xs">
                  <span aria-hidden className={`mt-1 size-1.5 shrink-0 rounded-full ${m.me ? "bg-yellow-400" : "bg-ink"}`} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{m.me ? "You" : m.name}</span>
                    {m.studying && <span className="block truncate text-muted">{m.studying}</span>}
                  </span>
                </li>
              ))}
              {members.length > 12 && <li className="pl-3.5 text-xs text-muted">and {members.length - 12} more</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "@/components/dialogs";
import { FocusSound } from "@/components/pdf/FocusSound";
import { chime } from "@/components/pdf/FocusTimer";
import { RoomFriends } from "@/components/rooms/RoomFriends";
import { Mic, VoiceRoom } from "@/components/rooms/VoiceRoom";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { clock, currentRoom, heartbeat, joinRoom, leaveRoom, onRoomChange, ping, roomState, setStudying, stayIfJoined, subscribeRoom, timerNow, type RoomState } from "@/lib/rooms";
import { SITE } from "@/lib/site";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";
import { useVoice } from "@/lib/voice-store";

export function RoomView({ slug }: { slug: string }) {
  const [room, setRoom] = useState<RoomState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(0); // set when the room arrives
  const [studying, setStudyingText] = useState(() => (currentRoom()?.slug === slug ? currentRoom()!.studying : ""));
  const [pending, setPending] = useState(false);
  const joinedRoom = useSyncExternalStore(subscribeRoom, currentRoom, () => null);
  const joined = joinedRoom?.slug === slug;
  const lastPhase = useRef<string | null>(null);
  const voice = useVoice();

  // The room as it is now (also after joining, leaving or changing the timer).
  const load = (target: string) =>
    roomState(target).then(
      (s) => {
        setRoom(s);
        setNow(Date.now());
        if (s) setSkew(Date.parse(s.now) - Date.now());
        stayIfJoined(s);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : "Couldn't open the room."),
    );
  const refresh = () => load(slug);

  useEffect(() => {
    let live = true;
    const sync = () => {
      if (live) void load(slug);
    };
    sync();
    const timers: number[] = [];
    const off = onRoomChange(slug, (left) => {
      sync();
      if (!left) return;
      timers.push(window.setTimeout(sync, 400), window.setTimeout(sync, 1_200));
    });
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") sync();
    }, 5_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      live = false;
      off();
      timers.forEach((id) => window.clearTimeout(id));
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug]);

  const t = room ? timerNow(room, now, skew) : null;
  // A soft chime when focus turns to break and back, for people in the room.
  useEffect(() => {
    if (!t || !joined) return;
    if (lastPhase.current && lastPhase.current !== t.phase && document.visibilityState === "visible") chime();
    lastPhase.current = t.phase;
  }, [t?.phase, joined, t]);

  if (error) return <p className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p>;
  if (room === undefined) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="skeleton h-[32rem] rounded-3xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }
  if (room === null) {
    return (
      <div className="rounded-3xl border border-ink bg-panel px-6 py-16 text-center">
        <p className="font-serif text-3xl">This room doesn&apos;t exist any more</p>
        <p className="mt-2 text-sm text-muted">Its maker may have deleted it.</p>
        <Link href="/rooms" className={`${ghostButtonClass} mt-5`}>
          See other rooms
        </Link>
      </div>
    );
  }

  const link = `${SITE.url}/rooms/${room.slug}`;
  const others = room.members.filter((m) => !m.me);
  const phase = t?.phase ?? "idle";
  const total = (phase === "break" ? room.break_minutes : room.focus_minutes) * 60_000;
  const progress = t && phase !== "idle" ? Math.min(1, Math.max(0, 1 - t.left / total)) : 0;
  const voiceNames = new Set(voice.slug === room.slug ? voice.people.map((p) => (p.me ? "\u0000me" : p.name)) : []);

  async function setTimer(next: "focus" | "break" | "idle") {
    const { error } = await createClient().rpc("set_room_timer", { p_slug: room!.slug, p_phase: next });
    if (error) return toast("Couldn't change the timer.", "error");
    track("room.timer", { phase: next });
    ping(room!.slug);
    void refresh();
  }

  return (
    <div className="animate-enter grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        {/* The room */}
        <section className={`overflow-hidden rounded-3xl border border-ink transition-colors duration-700 ${phase === "focus" ? "bg-ink text-white" : phase === "break" ? "bg-yellow-100" : "bg-panel"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6 sm:px-8 sm:pt-8">
            <div className="min-w-0">
              <Link href="/rooms" className={`${eyebrowClass} ${phase === "focus" ? "text-white/60! hover:text-white!" : "hover:text-ink"}`}>
                ← Study rooms
              </Link>
              <h1 className="mt-2 font-serif text-3xl leading-tight tracking-tight sm:text-4xl">{room.name}</h1>
              <div className={`mt-2 flex flex-wrap items-center gap-2 text-xs ${phase === "focus" ? "text-white/70" : "text-muted"}`}>
                <Badge dark={phase === "focus"}>{room.is_public ? "Public · quiet" : "Private · voice"}</Badge>
                <Badge dark={phase === "focus"}>{room.timer_mode === "clock" ? `${room.focus_minutes}/${room.break_minutes} on the clock` : room.mine ? "You run the timer" : `${room.focus_minutes} min focus blocks`}</Badge>
                <span className="flex items-center gap-1.5">
                  <span className={`size-1.5 rounded-full ${room.members.length ? "bg-ok" : "bg-line"}`} aria-hidden />
                  {room.members.length} here
                </span>
              </div>
            </div>
            <div className={phase === "focus" ? "rounded-lg bg-panel text-ink" : ""}>
              <FocusSound />
            </div>
          </div>

          <div className="flex flex-col items-center px-6 pt-6 pb-8 sm:pb-10">
            <TimerRing progress={progress} phase={phase}>
              <p className={`font-mono text-[11px] tracking-[0.25em] uppercase ${phase === "focus" ? "text-white/60" : "text-muted"}`}>
                {phase === "focus" ? "Focus" : phase === "break" ? "Break" : "Ready"}
              </p>
              <p className="mt-1 font-sans text-6xl font-semibold tracking-tight tabular-nums sm:text-7xl" aria-live="polite">
                {t && phase !== "idle" ? clock(t.left) : `${room.focus_minutes}:00`}
              </p>
              <p className={`mt-1 text-xs ${phase === "focus" ? "text-white/60" : "text-muted"}`}>
                {phase === "focus" ? `of ${room.focus_minutes} min` : phase === "break" ? `of ${room.break_minutes} min` : "not running"}
              </p>
            </TimerRing>
            <p className={`mt-6 max-w-md text-center text-sm ${phase === "focus" ? "text-white/70" : "text-muted"}`}>
              {phase === "focus"
                ? "Heads down. Everyone here is working too."
                : phase === "break"
                  ? "Stand up, stretch, look away from the screen."
                  : room.mine
                    ? "Start a focus block when everyone's ready."
                    : "The room's maker starts the timer."}
            </p>
            {room.mine && room.timer_mode === "manual" && (
              <div className={`mt-5 flex rounded-xl border p-1 ${phase === "focus" ? "border-white/25" : "border-ink/20 bg-panel"}`}>
                {(["focus", "break", "idle"] as const).map((next) => (
                  <button
                    key={next}
                    type="button"
                    onClick={() => void setTimer(next)}
                    aria-pressed={phase === next}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      phase === next
                        ? phase === "focus"
                          ? "bg-white text-ink"
                          : "bg-ink text-white"
                        : phase === "focus"
                          ? "text-white/80 hover:bg-white/10"
                          : "text-muted hover:bg-paper hover:text-ink"
                    }`}
                  >
                    {next === "focus" ? `Focus ${room.focus_minutes}m` : next === "break" ? `Break ${room.break_minutes}m` : "Stop"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {!room.is_public && <VoiceRoom slug={room.slug} joined={joined} />}

        {/* Who's here */}
        <section className="mt-8" aria-label="In the room">
          <div className="flex items-baseline justify-between">
            <p className={eyebrowClass}>In the room</p>
            <p className="font-mono text-[11px] text-muted">
              {room.members.length} {room.members.length === 1 ? "person" : "people"}
            </p>
          </div>
          {room.members.length ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {room.members.map((m, i) => {
                const talking = voiceNames.has(m.me ? "\u0000me" : m.name);
                return (
                  <li key={`${m.name}-${i}`} className="animate-enter flex items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2.5" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                    <span className="relative">
                      <span className={`flex size-10 shrink-0 items-center justify-center rounded-full border border-ink font-serif ${m.me ? "bg-yellow-300" : "bg-paper"}`}>{m.name.slice(0, 1).toUpperCase()}</span>
                      {talking && (
                        <span title="In voice" className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border border-ink bg-panel text-ok">
                          <Mic off={false} size={10} />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {m.name}
                        {m.me && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
                      </span>
                      <span className="block truncate text-xs text-muted">{m.studying || "Studying"}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-ink/30 px-4 py-6 text-center text-sm text-muted">No one here right now. Join, and the next person will find you studying.</p>
          )}
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-ink bg-panel p-5">
          {joined ? (
            <>
              <p className="flex items-center gap-2 font-medium">
                <span className="size-2 rounded-full bg-ok" aria-hidden />
                You&apos;re in this room
              </p>
              <p className="mt-1 text-sm text-muted">
                {others.length ? `${others.length} ${others.length === 1 ? "person is" : "people are"} here with you.` : "You're the first one here."} Go study: the timer
                {!room.is_public ? " and voice" : ""} follow you in the header.
              </p>
              <label className="mt-4 block">
                <span className="mb-1 block text-xs font-medium">Working on (shown to the room)</span>
                <input
                  value={studying}
                  maxLength={120}
                  onChange={(e) => setStudyingText(e.target.value)}
                  onBlur={() => {
                    setStudying(studying.trim());
                    void heartbeat().then(() => ping(room.slug));
                  }}
                  placeholder="e.g. Linear algebra, chapter 3"
                  className={`${inputClass} py-1.5`}
                />
              </label>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/dashboard" className={`${buttonClass} py-1.5`}>
                  Go to my library
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    await leaveRoom();
                    void refresh();
                  }}
                  className={`${ghostButtonClass} py-1.5`}
                >
                  Leave room
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="font-medium">Join this room</p>
              <p className="mt-1 text-sm text-muted">Others here see your first name{studying.trim() ? " and what you're working on" : ""}. Nothing else.</p>
              {!room.is_public && <p className="mt-1 text-sm text-muted">Once you&apos;re in, you can talk in voice and invite friends.</p>}
              <input value={studying} maxLength={120} onChange={(e) => setStudyingText(e.target.value)} placeholder="Working on… (optional)" className={`${inputClass} mt-4 py-1.5`} />
              <button
                type="button"
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  try {
                    if (joinedRoom && joinedRoom.slug !== slug) await leaveRoom();
                    await joinRoom(room.slug, room.name, studying.trim());
                    track("room.join", { public: room.is_public });
                    void refresh();
                  } catch (err) {
                    toast(err instanceof Error ? err.message : "Couldn't join.", "error");
                  } finally {
                    setPending(false);
                  }
                }}
                className={`${buttonClass} mt-3 w-full py-2`}
              >
                {pending ? "Joining…" : joinedRoom ? `Leave ${joinedRoom.name} and join` : "Join room"}
              </button>
            </>
          )}
        </div>
        {!room.is_public && <RoomFriends slug={room.slug} link={link} canInvite={joined || room.mine} />}
      </aside>
    </div>
  );
}

function Badge({ children, dark }: { children: React.ReactNode; dark: boolean }) {
  return <span className={`rounded-full border px-2 py-0.5 ${dark ? "border-white/25" : "border-ink/20 bg-panel"}`}>{children}</span>;
}

// The time left, inside a ring that fills as the block goes by.
function TimerRing({ progress, phase, children }: { progress: number; phase: "focus" | "break" | "idle"; children: React.ReactNode }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative flex size-64 items-center justify-center sm:size-72">
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="2.5" className={phase === "focus" ? "stroke-white/15" : "stroke-ink/10"} />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - progress)}
          className={`transition-[stroke-dashoffset] duration-1000 ease-linear ${phase === "focus" ? "stroke-yellow-300" : phase === "break" ? "stroke-ink" : "stroke-transparent"}`}
        />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

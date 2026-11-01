"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "@/components/dialogs";
import { FocusSound } from "@/components/pdf/FocusSound";
import { chime } from "@/components/pdf/FocusTimer";
import { RoomFriends } from "@/components/rooms/RoomFriends";
import { VoiceRoom } from "@/components/rooms/VoiceRoom";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { clock, currentRoom, heartbeat, joinRoom, leaveRoom, onRoomChange, ping, roomState, setStudying, subscribeRoom, timerNow, type RoomState } from "@/lib/rooms";
import { SITE } from "@/lib/site";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";

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

  // The room as it is now (also after joining, leaving or changing the timer).
  const load = (target: string) =>
    roomState(target).then(
      (s) => {
        setRoom(s);
        setNow(Date.now());
        if (s) setSkew(Date.parse(s.now) - Date.now());
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
    const off = onRoomChange(slug, sync);
    const poll = window.setInterval(sync, 15_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      live = false;
      off();
      window.clearInterval(poll);
      window.clearInterval(tick);
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
  if (room === undefined) return <div className="skeleton h-80 rounded-2xl" />;
  if (room === null) {
    return (
      <div className="rounded-2xl border border-ink bg-panel px-6 py-12 text-center">
        <p className="font-serif text-2xl">This room doesn&apos;t exist any more</p>
        <Link href="/rooms" className={`${ghostButtonClass} mt-4`}>
          See other rooms
        </Link>
      </div>
    );
  }

  const link = `${SITE.url}/rooms/${room.slug}`;
  const others = room.members.filter((m) => !m.me);

  return (
    <div className="animate-enter grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="rounded-2xl border border-ink bg-panel p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/rooms" className={`${eyebrowClass} hover:text-ink`}>
              ← Study rooms
            </Link>
            <h1 className="mt-2 font-serif text-3xl tracking-tight sm:text-4xl">{room.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {room.timer_mode === "clock" ? `${room.focus_minutes}/${room.break_minutes} on the clock` : room.mine ? "Your room: you run the timer" : "Private room"} ·{" "}
              {room.members.length} here
            </p>
          </div>
          <FocusSound />
        </div>

        <div className={`mt-8 rounded-2xl border border-ink px-6 py-10 text-center ${t?.phase === "focus" ? "bg-ink text-white" : t?.phase === "break" ? "bg-yellow-100" : "bg-paper"}`}>
          <p className={`font-mono text-xs tracking-[0.2em] uppercase ${t?.phase === "focus" ? "text-white/60" : "text-muted"}`}>
            {t?.phase === "focus" ? "Focus" : t?.phase === "break" ? "Break" : "Waiting to start"}
          </p>
          <p className="mt-2 font-sans text-7xl font-semibold tracking-tight sm:text-8xl" aria-live="polite">
            {t && t.phase !== "idle" ? clock(t.left) : "–:––"}
          </p>
          <p className={`mt-3 text-sm ${t?.phase === "focus" ? "text-white/70" : "text-muted"}`}>
            {t?.phase === "focus" ? "Heads down. Everyone here is working too." : t?.phase === "break" ? "Stand up, stretch, look away from the screen." : room.mine ? "Start a focus block when everyone's ready." : "The room's maker starts the timer."}
          </p>
          {room.mine && room.timer_mode === "manual" && (
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {(["focus", "break", "idle"] as const).map((phase) => (
                <button
                  key={phase}
                  type="button"
                  onClick={async () => {
                    const { error } = await createClient().rpc("set_room_timer", { p_slug: room.slug, p_phase: phase });
                    if (error) return toast("Couldn't change the timer.", "error");
                    ping(room.slug);
                    void refresh();
                  }}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${t?.phase === "focus" ? "border-white/40 text-white hover:bg-white hover:text-ink" : "border-ink bg-panel text-ink hover:-translate-y-px hover:shadow-hard-sm"}`}
                >
                  {phase === "focus" ? `Start ${room.focus_minutes} min focus` : phase === "break" ? `${room.break_minutes} min break` : "Stop"}
                </button>
              ))}
            </div>
          )}
        </div>

        {!room.is_public && <VoiceRoom slug={room.slug} joined={joined} />}

        <div className="mt-8">
          <p className={eyebrowClass}>In the room</p>
          {room.members.length ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {room.members.map((m, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-full border border-ink font-serif ${m.me ? "bg-yellow-300" : "bg-panel"}`}>{m.name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {m.name}
                      {m.me && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
                    </span>
                    <span className="block truncate text-xs text-muted">{m.studying || "Studying"}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">No one here right now. Join, and the next person will find you studying.</p>
          )}
        </div>
      </section>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-ink bg-panel p-5">
          {joined ? (
            <>
              <p className="font-medium">You&apos;re in this room</p>
              <p className="mt-1 text-sm text-muted">{others.length ? `${others.length} ${others.length === 1 ? "person is" : "people are"} here with you.` : "You're the first one here."} Go study; the timer follows you in a small dock.</p>
              <label className="mt-4 block">
                <span className="mb-1 block text-xs font-medium">Working on (optional, shown to the room)</span>
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
                  Leave
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="font-medium">Join this room</p>
              <p className="mt-1 text-sm text-muted">Others here will see your first name{studying.trim() ? " and what you're working on" : ""}. Nothing else.</p>
              {!room.is_public && <p className="mt-1 text-sm text-muted">Once you&apos;re in, you can invite friends and turn on voice.</p>}
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
                {pending ? "Joining…" : joinedRoom ? `Leave ${joinedRoom.name} and join` : "Join"}
              </button>
            </>
          )}
        </div>
        {!room.is_public && <RoomFriends slug={room.slug} link={link} canInvite={joined || room.mine} />}
      </aside>
    </div>
  );
}

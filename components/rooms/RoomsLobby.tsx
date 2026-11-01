"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ask, toast } from "@/components/dialogs";
import { buttonClass, eyebrowClass, inputClass } from "@/components/ui";
import { clock, currentRoom, subscribeRoom, timerNow } from "@/lib/rooms";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";

type Listed = { slug: string; name: string; timer_mode: "manual" | "clock"; focus_minutes: number; break_minutes: number; present: number };
type Mine = { slug: string; name: string; present: number; created_at: string };

export function RoomsLobby() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Listed[] | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [focus, setFocus] = useState(50);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(0); // set when the rooms arrive (not during prerender)
  const inRoom = useSyncExternalStore(subscribeRoom, currentRoom, () => null);

  useEffect(() => {
    const supabase = createClient();
    const load = async () => {
      const [pub, my] = await Promise.all([supabase.rpc("public_rooms"), supabase.rpc("my_rooms")]);
      if (pub.error) return setError(/public_rooms/.test(pub.error.message) ? "Study rooms need migration 0025 to be run in Supabase." : pub.error.message);
      setRooms((pub.data ?? []) as Listed[]);
      setMine((my.data ?? []) as Mine[]);
      setNow(Date.now());
    };
    void load();
    const poll = window.setInterval(load, 20_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, []);

  async function create() {
    setPending(true);
    try {
      const { data, error } = await createClient().rpc("create_room", { p_name: name.trim() || "Study room", p_focus: focus, p_break: focus >= 50 ? 10 : 5 });
      if (error) throw new Error(error.message.includes("up to 5") ? "You can have up to 5 rooms. Delete one first." : error.message);
      track("room.create", { focus });
      router.push(`/rooms/${data as string}`);
      // This page stays mounted (hidden) while the room is open: reset it, or
      // it's still "Creating…" on the way back.
      setName("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't create the room.", "error");
    } finally {
      setPending(false);
    }
  }

  if (error) return <p className="mt-8 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p>;

  return (
    <div className="mt-8 space-y-10">
      {inRoom && (
        <p className="rounded-xl border border-ink bg-yellow-100 px-4 py-3 text-sm">
          You&apos;re in <span className="font-medium">{inRoom.name}</span>.{" "}
          <Link href={`/rooms/${inRoom.slug}`} className="font-medium underline underline-offset-4">
            Go back to it
          </Link>
        </p>
      )}

      <section>
        <p className={eyebrowClass}>Open to everyone</p>
        <ul className="mt-3 grid gap-4 md:grid-cols-2">
          {(rooms ?? [null, null]).map((r, i) =>
            r ? (
              <li key={r.slug}>
                <Link href={`/rooms/${r.slug}`} className="group flex h-full flex-col rounded-2xl border border-ink bg-panel p-6 transition-[translate,box-shadow] duration-300 ease-fluid hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-serif text-2xl">{r.name}</span>
                    <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
                      <span className={`size-2 rounded-full ${r.present ? "bg-ok" : "bg-line"}`} aria-hidden />
                      {r.present} studying
                    </span>
                  </span>
                  <span className="mt-2 text-sm text-muted">
                    {r.focus_minutes} minutes of focus, {r.break_minutes} of break, on the clock all day.
                  </span>
                  <Phase room={r} now={now} />
                </Link>
              </li>
            ) : (
              <li key={i} className="skeleton h-40 rounded-2xl" />
            ),
          )}
        </ul>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <p className={eyebrowClass}>Make a private room</p>
          <div className="mt-3 space-y-3 rounded-2xl border border-ink bg-panel p-5">
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Thesis crew, Physics 101 group" className={inputClass} />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Focus blocks of</span>
              {[25, 50, 90].map((m) => (
                <button key={m} type="button" onClick={() => setFocus(m)} aria-pressed={focus === m} className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${focus === m ? "border-ink bg-ink text-white" : "border-ink/30 hover:border-ink"}`}>
                  {m} min
                </button>
              ))}
            </div>
            <button type="button" onClick={create} disabled={pending} className={`${buttonClass} py-2`}>
              {pending ? "Creating…" : "Create room"}
            </button>
            <p className="text-xs text-muted">Anyone with its link can join. You run the timer. From inside the room you can invite friends and turn on voice.</p>
          </div>
        </div>
        <div>
          <p className={eyebrowClass}>Your rooms</p>
          {mine.length ? (
            <ul className="mt-3 divide-y divide-line rounded-2xl border border-ink bg-panel">
              {mine.map((r) => (
                <li key={r.slug} className="flex items-center gap-3 px-4 py-3">
                  <Link href={`/rooms/${r.slug}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {r.name}
                  </Link>
                  <span className="shrink-0 font-mono text-xs text-muted">{r.present} here</span>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!(await ask({ title: `Delete “${r.name}”?`, body: "Its link stops working.", confirm: "Delete room", danger: true }))) return;
                      const { error } = await createClient().rpc("delete_room", { p_slug: r.slug });
                      if (error) return toast("Couldn't delete it.", "error");
                      setMine((list) => list.filter((x) => x.slug !== r.slug));
                    }}
                    className="shrink-0 text-xs text-muted hover:text-danger"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-2xl border border-dashed border-ink/30 px-4 py-6 text-sm text-muted">Rooms you make appear here, ready to share with friends.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Phase({ room, now }: { room: Listed; now: number }) {
  const t = timerNow({ ...room, timer_phase: "idle", timer_ends_at: null }, now);
  return (
    <span className="mt-auto flex items-center gap-2 pt-5 font-mono text-xs">
      <span className={`rounded px-1.5 py-0.5 ${t.phase === "focus" ? "bg-ink text-white" : "bg-yellow-300"}`}>{t.phase === "focus" ? "Focus" : "Break"}</span>
      <span className="tabular-nums text-muted">{clock(t.left)} left</span>
    </span>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ask, toast } from "@/components/dialogs";
import { buttonClass, eyebrowClass, inputClass } from "@/components/ui";
import { clock, currentRoom, subscribeRoom, timerNow } from "@/lib/rooms";
import { SITE } from "@/lib/site";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/telemetry";

type Listed = { slug: string; name: string; timer_mode: "manual" | "clock"; focus_minutes: number; break_minutes: number; present: number };
type Mine = { slug: string; name: string; present: number; created_at: string };

const PRESETS = [
  { focus: 25, rest: 5, label: "Pomodoro", hint: "25 / 5" },
  { focus: 50, rest: 10, label: "Deep work", hint: "50 / 10" },
  { focus: 90, rest: 10, label: "Long haul", hint: "90 / 10" },
];

export function RoomsLobby() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Listed[] | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState(1);
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
    const { focus, rest } = PRESETS[preset];
    try {
      const { data, error } = await createClient().rpc("create_room", { p_name: name.trim() || "Study room", p_focus: focus, p_break: rest });
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

  const studyingNow = (rooms ?? []).reduce((n, r) => n + r.present, 0) + mine.reduce((n, r) => n + r.present, 0);

  return (
    <div className="mt-8 space-y-12">
      {inRoom ? (
        <Link href={`/rooms/${inRoom.slug}`} className="group flex items-center gap-4 rounded-2xl border border-ink bg-yellow-100 px-5 py-4 transition hover:-translate-y-px hover:shadow-hard-sm">
          <span className="relative flex size-3">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
            <span className="relative inline-flex size-3 rounded-full bg-ok" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-muted">You&apos;re in a room</span>
            <span className="block truncate font-serif text-xl">{inRoom.name}</span>
          </span>
          <span className="shrink-0 text-sm font-medium underline-offset-4 group-hover:underline">Back to it →</span>
        </Link>
      ) : (
        rooms && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className={`size-2 rounded-full ${studyingNow ? "bg-ok" : "bg-line"}`} aria-hidden />
            {studyingNow ? `${studyingNow} ${studyingNow === 1 ? "person is" : "people are"} studying in rooms right now.` : "Quiet right now. Be the first one in."}
          </p>
        )
      )}

      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className={eyebrowClass}>Open to everyone</p>
            <h2 className="mt-1 font-serif text-3xl tracking-tight">Drop in and get to work</h2>
          </div>
          <p className="hidden max-w-xs text-right text-xs text-muted sm:block">On the clock all day. Quiet: no voice, just people working.</p>
        </div>
        <ul className="mt-5 grid gap-4 md:grid-cols-2">
          {(rooms ?? [null, null]).map((r, i) =>
            r ? (
              <li key={r.slug}>
                <PublicRoom room={r} now={now} />
              </li>
            ) : (
              <li key={i} className="skeleton h-44 rounded-2xl" />
            ),
          )}
        </ul>
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div>
          <p className={eyebrowClass}>Your rooms</p>
          <h2 className="mt-1 font-serif text-3xl tracking-tight">Private, for the people you study with</h2>
          <p className="mt-1 max-w-xl text-sm text-muted">You run the timer. Invite friends, talk or share a screen (peer to peer, never recorded), and share the link with anyone else.</p>
          {mine.length ? (
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {mine.map((r) => (
                <li key={r.slug} className="flex flex-col rounded-2xl border border-ink bg-panel p-4">
                  <Link href={`/rooms/${r.slug}`} className="font-serif text-xl leading-snug hover:underline">
                    {r.name}
                  </Link>
                  <span className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-muted">
                    <span className={`size-1.5 rounded-full ${r.present ? "bg-ok" : "bg-line"}`} aria-hidden />
                    {r.present ? `${r.present} here now` : "Empty"}
                  </span>
                  <span className="mt-4 flex items-center gap-2">
                    <Link href={`/rooms/${r.slug}`} className="rounded-lg border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-white transition hover:-translate-y-px">
                      Open
                    </Link>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(`${SITE.url}/rooms/${r.slug}`).then(() => toast("Room link copied."))}
                      className="rounded-lg border border-ink/30 px-3 py-1.5 text-xs font-medium transition hover:border-ink"
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!(await ask({ title: `Delete “${r.name}”?`, body: "Its link stops working.", confirm: "Delete room", danger: true }))) return;
                        const { error } = await createClient().rpc("delete_room", { p_slug: r.slug });
                        if (error) return toast("Couldn't delete it.", "error");
                        setMine((list) => list.filter((x) => x.slug !== r.slug));
                      }}
                      className="ml-auto text-xs text-muted transition hover:text-danger"
                    >
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-ink/30 px-6 py-10 text-center">
              <p className="font-serif text-xl">No rooms yet</p>
              <p className="mt-1 text-sm text-muted">Make one for your study group, then send them the link.</p>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="h-fit space-y-4 rounded-2xl border border-ink bg-panel p-5 shadow-hard-sm"
        >
          <p className="font-medium">New private room</p>
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Thesis crew, Physics 101 group" aria-label="Room name" className={inputClass} />
          <div>
            <p className="mb-2 text-xs font-medium">Rhythm</p>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setPreset(i)}
                  aria-pressed={preset === i}
                  className={`rounded-xl border px-2 py-2.5 text-center transition ${preset === i ? "border-ink bg-ink text-white" : "border-ink/25 hover:border-ink"}`}
                >
                  <span className="block text-xs font-medium">{p.label}</span>
                  <span className={`mt-0.5 block font-mono text-[10px] ${preset === i ? "text-white/70" : "text-muted"}`}>{p.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={pending} className={`${buttonClass} w-full py-2.5`}>
            {pending ? "Creating…" : "Create room"}
          </button>
          <p className="text-xs leading-relaxed text-muted">Up to 5 rooms. Anyone with the link can join; inside, you can invite friends and turn on voice.</p>
        </form>
      </section>
    </div>
  );
}

function PublicRoom({ room: r, now }: { room: Listed; now: number }) {
  const t = timerNow({ ...r, timer_phase: "idle", timer_ends_at: null }, now);
  const total = (t.phase === "focus" ? r.focus_minutes : r.break_minutes) * 60_000;
  const progress = Math.min(1, Math.max(0, 1 - t.left / total));
  const focus = t.phase === "focus";
  return (
    <Link
      href={`/rooms/${r.slug}`}
      className={`group flex h-full items-center gap-5 rounded-2xl border border-ink p-5 transition-[translate,box-shadow] duration-300 ease-fluid hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard ${focus ? "bg-panel" : "bg-yellow-100"}`}
    >
      <span className="relative flex size-20 shrink-0 items-center justify-center">
        <svg viewBox="0 0 40 40" className="absolute inset-0 size-full -rotate-90" aria-hidden>
          <circle cx="20" cy="20" r="17" fill="none" strokeWidth="2.5" className="stroke-ink/10" />
          <circle cx="20" cy="20" r="17" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={2 * Math.PI * 17} strokeDashoffset={2 * Math.PI * 17 * (1 - progress)} className="stroke-ink transition-[stroke-dashoffset] duration-1000 ease-linear" />
        </svg>
        <span className="font-mono text-sm font-medium tabular-nums">{now ? clock(t.left) : "–:––"}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${focus ? "bg-ink text-white" : "bg-yellow-300"}`}>{focus ? "Focus" : "Break"}</span>
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
            <span className={`size-1.5 rounded-full ${r.present ? "bg-ok" : "bg-line"}`} aria-hidden />
            {r.present} studying
          </span>
        </span>
        <span className="mt-1.5 block truncate font-serif text-2xl">{r.name}</span>
        <span className="mt-0.5 block text-sm text-muted">
          {r.focus_minutes} min focus · {r.break_minutes} min break
        </span>
      </span>
      <span aria-hidden className="hidden text-xl transition group-hover:translate-x-1 sm:block">
        →
      </span>
    </Link>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ErrorNote, SpaceIcon } from "@/components/community/kit";
import { toast } from "@/components/dialogs";
import { buttonClass, eyebrowClass, inputClass, labelClass } from "@/components/ui";
import { browseSpaces, createSpace, joinSpace, leaveSpace, loadSpaces, type SpaceCard } from "@/lib/community";
import { track } from "@/lib/telemetry";

// Every subject, grouped, with a Follow button each; the spaces you're in;
// and a private space for your own group.
export function SpacesView() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<SpaceCard[] | null>(null);
  const [mine, setMine] = useState<SpaceCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let live = true;
    void Promise.all([browseSpaces(), loadSpaces()]).then(
      ([all, joined]) => {
        if (!live) return;
        setSubjects(all);
        setMine(joined);
      },
      (err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Couldn't load spaces.");
      },
    );
    return () => {
      live = false;
    };
  }, []);

  // Follow or unfollow a subject in place.
  async function toggle(space: SpaceCard) {
    const following = !space.joined;
    const before = { subjects, mine };
    const flip = (s: SpaceCard) => (s.id === space.id ? { ...s, joined: following, members: Math.max(0, s.members + (following ? 1 : -1)) } : s);
    setSubjects((list) => list?.map(flip) ?? list);
    setMine((list) => (following ? [{ ...space, joined: true, members: space.members + 1 }, ...list] : list.filter((s) => s.id !== space.id)));
    try {
      if (following) {
        await joinSpace(space.slug);
        track("space.follow", { slug: space.slug });
      } else await leaveSpace(space.slug);
    } catch (err) {
      setSubjects(before.subjects);
      setMine(before.mine);
      toast(err instanceof Error ? err.message : "Couldn't update that.", "error");
    }
  }

  const q = filter.trim().toLowerCase();
  const groups = useMemo(() => {
    const map = new Map<string, SpaceCard[]>();
    for (const s of subjects ?? []) {
      if (q && !`${s.name} ${s.about} ${s.category}`.toLowerCase().includes(q)) continue;
      const key = s.category || "Subjects";
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return [...map.entries()];
  }, [subjects, q]);
  const privateSpaces = mine.filter((s) => s.visibility === "private");
  const followed = mine.filter((s) => s.visibility === "public");

  if (error) return <div className="mt-8"><ErrorNote>{error}</ErrorNote></div>;

  return (
    <div className="mt-8 space-y-12">
      {/* Yours */}
      {(followed.length > 0 || privateSpaces.length > 0) && (
        <section>
          <p className={eyebrowClass}>Your spaces</p>
          <ul className="mt-3 flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
            {[...privateSpaces, ...followed].map((s) => (
              <li key={s.id} className="shrink-0">
                <Link href={`/spaces/${s.slug}`} className="flex w-56 items-center gap-3 rounded-xl border border-ink bg-panel p-3 transition">
                  <SpaceIcon space={s} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block truncate font-mono text-[10px] text-muted">
                      {s.visibility === "private" ? (s.mine ? "Private · yours" : "Private") : "Subject"} · {s.questions} {s.questions === 1 ? "question" : "questions"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Subjects */}
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={eyebrowClass}>Subjects</p>
            <h2 className="mt-1 font-serif text-3xl tracking-tight">Every subject has a space</h2>
            <p className="mt-1 max-w-xl text-sm text-muted">Follow the ones you study. Anyone signed in can read and ask; asking in one follows it for you.</p>
          </div>
          <label className="relative block sm:w-64">
            <span className="sr-only">Find a subject</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a subject"
              className="w-full rounded-xl border border-ink/20 bg-panel py-2 pr-3 pl-9 text-sm outline-none transition placeholder:text-muted/70 hover:border-ink/50 focus:border-ink focus:shadow-hard-sm"
            />
          </label>
        </div>

        {subjects === null ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton h-36 rounded-2xl" />
            ))}
          </div>
        ) : subjects.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-ink/40 px-6 py-10 text-center text-sm text-muted">
            No subjects yet. They arrive with migration 0038.
          </p>
        ) : groups.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-ink/40 px-6 py-10 text-center text-sm text-muted">No subject matches “{filter}”.</p>
        ) : (
          <div className="mt-6 space-y-8">
            {groups.map(([category, list]) => (
              <div key={category}>
                <h3 className="flex items-center gap-3 font-mono text-[11px] font-medium tracking-[0.12em] text-muted uppercase">
                  {category}
                  <span className="h-px flex-1 bg-line" />
                </h3>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((s, i) => (
                    <SubjectCard key={s.id} space={s} delay={i * 30} onToggle={() => void toggle(s)} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Private */}
      <section className="grid grid-cols-[minmax(0,1fr)] gap-6 rounded-3xl border border-ink bg-yellow-100 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <p className={eyebrowClass}>Private spaces</p>
          <h2 className="mt-1 font-serif text-3xl tracking-tight">A space just for your group</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
            Your class, your lab, your study group. Only people with the link can join, and nothing in it shows up in public threads. For a shared timer and voice, use a{" "}
            <Link href="/rooms" className="font-medium text-ink underline underline-offset-4">
              study room
            </Link>{" "}
            instead.
          </p>
          {privateSpaces.length > 0 && (
            <ul className="mt-5 space-y-2">
              {privateSpaces.map((s) => (
                <li key={s.id}>
                  <Link href={`/spaces/${s.slug}`} className="flex items-center gap-3 rounded-xl border border-ink bg-panel px-3 py-2.5 transition">
                    <SpaceIcon space={s} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted">
                      {s.members} {s.members === 1 ? "person" : "people"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <CreateSpace onCreated={(slug) => router.push(`/spaces/${slug}`)} />
      </section>
    </div>
  );
}

function SubjectCard({ space: s, delay, onToggle }: { space: SpaceCard; delay: number; onToggle: () => void }) {
  return (
    <li className="animate-enter" style={{ animationDelay: `${delay}ms` }}>
      <div className="group relative flex h-full flex-col rounded-2xl border border-ink bg-panel p-4 transition">
        <div className="flex items-start gap-3">
          <SpaceIcon space={s} />
          <div className="min-w-0 flex-1">
            <Link href={`/spaces/${s.slug}`} className="block truncate font-medium after:absolute after:inset-0 after:rounded-2xl">
              {s.name}
            </Link>
            <p className="font-mono text-[10px] text-muted">
              {s.members} following · {s.questions} {s.questions === 1 ? "question" : "questions"}
            </p>
          </div>
          {/* Above the card's link. */}
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={s.joined}
            className={`relative z-10 shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium transition active:scale-95 ${s.joined ? "border-ink bg-ink text-white hover:bg-panel hover:text-ink" : "border-ink/30 hover:border-ink"}`}
          >
            {s.joined ? "Following" : "Follow"}
          </button>
        </div>
        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted">{s.about}</p>
        {s.thisWeek > 0 && <p className="mt-auto pt-3 text-[11px] font-medium text-ok">{s.thisWeek} new this week</p>}
      </div>
    </li>
  );
}

function CreateSpace({ onCreated }: { onCreated: (slug: string) => void }) {
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Give the space a short name.");
    setPending(true);
    try {
      const made = await createSpace(name, about);
      track("space.create");
      onCreated(made.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make that.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={create} className="h-fit space-y-3 rounded-2xl border border-ink bg-panel p-5 shadow-hard-sm">
      <p className="font-medium">New private space</p>
      <label className="block">
        <span className={labelClass}>Name</span>
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Physics 101, Tuesday group" className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>What it&apos;s for</span>
        <textarea value={about} maxLength={500} rows={3} onChange={(e) => setAbout(e.target.value)} placeholder="Optional. Who it's for, and what you're working through." className={`${inputClass} resize-y`} />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={pending} className={`${buttonClass} w-full`}>
        {pending ? "Creating…" : "Create and get the link"}
      </button>
    </form>
  );
}

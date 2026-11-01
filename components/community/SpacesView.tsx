"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { buttonClass, eyebrowClass, inputClass, labelClass } from "@/components/ui";
import { createSpace, loadSpaces, type SpaceCard } from "@/lib/community";
import { track } from "@/lib/telemetry";

export function SpacesView() {
  const router = useRouter();
  const [spaces, setSpaces] = useState<SpaceCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadSpaces().then(
      (next) => {
        if (live) setSpaces(next);
      },
      (err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Couldn't load your spaces.");
      },
    );
    return () => {
      live = false;
    };
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (name.trim().length < 2) {
      setFormError("Give the space a short name.");
      return;
    }
    setPending(true);
    try {
      const made = await createSpace(name, about);
      track("space.create");
      router.push(`/spaces/${made.slug}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't make that.");
      setPending(false);
    }
  }

  if (error) return <p className="mt-8 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p>;
  if (!spaces) {
    return (
      <div className="mt-8 space-y-3">
        <div className="skeleton h-36 rounded-2xl" />
        <div className="skeleton h-24 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section>
        <p className={eyebrowClass}>Yours</p>
        {spaces.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-ink/40 px-4 py-8 text-center text-sm text-muted">
            No spaces yet. Make one and send the link to the people you study with.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {spaces.map((space) => (
              <li key={space.id}>
                <Link href={`/spaces/${space.slug}`} className="block rounded-2xl border border-ink bg-panel p-4 transition hover:-translate-y-px hover:shadow-hard-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-serif text-xl">{space.name}</span>
                    {space.mine && <span className="rounded bg-yellow-300 px-1.5 py-px font-mono text-[10px] uppercase">Yours</span>}
                  </span>
                  {space.about && <span className="mt-1 block line-clamp-2 text-sm text-muted">{space.about}</span>}
                  <span className="mt-3 block font-mono text-[11px] text-muted">
                    {space.members} {space.members === 1 ? "person" : "people"} · {space.questions} {space.questions === 1 ? "question" : "questions"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <form onSubmit={create} className="h-fit space-y-3 rounded-2xl border border-ink bg-panel p-4">
        <p className={eyebrowClass}>New space</p>
        <label className="block">
          <span className={labelClass}>Name</span>
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Tuesday study group" className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>What it&apos;s for</span>
          <textarea
            value={about}
            maxLength={500}
            rows={3}
            onChange={(e) => setAbout(e.target.value)}
            placeholder="Optional. Who it's for, and what you're working through."
            className={`${inputClass} resize-y`}
          />
        </label>
        {formError && <p className="text-sm text-danger">{formError}</p>}
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Creating…" : "Create space"}
        </button>
        <p className="text-xs leading-relaxed text-muted">
          Only people with the link can join. Questions stay in the space. Public questions live on{" "}
          <Link href="/threads" className="font-medium text-ink underline underline-offset-4">
            Threads
          </Link>
          .
        </p>
      </form>
    </div>
  );
}

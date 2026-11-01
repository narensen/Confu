"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { QuestionForm } from "@/components/community/QuestionForm";
import { ThreadList } from "@/components/community/ThreadList";
import { ask, toast } from "@/components/dialogs";
import { buttonClass, eyebrowClass, ghostButtonClass } from "@/components/ui";
import { deleteSpace, joinSpace, leaveSpace, loadSpace, type SpaceState } from "@/lib/community";
import { SITE } from "@/lib/site";
import { track } from "@/lib/telemetry";

export function SpaceView({ slug }: { slug: string }) {
  const router = useRouter();
  const [space, setSpace] = useState<SpaceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reload = () =>
    loadSpace(slug).then(
      (next) => {
        setSpace(next);
        setError(null);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : "Couldn't open that space."),
    );

  useEffect(() => {
    let live = true;
    void loadSpace(slug).then(
      (next) => {
        if (live) setSpace(next);
      },
      (err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Couldn't open that space.");
      },
    );
    return () => {
      live = false;
    };
  }, [slug]);

  async function join() {
    setPending(true);
    try {
      const next = await joinSpace(slug);
      track("space.join");
      setSpace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join.");
    } finally {
      setPending(false);
    }
  }

  async function leave() {
    if (!(await ask({ title: "Leave this space?", body: "You can join again with the link.", confirm: "Leave" }))) return;
    try {
      await leaveSpace(slug);
      router.push("/spaces");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't leave.");
    }
  }

  async function remove() {
    if (!(await ask({ title: "Delete this space?", body: "The link stops working, and the questions go with it.", confirm: "Delete", danger: true }))) return;
    try {
      await deleteSpace(slug);
      router.push("/spaces");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete it.");
    }
  }

  if (error) return <p className="mt-8 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p>;
  if (!space) return <div className="skeleton mt-8 h-64 rounded-2xl" />;

  const link = `${SITE.url}/spaces/${space.slug}`;

  return (
    <div className="mt-8 space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className={eyebrowClass}>Learning space</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight">{space.name}</h1>
          {space.about && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{space.about}</p>}
          <p className="mt-2 font-mono text-[11px] text-muted">
            {space.members} {space.members === 1 ? "person" : "people"} · {space.questions} {space.questions === 1 ? "question" : "questions"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {space.joined && (
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(link).then(() => toast("Link copied."))}
              className={ghostButtonClass}
            >
              Copy link
            </button>
          )}
          {space.mine ? (
            <button type="button" onClick={() => void remove()} className="text-sm text-muted underline underline-offset-2 hover:text-danger hover:underline">
              Delete
            </button>
          ) : space.joined ? (
            <button type="button" onClick={() => void leave()} className="text-sm text-muted underline underline-offset-2 hover:text-ink hover:underline">
              Leave
            </button>
          ) : null}
        </div>
      </div>

      {!space.joined ? (
        <div className="rounded-2xl border border-ink bg-yellow-100 p-5">
          <p className="font-serif text-2xl">This space is private</p>
          <p className="mt-1 max-w-lg text-sm leading-relaxed text-muted">Join to see the questions and ask your own. Nothing here shows up on the public threads.</p>
          <button type="button" onClick={() => void join()} disabled={pending} className={`${buttonClass} mt-4`}>
            {pending ? "Joining…" : "Join this space"}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <QuestionForm
            spaceId={space.id}
            onPosted={() => {
              void reload();
            }}
          />
          <ThreadList threads={space.threads} empty="Nothing here yet. Ask the first question." />
          {space.questions > space.threads.length && (
            <p className="text-xs text-muted">Showing the latest {space.threads.length}.</p>
          )}
        </div>
      )}

      <p className="text-sm text-muted">
        <Link href="/spaces" className="underline underline-offset-4 hover:text-ink">
          Your spaces
        </Link>
        <span aria-hidden> · </span>
        <Link href="/threads" className="underline underline-offset-4 hover:text-ink">
          Public threads
        </Link>
      </p>
    </div>
  );
}

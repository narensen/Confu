"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AskButton, ErrorNote, SpaceIcon } from "@/components/community/kit";
import { ThreadBrowser } from "@/components/community/ThreadBrowser";
import { ask, toast } from "@/components/dialogs";
import { buttonClass, eyebrowClass, ghostButtonClass } from "@/components/ui";
import { deleteSpace, joinSpace, leaveSpace, loadSpace, type SpaceState } from "@/lib/community";
import { SITE } from "@/lib/site";
import { track } from "@/lib/telemetry";

// One space: a public subject (read freely, follow to keep it close) or a
// private group (join with the link to see anything).
export function SpaceView({ slug }: { slug: string }) {
  const router = useRouter();
  const [space, setSpace] = useState<SpaceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
      track(next.visibility === "public" ? "space.follow" : "space.join", { slug });
      setSpace(next);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't join.", "error");
    } finally {
      setPending(false);
    }
  }

  async function leave() {
    if (space?.visibility === "private" && !(await ask({ title: "Leave this space?", body: "You can join again with the link.", confirm: "Leave" }))) return;
    setPending(true);
    try {
      await leaveSpace(slug);
      if (space?.visibility === "private") router.push("/spaces");
      else setSpace((s) => (s ? { ...s, joined: false, members: Math.max(0, s.members - 1) } : s));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't leave.", "error");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!(await ask({ title: "Delete this space?", body: "The link stops working, and its questions go with it.", confirm: "Delete", danger: true }))) return;
    try {
      await deleteSpace(slug);
      router.push("/spaces");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't delete it.", "error");
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <ErrorNote>{error}</ErrorNote>
        <Link href="/spaces" className={ghostButtonClass}>
          ← All spaces
        </Link>
      </div>
    );
  }
  if (!space) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-40 rounded-3xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }

  const isPublic = space.visibility === "public";
  const readable = isPublic || space.joined;
  const link = `${SITE.url}/spaces/${space.slug}`;

  return (
    <div className="animate-enter space-y-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted">
        <Link href="/threads" className="hover:text-ink">
          Threads
        </Link>
        <span aria-hidden>›</span>
        <Link href="/spaces" className="hover:text-ink">
          Spaces
        </Link>
      </nav>

      <header className={`relative overflow-hidden rounded-3xl border border-ink p-6 sm:p-8 ${isPublic ? "bg-panel" : "bg-yellow-100"}`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <SpaceIcon space={space} size="lg" />
          <div className="min-w-0 flex-1">
            <p className={eyebrowClass}>{isPublic ? space.category || "Subject" : space.mine ? "Your private space" : "Private space"}</p>
            <h1 className="mt-1 font-serif text-4xl leading-tight tracking-tight">{space.name}</h1>
            {space.about && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{space.about}</p>}
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
              <span>
                {space.members} {isPublic ? "following" : space.members === 1 ? "member" : "members"}
              </span>
              <span>
                {space.questions} {space.questions === 1 ? "question" : "questions"}
              </span>
              {isPublic && <span>Open to everyone signed in</span>}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {readable && <AskButton spaceId={space.id} onPosted={(id) => router.push(`/threads/${id}`)} />}
            {isPublic ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void (space.joined ? leave() : join())}
                aria-pressed={space.joined}
                className={space.joined ? ghostButtonClass : buttonClass}
              >
                {space.joined ? "Following" : "Follow"}
              </button>
            ) : space.joined ? (
              <button type="button" onClick={() => navigator.clipboard.writeText(link).then(() => toast("Invite link copied."))} className={ghostButtonClass}>
                Copy invite link
              </button>
            ) : null}
          </div>
        </div>
        {!isPublic && space.joined && (
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ink/15 pt-4 text-xs text-muted">
            <span>Only people with the link can join. Nothing here appears in public threads.</span>
            {space.mine ? (
              <button type="button" onClick={() => void remove()} className="font-medium underline underline-offset-2 hover:text-danger">
                Delete space
              </button>
            ) : (
              <button type="button" onClick={() => void leave()} className="font-medium underline underline-offset-2 hover:text-ink">
                Leave space
              </button>
            )}
          </div>
        )}
      </header>

      {readable ? (
        <ThreadBrowser space={space.slug} showSpace={false} />
      ) : (
        <div className="rounded-3xl border border-ink bg-panel px-6 py-12 text-center">
          <p aria-hidden className="text-3xl">
            🔒
          </p>
          <p className="mt-2 font-serif text-2xl">This space is private</p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted">You have the link, so you can join. Then you&apos;ll see its questions and can ask your own.</p>
          <button type="button" onClick={() => void join()} disabled={pending} className={`${buttonClass} mt-5`}>
            {pending ? "Joining…" : "Join this space"}
          </button>
        </div>
      )}
    </div>
  );
}

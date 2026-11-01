"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ask } from "@/components/dialogs";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { ago } from "@/lib/format-usage";
import { deletePost, loadThread, replyThread, type ThreadDetail } from "@/lib/community";
import { track } from "@/lib/telemetry";

export function ThreadView({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = () =>
    loadThread(id).then(
      (next) => {
        setData(next);
        setError(null);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load that question."),
    );

  useEffect(() => {
    let live = true;
    void loadThread(id).then(
      (next) => {
        if (live) setData(next);
      },
      (err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Couldn't load that question.");
      },
    );
    return () => {
      live = false;
    };
  }, [id]);

  async function reply(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!body.trim()) {
      setFormError("Write a reply first.");
      return;
    }
    setPending(true);
    try {
      await replyThread(id, body);
      track("thread.reply");
      setBody("");
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't post that.");
    } finally {
      setPending(false);
    }
  }

  async function remove(postId: string, thread: boolean) {
    const ok = await ask({
      title: thread ? "Remove this question?" : "Remove this reply?",
      body: thread ? "The replies go with it." : undefined,
      confirm: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePost(postId);
      if (thread) router.push(data?.thread.space_slug ? `/spaces/${data.thread.space_slug}` : "/threads");
      else await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't remove that.");
    }
  }

  if (error) return <p className="mt-8 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p>;
  if (!data) return <div className="skeleton mt-8 h-64 rounded-2xl" />;

  const { thread, replies } = data;
  return (
    <div className="mt-8 space-y-8">
      <p className="text-sm">
        {thread.space_slug ? (
          <Link href={`/spaces/${thread.space_slug}`} className="text-muted underline underline-offset-4 hover:text-ink">
            {thread.space_name || "Space"}
          </Link>
        ) : (
          <Link href="/threads" className="text-muted underline underline-offset-4 hover:text-ink">
            All threads
          </Link>
        )}
      </p>
      <article>
        <p className={eyebrowClass}>{thread.space_slug ? "In a space" : "Thread"}</p>
        <h1 className="mt-1 font-serif text-4xl tracking-tight">{thread.title}</h1>
        <p className="mt-2 font-mono text-[11px] text-muted">
          {thread.author} · {ago(thread.created_at)}
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed whitespace-pre-wrap break-words">{thread.body}</p>
        {thread.mine && (
          <button type="button" onClick={() => void remove(thread.id, true)} className="mt-3 text-xs text-muted underline underline-offset-2 hover:text-danger hover:underline">
            Remove
          </button>
        )}
      </article>
      <section className="space-y-3">
        <p className={eyebrowClass}>{replies.length} {replies.length === 1 ? "reply" : "replies"}</p>
        {replies.map((reply) => (
          <article key={reply.id} className="rounded-2xl border border-ink bg-panel p-4">
            <p className="font-mono text-[11px] text-muted">
              {reply.author} · {ago(reply.created_at)}
            </p>
            <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap break-words">{reply.body}</p>
            {reply.mine && (
              <button type="button" onClick={() => void remove(reply.id, false)} className="mt-2 text-xs text-muted underline underline-offset-2 hover:text-danger hover:underline">
                Remove
              </button>
            )}
          </article>
        ))}
        <form onSubmit={reply} className="space-y-3 rounded-2xl border border-ink bg-panel p-4">
          <label className="block">
            <span className="sr-only">Reply</span>
            <textarea
              value={body}
              maxLength={8000}
              rows={3}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Your answer"
              className={`${inputClass} resize-y`}
            />
          </label>
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={buttonClass}>
              {pending ? "Posting…" : "Reply"}
            </button>
            <Link href={thread.space_slug ? `/spaces/${thread.space_slug}` : "/threads"} className={ghostButtonClass}>
              Back
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}

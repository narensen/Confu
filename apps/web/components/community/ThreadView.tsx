"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, ErrorNote, MarkdownField, SpaceChip, SpaceIcon, VoteButton } from "@/components/community/kit";
import { ask, toast } from "@/components/dialogs";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { Markdown } from "@confu/ui/Markdown";
import { ago } from "@/lib/format-usage";
import { acceptReply, deletePost, editPost, loadThread, replyThread, reportPost, requestChecks, type PostCheck, type ReportReason, type ThreadDetail, type ThreadReply } from "@/lib/community";
import { SITE } from "@/lib/site";
import { track } from "@/lib/telemetry";

const linkClass = "text-xs font-medium text-muted transition hover:text-ink";

export function ThreadView({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [replySort, setReplySort] = useState<"oldest" | "top">("oldest");
  // Which post is being edited (the thread's id, or a reply's).
  const [editing, setEditing] = useState<string | null>(null);
  const checkTries = useRef(new Map<string, number>());

  const reload = useCallback(
    () =>
      loadThread(id).then(
        (next) => {
          setData(next);
          setError(null);
        },
        (err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load that question."),
      ),
    [id],
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

  // Posts still waiting on the check (new, edited, or reported as wrong).
  // Two looks is enough: the database claims each post once, and a second
  // pass picks up a check that finished after the page loaded.
  useEffect(() => {
    if (!data) return;
    const pending = [data.thread, ...data.replies]
      .filter((p) => p.check?.status === "pending" && (checkTries.current.get(p.id) ?? 0) < 2)
      .map((p) => p.id)
      .slice(0, 5);
    if (!pending.length) return;
    for (const postId of pending) checkTries.current.set(postId, (checkTries.current.get(postId) ?? 0) + 1);
    let live = true;
    void requestChecks(pending).then((results) => {
      if (live && Object.keys(results).length) void reload();
    });
    const timer = window.setTimeout(() => {
      if (live) void reload();
    }, 4000);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [data, reload]);

  async function reply() {
    setFormError(null);
    if (!body.trim()) return setFormError("Write a reply first.");
    setPending(true);
    try {
      await replyThread(id, body);
      track("thread.reply");
      setBody("");
      await reload();
      window.setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }), 50);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't post that.");
    } finally {
      setPending(false);
    }
  }

  async function remove(postId: string, isThread: boolean) {
    const ok = await ask({
      title: isThread ? "Delete this question?" : "Delete this reply?",
      body: isThread ? "Its replies go with it." : undefined,
      confirm: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePost(postId);
      if (isThread) router.push(data?.thread.space ? `/spaces/${data.thread.space.slug}` : "/threads");
      else await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't delete that.", "error");
    }
  }

  async function accept(replyId: string) {
    try {
      const accepted = await acceptReply(id, replyId);
      track("thread.accept", { on: Boolean(accepted) });
      setData((d) => (d ? { thread: { ...d.thread, solved: Boolean(accepted) }, replies: d.replies.map((r) => ({ ...r, accepted: r.id === accepted })) } : d));
      if (accepted) toast("Marked as the answer. Thanks for closing the loop.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't mark that.", "error");
    }
  }

  if (error) {
    return (
      <div className="mt-8 space-y-4">
        <ErrorNote>{error}</ErrorNote>
        <Link href="/threads" className={ghostButtonClass}>
          ← All questions
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mt-8 space-y-4">
        <div className="skeleton h-5 w-40 rounded" />
        <div className="skeleton h-12 w-3/4 rounded" />
        <div className="skeleton h-40 rounded-2xl" />
        <div className="skeleton h-28 rounded-2xl" />
      </div>
    );
  }

  const { thread, replies } = data;
  const accepted = replies.find((r) => r.accepted);
  const ordered = [...replies]
    .filter((r) => !r.accepted)
    .sort((a, b) => (replySort === "top" ? b.votes - a.votes || a.created_at.localeCompare(b.created_at) : a.created_at.localeCompare(b.created_at)));
  const backHref = thread.space ? `/spaces/${thread.space.slug}` : "/threads";

  return (
    <div className="animate-enter mt-6 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
          <Link href="/threads" className="hover:text-ink">
            Threads
          </Link>
          {thread.space && (
            <>
              <span aria-hidden>›</span>
              <Link href={`/spaces/${thread.space.slug}`} className="flex items-center gap-1 hover:text-ink">
                <span aria-hidden>{thread.space.icon || "🔒"}</span>
                {thread.space.name}
              </Link>
            </>
          )}
        </nav>

        {/* The question */}
        <article className="mt-4">
          {editing === thread.id ? (
            <PostEditor
              title={thread.title}
              body={thread.body}
              onCancel={() => setEditing(null)}
              onSave={async (nextBody, nextTitle) => {
                await editPost(thread.id, nextBody, nextTitle);
                setEditing(null);
                await reload();
              }}
            />
          ) : (
            <>
              <div className="flex items-start gap-3">
                <h1 className="min-w-0 flex-1 font-serif text-3xl leading-tight tracking-tight sm:text-4xl">{thread.title}</h1>
                {thread.solved && (
                  <span className="mt-2 inline-flex shrink-0 items-center gap-1 rounded-full border border-ok/50 bg-ok/10 px-2.5 py-1 text-xs font-medium text-ok">
                    <Check /> Answered
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
                <span className="flex items-center gap-2">
                  <Avatar name={thread.author} me={thread.mine} />
                  <span className="font-medium text-ink">{thread.mine ? "You" : thread.author}</span>
                </span>
                <span>asked {ago(thread.created_at)}</span>
                {thread.edited && <span className="text-xs">· edited</span>}
                {thread.space && <SpaceChip space={thread.space} />}
              </div>
              <div className="mt-6 rounded-2xl border border-ink bg-panel p-5 sm:p-6">
                <Markdown content={thread.body} />
                <CheckNote check={thread.check} />
                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                  <VoteButton postId={thread.id} votes={thread.votes} voted={thread.voted} mine={thread.mine} />
                  <button
                    type="button"
                    className={linkClass}
                    onClick={() => navigator.clipboard.writeText(`${SITE.url}/threads/${thread.id}`).then(() => toast("Link copied."))}
                  >
                    Share
                  </button>
                  {thread.mine ? (
                    <>
                      <button type="button" className={linkClass} onClick={() => setEditing(thread.id)}>
                        Edit
                      </button>
                      <button type="button" className={`${linkClass} hover:text-danger`} onClick={() => void remove(thread.id, true)}>
                        Delete
                      </button>
                    </>
                  ) : (
                    <ReportControl id={thread.id} reported={thread.reported} onChange={() => void reload()} />
                  )}
                </div>
              </div>
            </>
          )}
        </article>

        {/* Replies */}
        <section className="mt-10" aria-label="Replies">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-serif text-2xl">
              {replies.length} {replies.length === 1 ? "reply" : "replies"}
            </h2>
            {replies.length > 2 && (
              <div className="flex gap-1 rounded-lg border border-ink/20 bg-panel p-0.5 text-xs">
                {(["oldest", "top"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setReplySort(s)} aria-pressed={replySort === s} className={`rounded-md px-2.5 py-1 font-medium capitalize transition ${replySort === s ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          {thread.mine && replies.length > 0 && !thread.solved && (
            <p className="mt-2 text-sm text-muted">Did one of these answer it? Press <b className="text-ink">Mark as answer</b> on it, so the next person finds it first.</p>
          )}

          <ul className="mt-4 space-y-3">
            {[...(accepted ? [accepted] : []), ...ordered].map((r) => (
              <ReplyCard
                key={r.id}
                reply={r}
                canAccept={thread.mine}
                editing={editing === r.id}
                onEdit={() => setEditing(r.id)}
                onCancelEdit={() => setEditing(null)}
                onSave={async (nextBody) => {
                  await editPost(r.id, nextBody);
                  setEditing(null);
                  await reload();
                }}
                onAccept={() => void accept(r.id)}
                onDelete={() => void remove(r.id, false)}
                onReport={() => void reload()}
              />
            ))}
          </ul>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void reply();
            }}
            className="mt-6 rounded-2xl border border-ink bg-panel p-4 sm:p-5"
          >
            <p className="mb-2.5 font-medium">Your reply</p>
            <MarkdownField value={body} onChange={setBody} rows={5} label="Your reply" placeholder="Explain it the way you'd want it explained. Show the step that made it click." />
            {formError && <p className="mt-2 text-sm text-danger">{formError}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="submit" disabled={pending} className={buttonClass}>
                {pending ? "Posting…" : "Post reply"}
              </button>
              <Link href={backHref} className={ghostButtonClass}>
                Back
              </Link>
              {thread.space?.visibility === "public" && !thread.joined && <span className="text-xs text-muted">Replying follows {thread.space.name}.</span>}
            </div>
          </form>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        {thread.space && (
          <Link href={`/spaces/${thread.space.slug}`} className="block rounded-2xl border border-ink bg-panel p-4 transition hover:-translate-y-px hover:shadow-hard-sm">
            <span className="flex items-center gap-3">
              <SpaceIcon space={thread.space} />
              <span className="min-w-0">
                <span className={`${eyebrowClass} block`}>{thread.space.visibility === "public" ? "Subject" : "Private space"}</span>
                <span className="block truncate font-medium">{thread.space.name}</span>
              </span>
            </span>
            <span className="mt-3 block text-xs text-muted">See more questions here →</span>
          </Link>
        )}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-ink bg-line text-sm">
          {[
            ["Asked", ago(thread.created_at)],
            ["Active", ago(thread.activity_at)],
            ["Replies", String(replies.length)],
            ["Helpful", String(thread.votes)],
          ].map(([k, v]) => (
            <div key={k} className="bg-panel px-3 py-2.5">
              <dt className="font-mono text-[10px] tracking-wider text-muted uppercase">{k}</dt>
              <dd className="mt-0.5 truncate font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="px-1 text-xs leading-relaxed text-muted">
          Threads are people helping people. For an answer from your own notes, open a session and ask the tutor.
        </p>
      </aside>
    </div>
  );
}

function ReplyCard({
  reply: r,
  canAccept,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onAccept,
  onDelete,
  onReport,
}: {
  reply: ThreadReply;
  canAccept: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (body: string) => Promise<void>;
  onAccept: () => void;
  onDelete: () => void;
  onReport: () => void;
}) {
  return (
    <li className={`animate-enter rounded-2xl border bg-panel p-4 sm:p-5 ${r.accepted ? "border-ok shadow-[3px_3px_0_0_var(--ok)]" : "border-ink"}`}>
      {r.accepted && (
        <p className="mb-3 inline-flex items-center gap-1 rounded-full bg-ok/10 px-2.5 py-0.5 text-xs font-medium text-ok">
          <Check /> Accepted answer
        </p>
      )}
      <div className="flex items-center gap-2 text-sm">
        <Avatar name={r.author} size="sm" me={r.mine} />
        <span className="font-medium">{r.mine ? "You" : r.author}</span>
        <span className="text-xs text-muted">
          {ago(r.created_at)}
          {r.edited ? " · edited" : ""}
        </span>
      </div>
      {editing ? (
        <div className="mt-3">
          <PostEditor body={r.body} onCancel={onCancelEdit} onSave={(body) => onSave(body)} />
        </div>
      ) : (
        <>
          <div className="mt-3">
            {r.check?.status === "corrected" && r.check.fix ? (
              <>
                <p className="mb-2 text-xs font-medium text-ok">Corrected · Confu found a mistake in this reply</p>
                {r.check.note && <p className="mb-3 text-sm text-muted">{r.check.note}</p>}
                <Markdown content={r.check.fix} />
                <OriginalToggle body={r.body} />
              </>
            ) : (
              <>
                <Markdown content={r.body} />
                <CheckNote check={r.check} />
              </>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <VoteButton postId={r.id} votes={r.votes} voted={r.voted} mine={r.mine} />
            {canAccept && (
              <button
                type="button"
                onClick={onAccept}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition ${r.accepted ? "border-ok bg-ok/10 text-ok" : "border-ink/25 text-muted hover:border-ok hover:text-ok"}`}
              >
                <Check /> {r.accepted ? "Answer (undo)" : "Mark as answer"}
              </button>
            )}
            {r.mine ? (
              <>
                <button type="button" className={linkClass} onClick={onEdit}>
                  Edit
                </button>
                <button type="button" className={`${linkClass} hover:text-danger`} onClick={onDelete}>
                  Delete
                </button>
              </>
            ) : (
              <ReportControl id={r.id} reported={r.reported} onChange={onReport} />
            )}
          </div>
        </>
      )}
    </li>
  );
}

// Editing a question (title and details) or a reply (details only).
function PostEditor({ title, body, onSave, onCancel }: { title?: string; body: string; onSave: (body: string, title?: string) => Promise<void>; onCancel: () => void }) {
  const [nextTitle, setNextTitle] = useState(title ?? "");
  const [nextBody, setNextBody] = useState(body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSave(nextBody, title === undefined ? undefined : nextTitle);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't save that.");
          setBusy(false);
        }
      }}
      className="space-y-3"
    >
      {title !== undefined && <input value={nextTitle} maxLength={160} onChange={(e) => setNextTitle(e.target.value)} aria-label="Question" className={`${inputClass} font-serif text-xl`} />}
      <MarkdownField value={nextBody} onChange={setNextBody} rows={6} autoFocus={title === undefined} placeholder="Details" />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={buttonClass}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className={ghostButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CheckNote({ check }: { check: PostCheck | null }) {
  if (!check || check.status === "pending" || check.status === "corrected") return null;
  const hidden = check.status === "hidden";
  return (
    <div className={`mt-4 rounded-xl border px-3 py-2.5 text-sm ${hidden ? "border-danger/40 bg-danger/5 text-danger" : "border-yellow-600/40 bg-yellow-100"}`}>
      <p className="text-xs font-medium">{hidden ? "Hidden for review" : "This may be wrong"}</p>
      {check.note && <p className={`mt-1 ${hidden ? "" : "text-ink"}`}>{check.note}</p>}
    </div>
  );
}

function OriginalToggle({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-muted underline decoration-ink/30 underline-offset-2 hover:text-ink">
        {open ? "Hide the original" : "Show the original"}
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-muted">
          <Markdown content={body} />
        </div>
      )}
    </div>
  );
}

function ReportControl({ id, reported, onChange }: { id: string; reported: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (reported) return <span className="text-xs text-muted">Reported</span>;
  if (!open) {
    return (
      <button type="button" className={linkClass} onClick={() => setOpen(true)}>
        Report
      </button>
    );
  }
  async function send(reason: ReportReason) {
    setBusy(true);
    try {
      await reportPost(id, reason);
      toast(reason === "wrong" ? "Reported. Confu will look at it again." : "Reported. Thanks for flagging it.");
      onChange();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't report that.", "error");
      setBusy(false);
    }
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted">Report as</span>
      {(["wrong", "spam", "abuse"] as const).map((reason) => (
        <button key={reason} type="button" disabled={busy} onClick={() => void send(reason)} className={`${linkClass} capitalize`}>
          {reason}
        </button>
      ))}
      <button type="button" className={linkClass} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

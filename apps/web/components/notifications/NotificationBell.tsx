"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { notify, toast, type NotifyAction } from "@/components/dialogs";
import { plainExcerpt } from "@/lib/community";
import { ago } from "@/lib/format-usage";
import { respondFriend } from "@/lib/friends";
import { loadNotices, readNotices, watchNotices, type Notice } from "@/lib/notifications";

// The bell in the header: a count of what's new, a panel on the right with
// everything, and a card that slides in on the right when something arrives
// (with Accept or Join right there).

const SEEN_KEY = "confu:notices-seen";

function seenAt() {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markSeen(iso: string) {
  try {
    if (Date.parse(iso) > seenAt()) localStorage.setItem(SEEN_KEY, String(Date.parse(iso)));
  } catch {}
}

export function NotificationBell({ userId }: { userId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  // What was unread when the panel opened: still shown as new while it's open.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const busy = useRef<Set<string>>(new Set());

  const act = useCallback(
    async (n: Notice, accept: boolean) => {
      const id = typeof n.data.friendship_id === "string" ? n.data.friendship_id : null;
      if (!id || busy.current.has(n.id)) return;
      busy.current.add(n.id);
      try {
        await respondFriend(id, accept);
        await readNotices([n.id]);
        toast(accept ? `You and ${n.actor ?? "them"} are friends now.` : "Request declined.");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Couldn't answer that request.", "error");
      } finally {
        busy.current.delete(n.id);
      }
    },
    [],
  );

  const actionsFor = useCallback(
    (n: Notice): NotifyAction[] => {
      if (n.kind === "friend_request" && !n.read) {
        return [
          { label: "Accept", primary: true, onClick: () => act(n, true) },
          { label: "Decline", onClick: () => act(n, false) },
        ];
      }
      if (n.kind === "room_invite" && n.url) return [{ label: "Join the room", primary: true, href: n.url }];
      if (n.url) return [{ label: n.kind === "friend_accepted" ? "See friends" : "Open", href: n.url }];
      return [];
    },
    [act],
  );

  // Load, and pop a card for anything new since you last looked.
  const sync = useCallback(
    async (pop: boolean) => {
      const got = await loadNotices();
      if (!got) return;
      setNotices(got.notices);
      setUnread(got.unread);
      const since = seenAt();
      const arrived = got.notices.filter((n) => !n.read && Date.parse(n.created_at) > since && Date.now() - Date.parse(n.created_at) < 10 * 60_000);
      if (got.notices[0]) markSeen(got.notices[0].created_at);
      if (!pop) return;
      for (const n of arrived.slice(0, 3).reverse()) {
        notify({
          title: n.title,
          body: plainExcerpt(n.body, 160),
          avatar: n.actor ?? undefined,
          icon: n.actor ? undefined : <KindIcon kind={n.kind} />,
          tone: n.kind === "post_hidden" ? "error" : n.kind === "friend_accepted" || n.kind === "reply_accepted" ? "success" : "info",
          href: n.url || undefined,
          actions: actionsFor(n),
          duration: n.kind === "friend_request" || n.kind === "room_invite" ? 15_000 : 9000,
        });
      }
    },
    [actionsFor],
  );

  useEffect(() => {
    let live = true;
    const run = (pop: boolean) => {
      if (live) void sync(pop);
    };
    run(true);
    const off = watchNotices(userId, () => run(true));
    const poll = window.setInterval(() => run(true), 60_000);
    const onVisible = () => document.visibilityState === "visible" && run(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      off();
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, sync]);

  // Opening the panel clears the count; closing it, or going elsewhere, closes it.
  async function show() {
    setFresh(new Set((notices ?? []).filter((n) => !n.read).map((n) => n.id)));
    setOpen(true);
    if (unread) setUnread(await readNotices());
  }
  const [openedOn, setOpenedOn] = useState(pathname);
  if (open && openedOn !== pathname) {
    setOpen(false);
    setOpenedOn(pathname);
  } else if (!open && openedOn !== pathname) setOpenedOn(pathname);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : void show())}
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        aria-expanded={open}
        className="relative flex size-9 items-center justify-center rounded-full border border-ink/20 bg-paper/70 text-muted transition hover:text-ink aria-expanded:border-ink/40 aria-expanded:text-ink"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8.5 3 8.5H3S6 15 6 8" />
          <path d="M10.3 20a1.9 1.9 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full border border-ink bg-yellow-300 px-1 font-mono text-[9px] leading-[14px] font-medium">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 top-14 z-[65]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
            <aside
              role="dialog"
              aria-label="Notifications"
              className="animate-notify absolute top-0 right-0 bottom-0 flex w-[min(26rem,100vw)] flex-col border-l border-ink bg-panel"
            >
              <div className="flex items-center justify-between gap-3 border-b border-ink px-5 py-3.5">
                <p className="font-serif text-xl">Notifications</p>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-paper hover:text-ink">
                  ✕
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {notices === null ? (
                  <div className="space-y-3 p-5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="skeleton h-16 rounded-xl" />
                    ))}
                  </div>
                ) : notices.length === 0 ? (
                  <div className="px-6 py-16 text-center">
                    <p className="font-serif text-2xl">You&apos;re all caught up</p>
                    <p className="mx-auto mt-2 max-w-xs text-sm text-muted">Friend requests, room invites, and replies to your questions show up here, and slide in on the right as they happen.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-line">
                    {notices.map((n) => (
                      <Item
                        key={n.id}
                        notice={n}
                        isNew={fresh.has(n.id)}
                        onOpen={() => {
                          setOpen(false);
                          if (n.url) router.push(n.url);
                        }}
                        onAnswer={async (accept) => {
                          await act(n, accept);
                          await sync(false);
                        }}
                      />
                    ))}
                  </ul>
                )}
              </div>
              <div className="border-t border-line bg-paper px-5 py-3 text-xs text-muted">
                <Link href="/friends" onClick={() => setOpen(false)} className="font-medium text-ink underline-offset-4 hover:underline">
                  Friends
                </Link>{" "}
                · requests and room invites also wait there.
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}

function Item({ notice: n, isNew, onOpen, onAnswer }: { notice: Notice; isNew: boolean; onOpen: () => void; onAnswer: (accept: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const answering = n.kind === "friend_request" && !n.read;
  return (
    <li className={`relative transition ${isNew ? "bg-yellow-50" : ""}`}>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition hover:bg-paper">
        {n.actor ? (
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full border border-ink bg-yellow-100 font-serif text-sm">
            {n.actor.slice(0, 1).toUpperCase()}
          </span>
        ) : (
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full border border-ink bg-paper">
            <KindIcon kind={n.kind} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug font-medium">{n.title}</span>
          {n.body && <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted">{plainExcerpt(n.body, 160)}</span>}
          <span className="mt-1 block font-mono text-[10px] text-muted">{ago(n.created_at)}</span>
        </span>
        {isNew && <span aria-label="New" className="mt-1.5 size-2 shrink-0 rounded-full bg-yellow-400" />}
      </button>
      {answering && (
        <div className="flex gap-2 px-5 pb-3.5 pl-[4.25rem]">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onAnswer(true);
              setBusy(false);
            }}
            className="rounded-lg border border-ink bg-ink px-3 py-1 text-xs font-medium text-white transition disabled:opacity-50"
          >
            Accept
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onAnswer(false);
              setBusy(false);
            }}
            className="rounded-lg border border-ink/30 px-3 py-1 text-xs font-medium transition hover:border-ink disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      )}
      {n.kind === "room_invite" && n.url && (
        <div className="px-5 pb-3.5 pl-[4.25rem]">
          <Link href={n.url} className="inline-flex rounded-lg border border-ink bg-ink px-3 py-1 text-xs font-medium text-white transition">
            Join the room
          </Link>
        </div>
      )}
    </li>
  );
}

function KindIcon({ kind }: { kind: Notice["kind"] }) {
  const path =
    kind === "post_corrected" ? (
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    ) : kind === "post_hidden" ? (
      <path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z" />
    ) : kind === "thread_reply" ? (
      <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" />
    ) : kind === "room_invite" ? (
      <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M14 12h.01" />
    ) : kind === "reply_accepted" ? (
      <path d="m5 12 5 5L20 7" />
    ) : (
      <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 8v6M22 11h-6" />
    );
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {path}
    </svg>
  );
}

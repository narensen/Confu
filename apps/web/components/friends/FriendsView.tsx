"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ask, notify, toast } from "@/components/dialogs";
import { buttonClass, eyebrowClass, ghostButtonClass, inputClass } from "@/components/ui";
import { classifyFriendQuery } from "@/lib/friend-query";
import {
  cancelFriendRequest,
  dismissRoomInvite,
  formatFriendCode,
  loadFriends,
  removeFriend,
  requestFriend,
  respondFriend,
  type Friend,
  type FriendsPayload,
} from "@/lib/friends";
import { track } from "@/lib/telemetry";

export function FriendsView() {
  const [data, setData] = useState<FriendsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNote, setFormNote] = useState<string | null>(null);

  const reload = () =>
    loadFriends().then(
      (next) => {
        setData(next);
        setError(null);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load friends."),
    );

  useEffect(() => {
    let live = true;
    const run = () => {
      if (live) void reload();
    };
    run();
    const poll = window.setInterval(run, 15_000);
    return () => {
      live = false;
      window.clearInterval(poll);
    };
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setFormNote(null);
    if (!classifyFriendQuery(query)) {
      setFormError("Enter a friend code or the email on their account.");
      return;
    }
    setPending(true);
    try {
      const result = await requestFriend(query);
      track("friend.request", { accepted: result.status === "accepted" });
      setQuery("");
      setFormNote(result.status === "accepted" ? `You and ${result.name} are friends now.` : `Request sent to ${result.name}.`);
      notify(
        result.status === "accepted"
          ? { title: `You and ${result.name} are friends now`, body: "They'd already asked you. Invite them into a room from the room's page.", avatar: result.name, tone: "success" }
          : { title: `Friend request sent to ${result.name}`, body: "They get a notification now. You'll get one when they accept.", avatar: result.name, tone: "success" },
      );
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't send that.");
    } finally {
      setPending(false);
    }
  }

  if (error) return <p className="mt-8 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p>;
  if (!data) {
    return (
      <div className="mt-8 space-y-4">
        <div className="skeleton h-28 rounded-2xl" />
        <div className="skeleton h-40 rounded-2xl" />
      </div>
    );
  }

  const code = data.code ? formatFriendCode(data.code) : "";

  return (
    <div className="mt-8 space-y-10">
      {data.invites.length > 0 && (
        <section>
          <p className={eyebrowClass}>Room invites</p>
          <ul className="mt-3 space-y-3">
            {data.invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink bg-yellow-100 px-4 py-3">
                <p className="text-sm">
                  <span className="font-medium">{invite.from_name}</span> invited you to <span className="font-medium">{invite.room_name}</span>
                </p>
                <span className="flex gap-2">
                  <Link href={`/rooms/${invite.room_slug}`} className={`${buttonClass} py-1.5`}>
                    Join room
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      void dismissRoomInvite(invite.id).then(
                        () => setData((current) => (current ? { ...current, invites: current.invites.filter((row) => row.id !== invite.id) } : current)),
                        () => toast("Couldn't dismiss that.", "error"),
                      );
                    }}
                    className={`${ghostButtonClass} py-1.5`}
                  >
                    Dismiss
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.incoming.length > 0 && (
        <section>
          <p className={eyebrowClass}>Requests</p>
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-ink bg-panel">
            {data.incoming.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="text-sm">
                  <span className="font-medium">{row.name}</span> wants to be friends
                </p>
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void respondFriend(row.id, true).then(
                        () => {
                          track("friend.accept", {});
                          notify({ title: `You and ${row.name} are friends now`, body: "Invite them into a private room from the room's page.", avatar: row.name, tone: "success" });
                          return reload();
                        },
                        (err: unknown) => toast(err instanceof Error ? err.message : "Couldn't accept.", "error"),
                      );
                    }}
                    className={`${buttonClass} py-1.5`}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void respondFriend(row.id, false).then(
                        () => reload(),
                        (err: unknown) => toast(err instanceof Error ? err.message : "Couldn't decline.", "error"),
                      );
                    }}
                    className={`${ghostButtonClass} py-1.5`}
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <p className={eyebrowClass}>Add a friend</p>
          <form onSubmit={(event) => void add(event)} className="mt-3 space-y-3 rounded-2xl border border-ink bg-panel p-5">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Friend code or email"
              autoComplete="off"
              maxLength={200}
              aria-label="Friend code or email"
              className={inputClass}
            />
            <button type="submit" disabled={pending} className={`${buttonClass} py-2`}>
              {pending ? "Sending…" : "Send request"}
            </button>
            {formError && <p className="text-sm text-danger">{formError}</p>}
            {formNote && <p className="text-sm text-ok">{formNote}</p>}
            <p className="text-xs text-muted">They&apos;ll see your first name and can accept or decline. This is separate from inviting someone new to Confu.</p>
          </form>
        </div>
        <div>
          <p className={eyebrowClass}>Your code</p>
          <div className="mt-3 rounded-2xl border border-ink bg-panel p-5">
            <p className="font-mono text-3xl tracking-[0.18em]">{code || "····-····"}</p>
            <button
              type="button"
              disabled={!code}
              onClick={() => navigator.clipboard.writeText(code).then(() => toast("Friend code copied."))}
              className={`${ghostButtonClass} mt-3 py-1.5 text-xs`}
            >
              Copy code
            </button>
            <p className="mt-3 text-xs text-muted">Share this, or they can add the email on your account. Only your first name is shown to friends.</p>
          </div>
        </div>
      </section>

      <section>
        <p className={eyebrowClass}>Your friends</p>
        {data.friends.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-ink/30 px-4 py-6 text-sm text-muted">No friends yet. Share your code with someone you study with.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-ink bg-panel">
            {data.friends.map((friend) => (
              <FriendRow
                key={friend.user_id}
                friend={friend}
                onRemove={() => {
                  void removeFriend(friend.user_id).then(
                    () => {
                      setData((current) => (current ? { ...current, friends: current.friends.filter((row) => row.user_id !== friend.user_id) } : current));
                      toast(`Removed ${friend.name}.`);
                    },
                    (err: unknown) => toast(err instanceof Error ? err.message : "Couldn't remove them.", "error"),
                  );
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {data.outgoing.length > 0 && (
        <section>
          <p className={eyebrowClass}>Sent</p>
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-ink bg-panel">
            {data.outgoing.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <p className="text-sm">
                  Waiting on <span className="font-medium">{row.name}</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void cancelFriendRequest(row.id).then(
                      () => reload(),
                      (err: unknown) => toast(err instanceof Error ? err.message : "Couldn't cancel.", "error"),
                    );
                  }}
                  className="text-xs text-muted hover:text-danger"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FriendRow({ friend, onRemove }: { friend: Friend; onRemove: () => void }) {
  const status = friendStatus(friend);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-full border border-ink font-serif ${friend.online ? "bg-yellow-300" : "bg-panel"}`}>
        {friend.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{friend.name}</span>
        <span className="block truncate text-xs text-muted">{status.label}</span>
      </span>
      {status.href && (
        <Link href={status.href} className={`${ghostButtonClass} shrink-0 py-1 text-xs`}>
          Join
        </Link>
      )}
      <button
        type="button"
        onClick={() => {
          void ask({
            title: `Remove ${friend.name}?`,
            body: "They won't see when you're in a room. You'll both need a new request to be friends again.",
            confirm: "Remove",
            danger: true,
          }).then((yes) => {
            if (yes) onRemove();
          });
        }}
        className="shrink-0 text-xs text-muted hover:text-danger"
      >
        Remove
      </button>
    </li>
  );
}

function friendStatus(friend: Friend): { label: string; href: string | null } {
  if (!friend.online) return { label: "Offline", href: null };
  if (friend.room_slug && friend.room_name) {
    const where = friend.in_voice ? `In voice · ${friend.room_name}` : `In ${friend.room_name}`;
    return { label: where, href: `/rooms/${friend.room_slug}` };
  }
  if (friend.room_hidden) return { label: friend.in_voice ? "In voice, in a private room" : "In a private room", href: null };
  if (friend.in_voice) return { label: "In voice", href: null };
  return { label: "Online", href: null };
}

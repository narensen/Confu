"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "@/components/dialogs";
import { ghostButtonClass } from "@/components/ui";
import { inviteFriendToRoom, loadRoomFriends, revokeRoomInvite, type RoomFriend } from "@/lib/friends";
import { track } from "@/lib/telemetry";

// Invite accepted friends into this private room. The link still works for
// anyone; the list is the directed version of that, shown on their Friends page.
export function RoomFriends({ slug, link, canInvite }: { slug: string; link: string; canInvite: boolean }) {
  const [friends, setFriends] = useState<RoomFriend[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!canInvite) return;
    let live = true;
    const load = () => {
      loadRoomFriends(slug).then(
        (rows) => {
          if (!live) return;
          setFriends(rows);
          setError(null);
        },
        (err: unknown) => {
          if (live) setError(err instanceof Error ? err.message : "Couldn't load friends.");
        },
      );
    };
    load();
    const poll = window.setInterval(load, 20_000);
    return () => {
      live = false;
      window.clearInterval(poll);
    };
  }, [slug, canInvite]);

  async function toggle(friend: RoomFriend) {
    setBusy(friend.user_id);
    try {
      if (friend.invited) {
        await revokeRoomInvite(slug, friend.user_id);
        setFriends((rows) => rows?.map((row) => (row.user_id === friend.user_id ? { ...row, invited: false } : row)) ?? rows);
        toast(`Took back ${friend.name}'s invite.`);
      } else {
        await inviteFriendToRoom(slug, friend.user_id);
        setFriends((rows) => rows?.map((row) => (row.user_id === friend.user_id ? { ...row, invited: true } : row)) ?? rows);
        track("room.invite", {});
        toast(`Invited ${friend.name}.`);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update the invite.", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-ink bg-panel p-5">
      <p className="font-medium">Invite people</p>
      <p className="mt-1 text-sm text-muted">Anyone with a Confu account and this link can join. Friends you invite also get a card on their Friends page.</p>
      <code className="mt-3 block truncate rounded-lg border border-line bg-paper px-3 py-2 font-mono text-xs">{link}</code>
      <button type="button" onClick={() => navigator.clipboard.writeText(link).then(() => toast("Room link copied."))} className={`${ghostButtonClass} mt-2 py-1 text-xs`}>
        Copy link
      </button>

      {canInvite ? (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs font-medium">Friends</p>
          {error ? (
            <p className="mt-2 text-xs text-danger">{error}</p>
          ) : friends === null ? (
            <div className="skeleton mt-2 h-12 rounded-lg" />
          ) : friends.length === 0 ? (
            <p className="mt-2 text-xs text-muted">
              No friends yet.{" "}
              <Link href="/friends" className="underline underline-offset-2">
                Add someone
              </Link>{" "}
              you study with, then invite them here.
            </p>
          ) : (
            <ul className="mt-1 max-h-60 divide-y divide-line overflow-y-auto">
              {friends.map((friend) => (
                <li key={friend.user_id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm">
                      <span className={`size-1.5 shrink-0 rounded-full ${friend.in_voice ? "bg-ok" : friend.online ? "bg-ink" : "bg-line"}`} aria-hidden />
                      {friend.name}
                    </span>
                    <span className="block truncate pl-3 text-[11px] text-muted">{friend.in_voice ? "In voice" : friend.online ? "Online" : "Offline"}</span>
                  </span>
                  <button type="button" disabled={busy === friend.user_id} onClick={() => void toggle(friend)} className={`${ghostButtonClass} shrink-0 px-2 py-1 text-xs`}>
                    {busy === friend.user_id ? "…" : friend.invited ? "Invited" : "Invite"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">Join the room to invite friends into it.</p>
      )}
    </div>
  );
}

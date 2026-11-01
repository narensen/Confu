"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass, eyebrowClass, ghostButtonClass } from "@/components/ui";
import { track } from "@/lib/telemetry";
import { VoiceSession, type VoicePerson } from "@/lib/voice-session";

// Voice for a private room: a roster like a Discord channel, then mute,
// deafen and leave. Public rooms never mount this.
export function VoiceRoom({ slug, joined }: { slug: string; joined: boolean }) {
  return (
    <section className="mt-8" aria-label="Voice">
      <p className={eyebrowClass}>Voice</p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-ink bg-panel">
        {joined ? (
          <VoiceLive key={slug} slug={slug} />
        ) : (
          <>
            <VoiceHeading />
            <p className="px-4 py-4 text-sm text-muted">Join this room first. Then you can talk with whoever else joins voice.</p>
          </>
        )}
      </div>
    </section>
  );
}

function VoiceLive({ slug }: { slug: string }) {
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<VoiceSession | null>(null);
  const mounted = useRef(true);
  const [people, setPeople] = useState<VoicePerson[]>([]);
  const [inVoice, setInVoice] = useState(false);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const hostEl = host.current;
    if (!hostEl) return;
    const next = new VoiceSession(
      slug,
      hostEl,
      (list) => {
        if (!mounted.current) return;
        setPeople(list);
        setInVoice(list.some((person) => person.me));
      },
      (message) => {
        if (mounted.current) setError(message);
      },
      (tap) => {
        if (mounted.current) setNeedsTap(tap);
      },
    );
    session.current = next;
    next.watch();
    return () => {
      void next.close();
      if (session.current === next) session.current = null;
    };
  }, [slug]);

  useEffect(() => {
    if (!inVoice) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "m" || event.key === "M") {
        if (deafened) return;
        event.preventDefault();
        const nextMuted = !muted;
        setMuted(nextMuted);
        session.current?.setMuted(nextMuted);
      }
      if (event.key === "d" || event.key === "D") {
        event.preventDefault();
        const nextDeafened = !deafened;
        setDeafened(nextDeafened);
        session.current?.setDeafened(nextDeafened);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inVoice, muted, deafened]);

  const others = people.filter((person) => !person.me).length;
  const connecting = people.some((person) => person.connecting);

  return (
    <>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <VoiceHeading />
          {inVoice ? (
              <button
                type="button"
                onClick={() => {
                  void session.current?.leave();
                  setMuted(false);
                  setDeafened(false);
                  setNeedsTap(false);
                }}
                className="rounded-lg border border-danger/50 px-3 py-1.5 text-sm font-medium text-danger transition hover:bg-danger/5"
              >
                Leave voice
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setPending(true);
                  setError(null);
                  void session.current
                    ?.join()
                    .then(() => track("voice.join", {}))
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't join voice."))
                    .finally(() => setPending(false));
                }}
                className={`${buttonClass} py-1.5`}
              >
                {pending ? "Joining…" : "Join voice"}
              </button>
          )}
        </div>

        {people.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">No one is in voice. Join, then invite a friend and they can talk with you from this room.</p>
        ) : (
          <ul className="divide-y divide-line">
            {people.map((person) => (
              <li key={person.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full border font-serif ${person.speaking ? "border-ok ring-2 ring-ok" : "border-ink"} ${person.me ? "bg-yellow-300" : "bg-paper"}`}
                >
                  {person.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {person.name}
                    {person.me && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {person.speaking ? "Speaking" : person.connecting ? "Connecting…" : person.deafened ? "Deafened" : person.muted ? "Muted" : "In voice"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {inVoice && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            <button
              type="button"
              aria-pressed={muted || deafened}
              disabled={deafened}
              title={deafened ? "Undeafen to change mute" : muted ? "Unmute (M)" : "Mute (M)"}
              onClick={() => {
                const next = !muted;
                setMuted(next);
                session.current?.setMuted(next);
              }}
              className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 ${muted || deafened ? "border-ink bg-ink text-white" : "border-ink bg-panel hover:-translate-y-px hover:shadow-hard-sm"}`}
            >
              <MicIcon off={muted || deafened} />
              {deafened ? "Muted" : muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              aria-pressed={deafened}
              title={deafened ? "Undeafen (D)" : "Deafen (D)"}
              onClick={() => {
                const next = !deafened;
                setDeafened(next);
                session.current?.setDeafened(next);
              }}
              className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${deafened ? "border-ink bg-ink text-white" : "border-ink bg-panel hover:-translate-y-px hover:shadow-hard-sm"}`}
            >
              <HeadphonesIcon off={deafened} />
              {deafened ? "Undeafen" : "Deafen"}
            </button>
            <span className="text-xs text-muted sm:ml-auto">M mute · D deafen</span>
          </div>
        )}

        {needsTap && inVoice && (
          <div className="border-t border-line px-4 py-3">
            <button type="button" onClick={() => session.current?.hear()} className={`${ghostButtonClass} py-1.5 text-xs`}>
              Tap to hear
            </button>
          </div>
        )}
        {inVoice && others === 0 && <p className="border-t border-line px-4 py-3 text-xs text-muted">You&apos;re the only one in voice. Invite a friend, then they can join from this room.</p>}
        {connecting && inVoice && <p className="border-t border-line px-4 py-3 text-xs text-muted">If someone stays on Connecting, their network may be blocking voice. A home network usually works; some school networks don&apos;t.</p>}
        {error && <p className="border-t border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p>}
        {/* Not display:none: some browsers refuse to play audio in a hidden element. */}
        <div ref={host} aria-hidden className="sr-only" />
    </>
  );
}

function VoiceHeading() {
  return (
    <div className="min-w-0">
      <p className="font-medium">Room voice</p>
      <p className="text-xs text-muted">Only this private room. No camera, and nothing is recorded.</p>
    </div>
  );
}

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

function HeadphonesIcon({ off }: { off: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 13v3a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2Zm16 0v3a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2Z" />
      <path d="M4 13a8 8 0 0 1 16 0" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

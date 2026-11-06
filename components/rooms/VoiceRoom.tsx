"use client";

import { useEffect, useRef } from "react";
import { hearVoice, joinVoice, leaveVoice, setVoiceDeafened, setVoiceMuted, shareScreen, stopScreenShare, useVoice, watchVoice } from "@/lib/voice-store";
import type { ScreenShare, VoicePerson } from "@/lib/voice-session";

// Voice for a private room, like a voice channel: everyone in it as a tile
// (a ring when they talk), and mic, deafen and leave. You stay in voice when
// you leave this page; the header keeps the controls. Public rooms never
// mount this.
export function VoiceRoom({ slug, joined }: { slug: string; joined: boolean }) {
  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-ink bg-panel" aria-label="Voice">
      {joined ? (
        <VoiceLive slug={slug} />
      ) : (
        <>
          <Heading live={0} />
          <p className="px-5 py-6 text-sm text-muted">Join the room first. Then you can talk with whoever else is in its voice.</p>
        </>
      )}
    </section>
  );
}

function VoiceLive({ slug }: { slug: string }) {
  const v = useVoice();
  const mine = v.slug === slug;
  const people = mine ? v.people : [];
  const inVoice = mine && v.inVoice;

  useEffect(() => watchVoice(slug), [slug]);

  // M to mute, D to deafen, while you're in voice and not typing.
  useEffect(() => {
    if (!inVoice) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        setVoiceMuted(!v.muted);
      }
      if (event.key === "d" || event.key === "D") {
        event.preventDefault();
        setVoiceDeafened(!v.deafened);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inVoice, v.muted, v.deafened]);

  const others = people.filter((p) => !p.me);
  const talking = others.filter((p) => !p.connecting || !inVoice);
  const connecting = inVoice && others.some((p) => p.connecting);
  const screens = mine ? v.screens : [];

  return (
    <>
      <Heading live={people.length} />

      {mine && v.resumable && !inVoice && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink bg-yellow-100 px-5 py-3">
          <p className="text-sm">You were in voice before the page reloaded.</p>
          <button type="button" onClick={() => void joinVoice(slug)} disabled={v.joining} className="rounded-lg border border-ink bg-ink px-3 py-1.5 text-sm font-medium text-white transition hover:-translate-y-px disabled:opacity-50">
            {v.joining ? "Rejoining…" : "Rejoin voice"}
          </button>
        </div>
      )}

      {people.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <span aria-hidden className="flex size-14 items-center justify-center rounded-full border border-dashed border-ink/40 text-muted">
            <Mic off={false} size={22} />
          </span>
          <p className="mt-3 font-serif text-xl">Nobody&apos;s talking yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted">Hop in, then invite a friend from the panel on the right. It&apos;s peer to peer, and nothing is recorded. You can share a screen once you&apos;re in.</p>
          <JoinButton slug={slug} joining={v.joining} className="mt-5" />
        </div>
      ) : (
        <>
          {screens.length > 0 && (
            <div className={`grid gap-3 border-b border-ink bg-ink/[0.03] p-4 ${screens.length > 1 ? "sm:grid-cols-2" : ""}`}>
              {screens.map((screen) => (
                <ScreenView key={screen.id} screen={screen} />
              ))}
            </div>
          )}
          <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5 lg:grid-cols-4">
            {people.map((p) => (
              <Tile key={p.id} person={p} />
            ))}
          </ul>
          {!inVoice && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
              <p className="text-sm text-muted">
                {talking.length === 1 ? `${talking[0].name} is in voice.` : `${talking.map((p) => p.name).slice(0, 3).join(", ")}${talking.length > 3 ? ` and ${talking.length - 3} more` : ""} are in voice.`}
              </p>
              <JoinButton slug={slug} joining={v.joining} />
            </div>
          )}
        </>
      )}

      {inVoice && (
        <div className="flex flex-wrap items-center gap-2 border-t border-ink bg-paper px-5 py-3">
          <RoundButton
            label={v.deafened ? "Undeafen to unmute" : v.muted ? "Unmute (M)" : "Mute (M)"}
            pressed={v.muted || v.deafened}
            disabled={v.deafened}
            onClick={() => setVoiceMuted(!v.muted)}
          >
            <Mic off={v.muted || v.deafened} />
          </RoundButton>
          <RoundButton label={v.deafened ? "Undeafen (D)" : "Deafen (D)"} pressed={v.deafened} onClick={() => setVoiceDeafened(!v.deafened)}>
            <Headphones off={v.deafened} />
          </RoundButton>
          <RoundButton label={v.sharing ? "Stop sharing" : "Share your screen"} pressed={v.sharing} onClick={() => void (v.sharing ? stopScreenShare() : shareScreen())}>
            <ScreenIcon />
          </RoundButton>
          <button
            type="button"
            onClick={() => void leaveVoice()}
            title="Leave voice"
            className="flex h-10 items-center gap-2 rounded-full bg-danger px-4 text-sm font-medium text-white transition hover:opacity-90 active:scale-95"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a1 1 0 0 1-1.41-.02L.29 13.08a1 1 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.41l-2.48 2.48a1 1 0 0 1-1.41.02 11.3 11.3 0 0 0-2.66-1.85 1 1 0 0 1-.56-.9v-3.1A15 15 0 0 0 12 9Z" />
            </svg>
            Leave
          </button>
          <span className="ml-auto hidden text-xs text-muted sm:inline">M mute · D deafen · voice and a screen stay with you on other pages</span>
        </div>
      )}

      {mine && v.needsTap && inVoice && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <p className="text-sm text-muted">Your browser paused the sound.</p>
          <button type="button" onClick={hearVoice} className="rounded-lg border border-ink px-3 py-1.5 text-sm font-medium transition hover:bg-ink hover:text-white">
            Tap to hear
          </button>
        </div>
      )}
      {inVoice && others.length === 0 && <p className="border-t border-line px-5 py-3 text-xs text-muted">You&apos;re the only one here. Invite a friend and they can join from this room.</p>}
      {connecting && (
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          Connecting. It keeps trying. Home networks usually work; some school and office networks block voice.
        </p>
      )}
      {mine && v.error && <p className="border-t border-danger/30 bg-danger/5 px-5 py-3 text-sm text-danger">{v.error}</p>}
    </>
  );
}

function Heading({ live }: { live: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink px-5 py-3.5">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium">
          Voice
          {live > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-2 py-0.5 font-mono text-[10px] font-medium text-ok">
              <span className="size-1.5 animate-pulse rounded-full bg-ok" aria-hidden />
              {live} in voice
            </span>
          )}
        </p>
        <p className="text-xs text-muted">Only this private room. Share a screen if you want. No camera, and nothing is recorded.</p>
      </div>
    </div>
  );
}

function JoinButton({ slug, joining, className = "" }: { slug: string; joining: boolean; className?: string }) {
  return (
    <button
      type="button"
      disabled={joining}
      onClick={() => void joinVoice(slug)}
      className={`inline-flex items-center gap-2 rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-white shadow-hard-sm transition hover:-translate-y-px hover:shadow-hard active:translate-y-0 disabled:opacity-50 ${className}`}
    >
      <Mic off={false} />
      {joining ? "Joining…" : "Join voice"}
    </button>
  );
}

function ScreenView({ screen }: { screen: ScreenShare }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = screen.stream;
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [screen.stream]);
  const label = screen.mine ? "Your screen" : `${screen.name}'s screen`;
  return (
    <figure className="overflow-hidden rounded-xl border border-ink bg-ink">
      <video ref={ref} autoPlay playsInline muted className="aspect-video w-full bg-ink object-contain" aria-label={label} />
      <figcaption className="flex items-center justify-between gap-2 bg-panel px-3 py-1.5 text-xs">
        <span className="truncate font-medium">{label}</span>
        <span className="shrink-0 text-muted">Live · not recorded</span>
      </figcaption>
    </figure>
  );
}

function Tile({ person: p }: { person: VoicePerson }) {
  const status = p.connecting ? "Connecting…" : p.deafened ? "Deafened" : p.muted ? "Muted" : p.speaking ? "Speaking" : "Listening";
  return (
    <li className={`flex flex-col items-center rounded-xl border px-3 py-4 text-center transition ${p.speaking ? "border-ok bg-ok/5" : "border-line"}`}>
      <span className="relative">
        <span
          className={`flex size-14 items-center justify-center rounded-full border-2 font-serif text-xl transition-shadow duration-150 ${p.speaking ? "border-ok shadow-[0_0_0_4px_color-mix(in_srgb,var(--ok)_25%,transparent)]" : "border-ink"} ${p.me ? "bg-yellow-300" : "bg-paper"} ${p.connecting ? "opacity-50" : ""}`}
        >
          {p.name.slice(0, 1).toUpperCase()}
        </span>
        {(p.muted || p.deafened) && (
          <span className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border border-ink bg-panel text-danger" title={p.deafened ? "Deafened" : "Muted"}>
            {p.deafened ? <Headphones off size={12} /> : <Mic off size={12} />}
          </span>
        )}
      </span>
      <span className="mt-2.5 max-w-full truncate text-sm font-medium">
        {p.name}
        {p.me && <span className="font-normal text-muted"> (you)</span>}
      </span>
      <span className={`mt-0.5 text-[11px] ${p.speaking ? "font-medium text-ok" : "text-muted"}`}>{status}</span>
    </li>
  );
}

function RoundButton({ label, pressed, disabled, onClick, children }: { label: string; pressed: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={`flex size-10 items-center justify-center rounded-full border transition active:scale-95 disabled:opacity-40 ${
        pressed ? "border-danger bg-danger/10 text-danger" : "border-ink bg-panel hover:-translate-y-px hover:shadow-hard-sm"
      }`}
    >
      {children}
    </button>
  );
}

export function Mic({ off, size = 16 }: { off: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

export function ScreenIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

export function Headphones({ off, size = 16 }: { off: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
      <path d="M4 13v3a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2Zm16 0v3a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2Z" />
      <path d="M4 13a8 8 0 0 1 16 0" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

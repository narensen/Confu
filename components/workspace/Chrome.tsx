"use client";

import type { ReactNode } from "react";
import type { Section, Tab } from "./TutorPanel";

// The frame around the reader: the tutor's side (left), the tools rail
// (right) with the panel each tool slides out into, and the tab bar phones
// use instead. The panels' contents are in TutorPanel.

/* ------------------------------------------------------------------ icons */

type IconName = Tab | "reader" | "keys" | "pin" | "close" | "fold" | "expand" | "shrink";

const PATHS: Record<IconName, ReactNode> = {
  chat: <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" />,
  plan: (
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5" />
    </>
  ),
  passes: (
    <>
      <path d="M6 2.5h8.5l4.5 4.5v14.5H6z" />
      <path d="M14 2.5V7h5M9 12.5h7M9 16.5h5" />
    </>
  ),
  practice: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  highlights: (
    <>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </>
  ),
  memory: (
    <>
      <path d="M3 3v18h18" />
      <path d="m7 15 4-4 3 3 5-6" />
    </>
  ),
  files: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  reader: (
    <>
      <path d="M2 4.5h6a4 4 0 0 1 4 4V21a3 3 0 0 0-3-3H2z" />
      <path d="M22 4.5h-6a4 4 0 0 0-4 4V21a3 3 0 0 1 3-3h7z" />
    </>
  ),
  keys: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14h9" />
    </>
  ),
  pin: (
    <>
      <path d="M12 17v5" />
      <path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2v.8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  fold: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M16 15l-3-3 3-3" />
    </>
  ),
  expand: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
  shrink: <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}

const iconButton = "flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-paper hover:text-ink";

/* ------------------------------------------------------------- the rails */

// One tool in a rail: icon over its name, with a count or a dot.
function RailItem({ icon, label, badge, dot, active, title, onClick }: { icon: IconName; label: string; badge?: string; dot?: boolean; active: boolean; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`group relative flex w-full flex-col items-center gap-1 rounded-lg px-0.5 pt-2 pb-1.5 transition duration-150 ease-fluid active:scale-95 ${
        active ? "bg-ink text-white" : "text-muted hover:bg-paper hover:text-ink"
      }`}
    >
      <Icon name={icon} />
      <span className="max-w-full truncate text-[10px] leading-none font-medium">{label}</span>
      {/* A count; yellow when something there is waiting on you. */}
      {badge ? (
        <span
          className={`absolute top-0.5 right-0.5 min-w-4 rounded-full px-1 font-mono text-[9px] leading-[14px] tabular-nums ${
            dot ? "border border-ink bg-yellow-300" : active ? "bg-white/20 text-white" : "border border-line bg-panel text-muted group-hover:text-ink"
          }`}
        >
          {badge}
        </span>
      ) : (
        dot && <span aria-hidden className="absolute top-1.5 right-2.5 size-2 rounded-full border border-ink bg-yellow-300" />
      )}
    </button>
  );
}

// Right edge: every tool of the session, one click from sliding out.
export function ToolRail({ sections, active, onPick, onShortcuts }: { sections: Section[]; active: Tab | null; onPick: (id: Section["id"]) => void; onShortcuts: () => void }) {
  return (
    <nav aria-label="Session tools" className="flex w-18 shrink-0 flex-col gap-1 border-l border-ink bg-panel px-1.5 py-2">
      {sections.map((s) => (
        <RailItem
          key={s.id}
          icon={s.id}
          label={s.label}
          badge={s.badge}
          dot={s.dot}
          active={active === s.id}
          title={`${s.label}: ${s.hint}${s.shortcut ? ` (${s.shortcut})` : ""}`}
          onClick={() => onPick(s.id)}
        />
      ))}
      <div className="flex-1" />
      <RailItem icon="keys" label="Keys" active={false} title="Keyboard shortcuts (?)" onClick={onShortcuts} />
    </nav>
  );
}

// Left edge, when the tutor is folded: only the logo, so the reader isn't squeezed.
export function TutorRail({ busy, onOpen }: { busy: boolean; onOpen: () => void }) {
  return (
    <nav aria-label="Tutor" className="flex w-8 shrink-0 flex-col items-center border-r border-ink bg-panel pt-3">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Show the tutor"
        title="Show the tutor (T)"
        className="relative rounded-md px-0.5 py-2 text-ink transition hover:bg-paper"
      >
        <span className="font-serif text-[13px] font-semibold tracking-tight [writing-mode:vertical-rl] rotate-180">
          Confu<span className="text-yellow-500">.</span>
        </span>
        {busy && <span aria-hidden className="absolute top-1 right-0 size-1.5 animate-pulse rounded-full border border-ink bg-yellow-300" />}
      </button>
    </nav>
  );
}

/* ---------------------------------------------------------- panel headers */

// The tutor's header: who it is, what page it's reading along with, usage.
// In full screen it can also take the whole screen (onExpand), and come back.
export function TutorHeader({
  where,
  busy,
  usage,
  onFold,
  onExpand,
  expanded = false,
}: {
  where: string | null;
  busy: boolean;
  usage: ReactNode;
  onFold?: () => void;
  onExpand?: () => void;
  expanded?: boolean;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-ink pr-2 pl-4">
      <span className="relative flex">
        <Icon name="chat" size={16} />
        {busy && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 animate-pulse rounded-full bg-yellow-400" />}
      </span>
      <p className="font-medium">Tutor</p>
      {where && (
        <span
          title="The tutor answers with the page you're on in mind"
          className="hidden min-w-0 truncate rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted @[22rem]:inline"
        >
          {where}
        </span>
      )}
      <div className="flex-1" />
      {usage}
      {onExpand &&
        (expanded ? (
          <button
            type="button"
            onClick={onExpand}
            title="Back to the page (E)"
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-ink/25 px-2.5 text-xs font-medium text-ink transition duration-150 ease-fluid hover:border-ink hover:bg-paper"
          >
            <Icon name="shrink" size={14} />
            Back to the page
          </button>
        ) : (
          <button type="button" onClick={onExpand} aria-label="Tutor across the whole screen" title="Tutor across the whole screen (E)" className={iconButton}>
            <Icon name="expand" size={16} />
          </button>
        ))}
      {onFold && !expanded && (
        <button type="button" onClick={onFold} aria-label="Fold the tutor away" title="Fold the tutor away (T)" className={iconButton}>
          <Icon name="fold" size={16} />
        </button>
      )}
    </div>
  );
}

// A tool's header: its name and count, then pin (keep it beside the reader)
// and close.
export function ToolHeader({
  section,
  pinned,
  canPin = true,
  onPin,
  onClose,
}: {
  section: Section;
  pinned?: boolean;
  canPin?: boolean; // room beside the reader; without it the button explains how to make some
  onPin?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-ink pr-2 pl-4">
      <Icon name={section.id} size={16} />
      <p className="font-medium">{section.label}</p>
      {section.badge && <span className="rounded border border-line px-1.5 py-px font-mono text-[10px] text-muted">{section.badge}</span>}
      <p className="hidden min-w-0 truncate text-xs text-muted @[26rem]:block">{section.hint}</p>
      <div className="flex-1" />
      {onPin && (
        <button
          type="button"
          onClick={onPin}
          disabled={!canPin}
          aria-pressed={pinned}
          title={
            pinned
              ? "Float it over the reader again"
              : canPin
                ? "Keep it open beside the reader"
                : "Not enough room beside the page: fold the tutor away (t) or widen the window"
          }
          className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
            pinned ? "border-ink bg-ink text-white" : "border-ink/25 text-muted enabled:hover:border-ink enabled:hover:text-ink"
          }`}
        >
          <Icon name="pin" size={13} />
          {pinned ? "Pinned" : "Pin"}
        </button>
      )}
      {onClose && (
        <button type="button" onClick={onClose} aria-label={`Close ${section.label}`} title="Close (Esc)" className={iconButton}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- resizing */

// A draggable edge between two panels. Arrow keys nudge it; double-click
// puts it back to its default width.
export function ResizeHandle({
  label,
  className,
  onDrag,
  onDone,
  onNudge,
  onReset,
}: {
  label: string;
  className: string; // where it sits: between two panels, or on a panel's edge
  onDrag: (clientX: number) => void;
  onDone: () => void;
  onNudge: (by: number) => void;
  onReset: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label} (double-click to reset)`}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => onDrag(ev.clientX);
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          document.body.style.removeProperty("cursor");
          onDone();
        };
        document.body.style.cursor = "col-resize";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        onNudge(e.key === "ArrowLeft" ? -24 : 24);
      }}
      className={`group z-10 flex w-2 shrink-0 cursor-col-resize justify-center outline-none ${className}`}
    >
      <span className="h-full w-px bg-ink transition-all duration-200 group-hover:w-[3px] group-focus-visible:w-[3px] group-active:w-[3px]" />
    </div>
  );
}

/* ------------------------------------------------------------------ phones */

export type MobileItem = { id: "pdf" | Tab; label: string; icon: IconName; badge?: string; dot?: boolean };

// Phones show one thing at a time; this bar switches between them.
export function MobileNav({ items, active, onPick }: { items: MobileItem[]; active: MobileItem["id"]; onPick: (id: MobileItem["id"]) => void }) {
  return (
    <nav aria-label="Session" className="flex shrink-0 items-stretch border-t border-ink bg-panel px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
      {items.map((it) => {
        const on = it.id === active;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onPick(it.id)}
            aria-pressed={on}
            className={`relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg py-1.5 transition active:scale-95 ${on ? "text-ink" : "text-muted"}`}
          >
            <span className={`flex h-7 w-11 items-center justify-center rounded-full transition-colors ${on ? "bg-ink text-white" : ""}`}>
              <Icon name={it.icon} size={17} />
            </span>
            <span className={`max-w-full truncate text-[10px] leading-none ${on ? "font-semibold" : "font-medium"}`}>{it.label}</span>
            {it.badge && !on ? (
              <span
                className={`absolute top-0.5 left-1/2 ml-2 min-w-4 rounded-full border px-1 font-mono text-[9px] leading-[14px] tabular-nums ${
                  it.dot ? "border-ink bg-yellow-300" : "border-line bg-panel"
                }`}
              >
                {it.badge}
              </span>
            ) : (
              it.dot && <span aria-hidden className="absolute top-1 left-1/2 ml-3.5 size-2 rounded-full border border-ink bg-yellow-300" />
            )}
          </button>
        );
      })}
    </nav>
  );
}

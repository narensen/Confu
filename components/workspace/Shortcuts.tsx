"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Eyebrow } from "@/components/ui";
import { setSingleKeys, useSingleKeys } from "@/lib/prefs";
import { useModal } from "@/components/Modal";

// How to learn here: what used to fill the empty chat, kept one key away.
export const HOW_TO: [string, string][] = [
  ["Select text", "in the PDF to ask a doubt, summarize it, see its context, or get it explained simply."],
  ["Capture", "in the toolbar, then drag over a figure, table or equation. A vision model reads it and the tutor explains it."],
  ["Teach me / Quiz me", "above the message box work through your plan one idea at a time, including topics beyond the PDF. Your progress is remembered."],
  ["Sources", "under the message box picks which files the tutor may cite, and whether every answer must cite a page."],
];

// The workspace's keyboard shortcuts (they work when you're not typing in a
// box and no dialog is open). "?" shows this list. Ctrl/Cmd+E and Ctrl/Cmd+\
// also work while you're writing to the tutor, since plain e and t would type.
// The one-key ones can be turned off here or in Settings → Appearance.
export const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: "Tutor",
    keys: [
      ["t  Ctrl \\  ⌘ \\", "Show or fold away the tutor. Ctrl \\ and ⌘ \\ work while you write."],
      ["/", "Write to the tutor"],
      ["e  Ctrl E  ⌘ E", "In full screen: the tutor across the whole screen, or back beside the page. Ctrl E and ⌘ E work while you write."],
    ],
  },
  {
    group: "Tools (they slide out on the right; press again to put away)",
    keys: [
      ["p", "Plan (Passes in a paper session, Practice in exam prep)"],
      ["h", "Highlights"],
      ["f", "Files"],
      ["Esc", "Put away a tool that isn't pinned"],
    ],
  },
  {
    group: "Reading",
    keys: [
      ["[  ]", "Previous / next open file"],
      ["Shift W", "Close this file's tab (it stays in Files)"],
      ["n", "Open the next topic's pages"],
      ["z", "Full screen on or off"],
      ["Ctrl F  ⌘ F", "Search in this file"],
    ],
  },
  { group: "Anywhere", keys: [["Ctrl K  ⌘ K", "Go to a session, a place or a tool"], ["?", "This list"], ["Esc", "Close a dialog"]] },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const singleKeys = useSingleKeys();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === "Escape" || e.key === "?") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dialogRef = useModal(true, onClose);
  return createPortal(
    <div className="animate-fade fixed inset-0 z-60 flex items-center justify-center bg-scrim p-3 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="keys-title" className="animate-pop w-full max-w-md overflow-hidden rounded-2xl border border-ink bg-panel shadow-hard">
        <div className="flex items-start justify-between gap-4 border-b border-ink px-6 pt-5 pb-4">
          <div>
            <Eyebrow>Help</Eyebrow>
            <h2 id="keys-title" className="mt-1 font-serif text-2xl">
              How it works
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-paper">
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
          <section>
            <Eyebrow>Learning here</Eyebrow>
            <ol className="mt-2 space-y-2">
              {HOW_TO.map(([title, body], i) => (
                <li key={title} className="flex gap-3 text-sm">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-paper font-mono text-xs">{i + 1}</span>
                  <p className="leading-relaxed text-muted">
                    <span className="font-medium text-ink">{title}</span> {body}
                  </p>
                </li>
              ))}
            </ol>
          </section>
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-line bg-paper px-3.5 py-3 text-sm">
            <span>
              <span className="block font-medium">One-key shortcuts</span>
              <span className="block text-xs leading-relaxed text-muted">t, p, f, h, z and the rest. Turn them off if stray key presses move things around.</span>
            </span>
            <input type="checkbox" checked={singleKeys} onChange={(e) => setSingleKeys(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-current" />
          </label>
          {SHORTCUTS.map((g) => (
            <section key={g.group}>
              <Eyebrow>{g.group}</Eyebrow>
              <dl className="mt-2 space-y-1.5">
                {g.keys.map(([k, what]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4 text-sm">
                    <dt className="flex shrink-0 gap-1">
                      {k.split("  ").map((part) => (
                        <kbd key={part} className="rounded border border-ink/30 bg-paper px-1.5 py-0.5 font-mono text-xs">
                          {part}
                        </kbd>
                      ))}
                    </dt>
                    <dd className="text-right text-muted">{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// One way to make a dialog behave. Every dialog in Confu uses it:
//   - focus moves inside when it opens ([data-autofocus], else the first control)
//   - Tab and Shift+Tab stay inside it
//   - Escape closes it (only the top one, when dialogs are stacked)
//   - the page behind doesn't scroll
//   - focus goes back to whatever opened it when it closes
//
//   const ref = useModal(open, close);
//   <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="…">…</div>
//
// Or let <Modal> draw the scrim and panel too.

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

// Open dialogs, newest last. Only the last one answers Escape and Tab.
const stack: HTMLElement[] = [];
let locks = 0;
let savedOverflow = "";

function focusables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function useModal<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  opts: { closeOnEscape?: boolean; lockScroll?: boolean; initialFocus?: RefObject<HTMLElement | null> } = {},
) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  const { closeOnEscape = true, lockScroll = true, initialFocus } = opts;

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(root);

    if (lockScroll) {
      if (locks++ === 0) {
        savedOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      }
    }

    // After paint, so a dialog that animates in can take focus.
    const raf = requestAnimationFrame(() => {
      if (root.contains(document.activeElement)) return;
      const target = initialFocus?.current ?? root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(root)[0];
      if (target) target.focus();
      else {
        if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
        root.focus();
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== root) return;
      if (e.key === "Escape" && closeOnEscape) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(root);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey, true);
      const i = stack.lastIndexOf(root);
      if (i >= 0) stack.splice(i, 1);
      if (lockScroll && --locks === 0) document.body.style.overflow = savedOverflow;
      // Back to the opener, if it's still on the page and nothing else took focus.
      if (opener && opener.isConnected && (!document.activeElement || document.activeElement === document.body || root.contains(document.activeElement))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open, closeOnEscape, lockScroll, initialFocus]);

  return ref;
}

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  // Names the dialog: the id of its heading, or a label.
  labelledBy?: string;
  label?: string;
  className?: string; // the panel
  // Click on the scrim closes it. Off for dialogs that hold unsaved input.
  dismissable?: boolean;
  closeOnEscape?: boolean;
  align?: "center" | "top";
};

// A centred panel over a scrim, in a portal so no stacking context traps it.
export function Modal({ open, onClose, children, labelledBy, label, className = "", dismissable = true, closeOnEscape = true, align = "center" }: ModalProps) {
  const ref = useModal(open, onClose, { closeOnEscape });
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className={`animate-fade fixed inset-0 z-60 flex justify-center bg-scrim p-3 sm:p-6 ${align === "top" ? "items-start pt-[12vh]" : "items-center"}`}
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        className={`animate-pop max-h-full w-full overflow-y-auto rounded-2xl border border-ink bg-panel shadow-hard ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

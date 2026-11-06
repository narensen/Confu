"use client";

import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { useGSAP } from "@gsap/react";
import { useCallback, useRef, type RefObject } from "react";

gsap.registerPlugin(useGSAP, Flip);

export { gsap, useGSAP };

// Confu's motion: quick, calm, and only transform and opacity. Things enter
// with a long soft ease and leave fast; nothing bounces or loops. With
// reduced motion on, everything simply appears.

export const DUR = { xs: 0.12, s: 0.18, m: 0.24, l: 0.32, xl: 0.42 } as const;
export const EASE = {
  enter: "expo.out", // arriving
  exit: "power2.in", // leaving, quickly
  move: "power3.inOut", // something already on screen changing place
} as const;

const REDUCED = "(prefers-reduced-motion: reduce)";
export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia(REDUCED).matches;

// Long lists shouldn't take long to arrive: the whole cascade stays under ~0.3s.
const cascade = (n: number, each = 0.04) => Math.min(each, 0.3 / Math.max(n, 1));

// Inline styles GSAP leaves behind, handed back to CSS once it's done.
const CLEAR = "transform,opacity,visibility";

// Elements matching `selector` inside `scope` rise into place, in order, when
// the scope mounts and again whenever `deps` change. Runs before paint, so
// nothing flashes first.
export function useEnter(scope: RefObject<HTMLElement | null>, deps: unknown[] = [], opts: { selector?: string; y?: number; each?: number } = {}) {
  const { selector = "[data-enter]", y = 8, each } = opts;
  useGSAP(
    () => {
      if (!scope.current || prefersReducedMotion()) return;
      const els = gsap.utils.toArray<HTMLElement>(selector, scope.current);
      if (!els.length) return;
      gsap.fromTo(els, { y, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: DUR.xl, ease: EASE.enter, stagger: cascade(els.length, each), clearProps: CLEAR });
    },
    { scope, dependencies: deps },
  );
}

// The scope itself arrives (a screen, a panel) whenever `deps` change, and
// on mount unless `initial` is false (when something around it already arrives).
export function useArrive(scope: RefObject<HTMLElement | null>, deps: unknown[] = [], opts: { y?: number; duration?: number; initial?: boolean } = {}) {
  const { y = 6, duration = DUR.l, initial = true } = opts;
  const mounted = useRef(false);
  useGSAP(
    () => {
      const first = !mounted.current;
      mounted.current = true;
      if ((first && !initial) || !scope.current || prefersReducedMotion()) return;
      gsap.fromTo(scope.current, { y, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration, ease: EASE.enter, clearProps: CLEAR });
    },
    { scope, dependencies: deps },
  );
}

// Layout changes that glide instead of jump (a card removed, a list
// expanded). Call the returned `capture()` just before the change; once
// `deps` change, elements matching `selector` move from where they were to
// where they are now, and new ones fade in.
export function useFlip(scope: RefObject<HTMLElement | null>, deps: unknown[], selector = "[data-flip]") {
  const state = useRef<Flip.FlipState | null>(null);
  useGSAP(
    () => {
      const before = state.current;
      state.current = null;
      if (!before || !scope.current || prefersReducedMotion()) return;
      Flip.from(before, {
        targets: gsap.utils.toArray<HTMLElement>(selector, scope.current),
        duration: DUR.l,
        ease: EASE.move,
        prune: true,
        onEnter: (els) => gsap.fromTo(els, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: DUR.l, ease: EASE.enter, stagger: cascade(els.length, 0.03), clearProps: CLEAR }),
      });
    },
    { scope, dependencies: deps },
  );
  return useCallback(() => {
    if (scope.current) state.current = Flip.getState(gsap.utils.toArray<HTMLElement>(selector, scope.current));
  }, [scope, selector]);
}

// One indicator that slides to the selected item of a group (tabs, a
// segmented control), instead of each item lighting up on its own. The
// selected item is the one with aria-selected, aria-checked or data-active.
const SELECTED = '[aria-selected="true"],[aria-checked="true"],[data-active="true"]';

export function useIndicator(list: RefObject<HTMLElement | null>, indicator: RefObject<HTMLElement | null>, active: unknown) {
  const placed = useRef(false);
  useGSAP(
    () => {
      const box = list.current;
      const pill = indicator.current;
      const on = box?.querySelector<HTMLElement>(SELECTED);
      if (!box || !pill) return;
      if (!on) {
        gsap.set(pill, { autoAlpha: 0 });
        return;
      }
      const to = { x: on.offsetLeft, y: on.offsetTop, width: on.offsetWidth, height: on.offsetHeight, autoAlpha: 1 };
      if (!placed.current || prefersReducedMotion()) {
        gsap.set(pill, to);
        placed.current = true;
      } else {
        gsap.to(pill, { ...to, duration: DUR.m, ease: EASE.move, overwrite: true });
      }
    },
    { dependencies: [active] },
  );
  // Fonts and resizes move the items; keep the indicator under its item.
  useGSAP(() => {
    const box = list.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const on = box.querySelector<HTMLElement>(SELECTED);
      if (on && indicator.current) gsap.set(indicator.current, { x: on.offsetLeft, y: on.offsetTop, width: on.offsetWidth, height: on.offsetHeight });
    });
    ro.observe(box);
    return () => ro.disconnect();
  });
}

// A dialog or sheet: the scrim fades and the panel rises in on mount;
// `close()` plays it out, then calls `onClosed`.
export function usePresence(scrim: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, onClosed: () => void) {
  const leaving = useRef(false);
  useGSAP(() => {
    if (prefersReducedMotion()) return;
    gsap.fromTo(scrim.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: DUR.m, ease: "none" });
    gsap.fromTo(panel.current, { y: 14, scale: 0.985, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: DUR.xl, ease: EASE.enter, clearProps: CLEAR });
  });
  return useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    if (prefersReducedMotion()) return onClosed();
    gsap.to(panel.current, { y: 8, scale: 0.985, autoAlpha: 0, duration: DUR.s, ease: EASE.exit });
    gsap.to(scrim.current, { autoAlpha: 0, duration: DUR.m, ease: "none", onComplete: onClosed });
  }, [scrim, panel, onClosed]);
}

// A strip that opens to its height (a notice, an inline message) instead of
// pushing everything down at once.
export function useUnfold(el: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useGSAP(
    () => {
      if (!el.current || prefersReducedMotion()) return;
      gsap.from(el.current, { height: 0, autoAlpha: 0, overflow: "hidden", duration: DUR.m, ease: EASE.enter, clearProps: "height,overflow,opacity,visibility" });
    },
    { dependencies: deps },
  );
}

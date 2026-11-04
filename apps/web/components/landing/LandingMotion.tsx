"use client";

import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import { useRef, type ReactNode } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, DrawSVGPlugin);

// All landing-page motion, driven by data attributes so the page itself stays
// a server component:
//   data-hero="…"            hero intro pieces          data-word       headline words (masked)
//   data-mock="…"            product demo in the hero   data-float      idle floating
//   data-parallax="…"        scroll parallax            data-split      headings revealed line by line
//   data-reveal              fade up on scroll          data-reveal-group / -item   staggered groups
//   data-slide-group / -item slide in from the right    data-mock-item  rows inside mode mock-ups
//   data-draw                SVG icons that draw        data-magnetic   buttons that follow the cursor
//
// Content starts hidden (".motion-pending", see globals.css) so it doesn't
// flash before animating; the class is removed as soon as this runs, and a
// <noscript> rule keeps it visible without JavaScript.
export function LandingMotion({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current!;
      const q = gsap.utils.selector(el);
      const mm = gsap.matchMedia();

      mm.add(
        { motion: "(prefers-reduced-motion: no-preference)", pointer: "(hover: hover) and (pointer: fine)" },
        (ctx) => {
          el.classList.remove("motion-pending");
          const { motion, pointer } = ctx.conditions as { motion: boolean; pointer: boolean };
          if (!motion) return;

          /* ------------------------------------------------ hero intro */
          const intro = gsap.timeline({ defaults: { ease: "power4.out" } });
          intro
            .from(q("[data-hero='eyebrow']"), { y: 14, autoAlpha: 0, duration: 0.7 })
            .from(q("[data-word]"), { yPercent: 115, duration: 1.15, stagger: 0.055 }, 0.1)
            .fromTo(
              q("[data-hero='mark']"),
              { backgroundSize: "0% 100%" },
              { backgroundSize: "100% 100%", duration: 1.1, ease: "power2.inOut" },
              0.75,
            )
            .from(q("[data-hero='lede']"), { y: 22, autoAlpha: 0, duration: 1 }, 0.55)
            .from(q("[data-hero='cta']"), { y: 18, autoAlpha: 0, duration: 0.9 }, 0.75)
            .from(q("[data-hero='note']"), { autoAlpha: 0, duration: 0.8 }, 1.0)
            .from(
              q("[data-hero='mock']"),
              { y: 70, rotateX: 10, rotateZ: -1, autoAlpha: 0, transformPerspective: 1400, transformOrigin: "50% 100%", duration: 1.5 },
              0.3,
            )
            // a little product demo inside the mock-up
            .fromTo(q("[data-mock='mark']"), { backgroundSize: "0% 100%" }, { backgroundSize: "100% 100%", duration: 0.9, ease: "power2.inOut" }, 1.1)
            .from(q("[data-mock='popover']"), { y: 12, scale: 0.85, autoAlpha: 0, duration: 0.7, ease: "back.out(2.2)" }, 1.75)
            .from(q("[data-mock='bubble']"), { y: 16, scale: 0.94, autoAlpha: 0, duration: 0.7, ease: "back.out(1.7)" }, 2.0)
            .from(q("[data-mock='answer'] > *"), { y: 12, autoAlpha: 0, stagger: 0.35, duration: 0.7 }, 2.45)
            .from(q("[data-mock='vision']"), { x: 40, autoAlpha: 0, duration: 0.9 }, 2.9);

          // idle float once the demo has played
          q("[data-float]").forEach((node, i) => {
            gsap.to(node, { y: -7, duration: 2.8 + i * 0.4, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 3.8 + i * 0.6 });
          });

          /* ------------------------------------------------- parallax */
          const hero = q("[data-hero-section]")[0];
          if (hero) {
            const pin = { trigger: hero, start: "top top", end: "bottom top" };
            gsap.to(q("[data-parallax='grid']"), { yPercent: 22, ease: "none", scrollTrigger: { ...pin, scrub: true } });
            gsap.to(q("[data-parallax='mock']"), { y: -70, ease: "none", scrollTrigger: { ...pin, scrub: 0.8 } });
            gsap.to(q("[data-parallax='copy']"), { y: 40, autoAlpha: 0.2, ease: "none", scrollTrigger: { ...pin, scrub: 0.8 } });
          }

          /* -------------------------------- headings, line by line */
          q("[data-split]").forEach((heading) => {
            SplitText.create(heading, {
              type: "lines",
              mask: "lines",
              autoSplit: true, // re-split on resize and font load
              onSplit: (self) =>
                gsap.from(self.lines, {
                  yPercent: 110,
                  duration: 1.1,
                  ease: "power4.out",
                  stagger: 0.09,
                  scrollTrigger: { trigger: heading, start: "top 88%", once: true },
                }),
            });
          });

          /* ------------------------------------------------ reveals */
          // Reveals use fromTo with explicit end values: reading "current"
          // values is unreliable while a CSS transition or a re-run of this
          // effect is mid-flight. clearProps hands styling back to CSS after
          // (so hover effects work again).
          const shown = { x: 0, y: 0, rotate: 0, autoAlpha: 1, clearProps: "all" } as const;

          q("[data-reveal]").forEach((node) =>
            gsap.fromTo(
              node,
              { y: 28, autoAlpha: 0 },
              { ...shown, duration: 1, ease: "power3.out", scrollTrigger: { trigger: node, start: "top 88%", once: true } },
            ),
          );

          q("[data-reveal-group]").forEach((group) => {
            const items = group.querySelectorAll("[data-reveal-item]");
            const tl = gsap.timeline({ scrollTrigger: { trigger: group, start: "top 82%", once: true } });
            tl.fromTo(items, { y: 60, rotate: 1.2, autoAlpha: 0 }, { ...shown, duration: 1.1, ease: "power3.out", stagger: 0.12 });
            // rows inside the mode mock-ups cascade in after their card
            const rows = group.querySelectorAll("[data-mock-item]");
            if (rows.length) tl.fromTo(rows, { x: -14, autoAlpha: 0 }, { ...shown, duration: 0.6, ease: "power2.out", stagger: 0.05 }, 0.45);
            // feature icons draw themselves
            const strokes = group.querySelectorAll("[data-draw] path");
            if (strokes.length) tl.fromTo(strokes, { drawSVG: "0%" }, { drawSVG: "100%", duration: 1.2, ease: "power2.inOut", stagger: 0.08 }, 0.3);
          });

          q("[data-slide-group]").forEach((group) => {
            gsap.fromTo(group.querySelectorAll("[data-slide-item]"), { x: 60, autoAlpha: 0 }, {
              ...shown,
              duration: 1,
              ease: "power3.out",
              stagger: 0.12,
              scrollTrigger: { trigger: group, start: "top 80%", once: true },
            });
          });

          /* ----------------------------------- magnetic buttons */
          if (!pointer) return;
          const movers = new WeakMap<Element, { x: gsap.QuickToFunc; y: gsap.QuickToFunc }>();
          const mover = (node: Element) => {
            let m = movers.get(node);
            if (!m) {
              m = { x: gsap.quickTo(node, "x", { duration: 0.5, ease: "power3" }), y: gsap.quickTo(node, "y", { duration: 0.5, ease: "power3" }) };
              movers.set(node, m);
            }
            return m;
          };
          // Delegated, so buttons that stream in after hydration work too.
          const onMove = (e: PointerEvent) => {
            const node = (e.target as Element).closest("[data-magnetic]");
            if (!node) return;
            const r = node.getBoundingClientRect();
            const m = mover(node);
            m.x((e.clientX - (r.left + r.width / 2)) * 0.25);
            m.y((e.clientY - (r.top + r.height / 2)) * 0.35);
          };
          const onOut = (e: PointerEvent) => {
            const node = (e.target as Element).closest("[data-magnetic]");
            if (node && !node.contains(e.relatedTarget as Node)) {
              const m = mover(node);
              m.x(0);
              m.y(0);
            }
          };
          el.addEventListener("pointermove", onMove);
          el.addEventListener("pointerout", onOut);
          return () => {
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerout", onOut);
          };
        },
      );

      // Positions depend on web fonts; recalculate once they're in.
      document.fonts?.ready.then(() => ScrollTrigger.refresh());
    },
    { scope: root },
  );

  return (
    <main ref={root} className={`motion-pending ${className ?? ""}`}>
      {children}
    </main>
  );
}

// Headline words, each in its own mask so it can rise into view. The padding
// keeps descenders (g, j, p) from being clipped.
export function Words({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          <span className="-mb-[0.18em] inline-block overflow-hidden pb-[0.18em] align-top">
            <span data-word className="inline-block">
              {w}
            </span>
          </span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

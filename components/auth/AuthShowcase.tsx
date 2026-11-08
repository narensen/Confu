"use client";

import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useRef, type ReactNode } from "react";

gsap.registerPlugin(useGSAP);

// The contrasting half of the sign-in pages: black beside the light form,
// white beside the dark one. A few moments from the product, floating gently
// and leaning toward the pointer. Decorative only.
export function AuthShowcase() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = root.current!;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const cards = gsap.utils.toArray<HTMLElement>("[data-float]", el);
        cards.forEach((card, i) => {
          gsap.fromTo(card, { y: 0 }, { y: -9, duration: 2.6 + i * 0.45, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 0.9 + i * 0.35 });
        });
        // Depth: nearer cards move more with the pointer.
        const movers = cards.map((card) => ({
          depth: Number(card.dataset.depth ?? 1),
          x: gsap.quickTo(card, "x", { duration: 0.9, ease: "power3" }),
          r: gsap.quickTo(card, "rotation", { duration: 0.9, ease: "power3" }),
        }));
        const onMove = (e: PointerEvent) => {
          const box = el.getBoundingClientRect();
          const dx = (e.clientX - box.left) / box.width - 0.5;
          for (const m of movers) {
            m.x(dx * 28 * m.depth);
            m.r(dx * 1.6 * m.depth);
          }
        };
        const onLeave = () => {
          for (const m of movers) {
            m.x(0);
            m.r(0);
          }
        };
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerleave", onLeave);
        return () => {
          el.removeEventListener("pointermove", onMove);
          el.removeEventListener("pointerleave", onLeave);
        };
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} aria-hidden className="auth-stage relative hidden overflow-hidden border-l border-ink select-none lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:self-start">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] bg-size-[44px_44px] opacity-[0.06] mask-[radial-gradient(ellipse_at_center,black,transparent_75%)]" />

      <div className="relative px-12 pt-14">
        <p className="auth-stage-muted animate-enter font-mono text-[11px] tracking-[0.14em] uppercase">Confu</p>
        <p className="animate-enter mt-3 max-w-md font-serif text-4xl leading-[1.1] tracking-tight" style={{ animationDelay: "80ms" }}>
          Understand it deeply, <span className="text-yellow-300">not just skim it.</span>
        </p>
      </div>

      <div className="relative flex-1">
        <Card className="top-[8%] left-[10%] w-72" depth={0.6} delay={200}>
          <p className="font-mono text-[10px] text-muted">D1 · p. 12</p>
          <p className="mt-1.5 text-[13px] leading-relaxed">
            PCA keeps the directions of{" "}
            <span className="bg-[linear-gradient(transparent_55%,var(--marker)_55%)]">greatest variance in the data</span>, ordered by how much they
            explain.
          </p>
          <div className="mt-3 flex flex-wrap gap-1">
            {["Ask a doubt", "Summarize", "Context", "Simplify"].map((a, i) => (
              <span key={a} className={`rounded border px-1.5 py-0.5 text-[10px] ${i === 0 ? "border-ink bg-ink text-white" : "border-ink/30"}`}>
                {a}
              </span>
            ))}
          </div>
        </Card>

        <Card className="top-[36%] right-[8%] w-80" depth={1.2} delay={360}>
          <p className="font-mono text-[10px] tracking-widest text-muted uppercase">Tutor</p>
          <p className="mt-1.5 text-[13px] leading-relaxed">
            Think of each eigenvector as an axis the data stretches along. The bigger its eigenvalue, the more of the spread it captures{" "}
            <span className="rounded bg-paper px-1 font-mono text-[11px] underline">D1 p. 12</span>.
          </p>
          <p className="mt-2 text-[13px] font-medium">Quick check: why centre the data first?</p>
        </Card>

        <Card className="bottom-[14%] left-[16%] w-64" depth={0.9} delay={520}>
          <div className="flex items-center justify-between">
            <p className="font-serif text-lg">Linear algebra</p>
            <span className="rounded-full border border-ink/30 px-2 py-px font-mono text-[10px]">12 days</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full w-[68%] rounded-full bg-ink" />
          </div>
          <p className="mt-1.5 font-mono text-[10px] text-muted">68% correct · weak: eigenvectors</p>
        </Card>
      </div>

      <p className="auth-stage-muted relative px-12 pb-10 font-mono text-[11px]">Free to start · Pro in early access · Your notes stay yours</p>
    </div>
  );
}

function Card({ children, className, depth, delay }: { children: ReactNode; className: string; depth: number; delay: number }) {
  // The CSS entrance runs on the wrapper; GSAP moves the card inside it.
  return (
    <div className={`animate-enter absolute ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <div data-float data-depth={depth} className="rounded-xl border border-ink bg-panel p-4 text-ink shadow-[5px_5px_0_0_#facc15]">
        {children}
      </div>
    </div>
  );
}

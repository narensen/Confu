import type { ReactNode } from "react";

// Static miniatures of the real product for the landing page, drawn with the
// app's own styles. Purely decorative: hidden from assistive tech.

function Line({ w = "100%", tone = "bg-line" }: { w?: string; tone?: string }) {
  return <div className={`h-1.5 rounded-full ${tone}`} style={{ width: w }} />;
}

function Chip({ children, dark, dashed }: { children: ReactNode; dark?: boolean; dashed?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-px font-mono text-[10px] ${
        dark ? "border-ink bg-ink text-on-ink" : dashed ? "border-dashed border-ink/50" : "border-ink/40"
      }`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- hero mock */

// The session as it is now: tutor on the left, the PDF in the middle, the
// small tool bar on the right edge, and the selection toolbar over the page.
export function WorkspaceMock() {
  return (
    <div aria-hidden className="relative select-none">
      <div className="overflow-hidden rounded-2xl border border-ink bg-panel shadow-[8px_8px_0_0_var(--ink)]">
        {/* app bar: back to the library, the session's title */}
        <div className="flex items-center gap-2 border-b border-ink px-4 py-2.5 text-xs">
          <span className="text-muted">‹</span>
          <span className="font-serif text-sm font-semibold">
            Confu<span className="text-brand">.</span>
          </span>
          <span className="border-l border-line pl-2 font-medium">Linear algebra for ML</span>
          <span className="ml-auto flex size-6 items-center justify-center rounded-full bg-brand font-serif text-xs">A</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.15fr]">
          {/* tutor */}
          <div className="flex flex-col gap-3 border-b border-ink p-4 md:border-r md:border-b-0">
            <div className="flex items-center gap-2 border-b border-line pb-2 text-xs">
              <span className="font-medium">Tutor</span>
              <span className="rounded-md bg-paper px-1.5 py-0.5 text-muted">Claude ▾</span>
              <span className="ml-auto text-muted">Eigenvectors · 40%</span>
            </div>
            <div data-mock="bubble" className="ml-6 rounded-xl rounded-br-sm border border-ink p-2.5 text-xs">
              <p className="border-l-2 border-ink pl-2 text-muted">“…its eigenvalue equals the variance captured”</p>
              <p className="mt-1.5">Why is the eigenvalue the variance?</p>
            </div>
            <div data-mock="answer" className="space-y-1.5 text-xs leading-relaxed">
              <p>
                Project every point onto the eigenvector <i>u</i>. The spread of those projections is <i>uᵀΣu</i>, and since <i>Σu = λu</i>,
                that&apos;s exactly <b>λ</b> <span className="rounded bg-paper px-1 font-mono underline">p. 12</span>.
              </p>
              <p className="font-medium">
                Quick check: what variance do you get along the second eigenvector?
                <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-ink" />
              </p>
            </div>
            <div className="mt-auto rounded-lg border border-line px-2.5 py-2 text-xs text-muted">Ask about this page…</div>
          </div>

          {/* pdf */}
          <div className="relative bg-viewer p-4 pr-10">
            <div className="flex gap-1 pb-2 text-xs">
              <span className="rounded-t border border-b-0 border-ink/20 bg-panel px-2 py-1">MML book</span>
              <span className="px-2 py-1 text-muted">Lecture 7</span>
            </div>
            <div className="space-y-2 border border-ink/20 bg-[#ffffff] p-4 text-xs leading-relaxed text-neutral-900">
              <Line w="45%" tone="bg-neutral-900/70" />
              <p className="text-neutral-900/80">
                The first principal component is the direction of{" "}
                <span data-mock="mark" className="bg-[linear-gradient(rgba(253,216,53,0.55),rgba(253,216,53,0.55))] bg-no-repeat">
                  maximal variance; its eigenvalue equals the variance captured
                </span>{" "}
                along it.
              </p>
              <Line />
              <Line w="88%" />
              <div className="relative mt-2 h-20 border border-neutral-900/20">
                <svg viewBox="0 0 200 70" className="h-full w-full">
                  <line x1="10" y1="62" x2="195" y2="62" stroke="#171717" strokeWidth="0.8" />
                  <line x1="10" y1="62" x2="10" y2="4" stroke="#171717" strokeWidth="0.8" />
                  {[
                    [30, 50],
                    [45, 44],
                    [60, 47],
                    [75, 36],
                    [95, 33],
                    [110, 26],
                    [130, 22],
                    [150, 18],
                    [170, 12],
                    [85, 42],
                  ].map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r="2.4" fill={i % 3 ? "#171717" : "#eab308"} />
                  ))}
                  <line x1="20" y1="56" x2="185" y2="8" stroke="#171717" strokeDasharray="3 3" strokeWidth="0.8" />
                </svg>
              </div>
              <Line w="76%" />
            </div>

            {/* selection toolbar */}
            <div data-mock="popover" data-float className="absolute top-[44%] left-[6%] flex items-center gap-0.5 rounded-lg border border-ink bg-panel p-1 text-xs shadow-[3px_3px_0_0_var(--ink)]">
              <span className="rounded bg-ink px-1.5 py-1 font-medium text-panel">Ask a doubt</span>
              <span className="px-1.5 py-1">Summarize</span>
              <span className="hidden px-1.5 py-1 lg:inline">Simplify</span>
              <span className="mx-0.5 h-4 w-px bg-line" />
              <span className="size-3 rounded-full bg-brand" />
              <span className="size-3 rounded-full bg-sky-300" />
            </div>

            {/* the tool bar on the right edge: Plan, Highlights, Progress, Files */}
            <div className="absolute top-1/2 right-2 flex -translate-y-1/2 flex-col gap-1 rounded-lg border border-ink/30 bg-panel p-1">
              {["M4 6h16M4 12h10M4 18h7", "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z", "M3 3v18h18M7 15l4-4 3 3 5-6", "M6 2h9l5 5v15H6z"].map((d) => (
                <span key={d} className="flex size-6 items-center justify-center text-muted">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d={d} />
                  </svg>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ mode mocks */

export function PlanMock() {
  return (
    <div aria-hidden className="space-y-1.5">
      <p className="font-mono text-[9px] tracking-widest text-muted uppercase">Phase 01 · Foundations</p>
      {[
        { n: "✓", t: "Vectors and covariance", tag: <Chip>D1 pp. 3–8</Chip>, done: true },
        { n: "2", t: "Python with NumPy", tag: <Chip dashed>Beyond your files</Chip>, focus: true },
        { n: "3", t: "Eigen-decomposition", tag: <Chip>D2 pp. 21–26</Chip> },
      ].map((r) => (
        <div key={r.t} data-mock-item className={`flex items-center gap-2 rounded-lg border bg-panel px-2.5 py-2 ${r.focus ? "border-ink shadow-[2px_2px_0_0_var(--ink)]" : "border-line"}`}>
          <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] ${r.done ? "border-ink bg-ink text-on-ink" : "border-ink"}`}>{r.n}</span>
          <div className="min-w-0 flex-1">
            <p className={`truncate text-[11px] ${r.done ? "text-muted line-through" : "font-medium"}`}>{r.t}</p>
            <div className="mt-1 flex items-center gap-1.5 text-[9px] text-muted">{r.tag} Due Nov 12</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ExamMock() {
  return (
    <div aria-hidden className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="font-serif text-sm">12 days to the exam</p>
        <p className="font-mono text-[9px] text-muted">3 / 5</p>
      </div>
      <p className="text-[11px] font-medium leading-snug">Which algorithm minimises average waiting time when burst times are known?</p>
      {[
        ["First-come, first-served", "wrong"],
        ["Shortest job first", "right"],
        ["Round robin", ""],
      ].map(([t, s]) => (
        <div
          key={t}
          data-mock-item
          className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[10px] ${
            s === "right" ? "border-ok bg-ok/5" : s === "wrong" ? "border-danger bg-danger/5" : "border-line opacity-60"
          }`}
        >
          <span
            className={`flex size-4 items-center justify-center rounded-full border text-[8px] ${
              s === "right" ? "border-ok bg-ok text-on-ink" : s === "wrong" ? "border-danger bg-danger text-on-ink" : "border-ink/40"
            }`}
          >
            {s === "right" ? "✓" : s === "wrong" ? "✕" : ""}
          </span>
          {t}
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1 text-[9px]">
        <span className="rounded-full border border-danger/50 px-1.5 text-danger">Weak</span>
        <span className="text-muted">Deadlocks</span>
        <span className="h-1 flex-1 rounded-full bg-line">
          <span className="block h-full w-1/4 rounded-full bg-danger" />
        </span>
      </div>
    </div>
  );
}

export function PaperMock() {
  return (
    <div aria-hidden className="space-y-1.5">
      <div data-mock-item className="rounded-md border border-ink/40 bg-panel px-2 py-1.5 font-mono text-[10px]">
        2402.03300 <span className="text-muted">→</span> <Chip dark>PDF available</Chip>
      </div>
      {[
        ["D1", "Proximal Policy Optimization", 2, 1],
        ["D2", "DeepSeekMath: GRPO", 3, 2],
        ["D3", "Let's Verify Step by Step", 2, 2],
        ["D4", "A survey of LLMs", 1, 1],
      ].map(([l, t, target, done]) => (
        <div key={l as string} data-mock-item className="flex items-center gap-2 rounded-md border border-line bg-panel px-2 py-1.5">
          <Chip dark={l === "D2"}>{l}</Chip>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-medium">{t}</p>
            <div className="mt-1 flex gap-0.5">
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className={`h-1 w-4 rounded-full ${n <= (done as number) ? "bg-ink" : n <= (target as number) ? "bg-ink/20" : "border border-dashed border-ink/20"}`}
                />
              ))}
            </div>
          </div>
          <span className="font-mono text-[9px] text-muted">pass {target}</span>
        </div>
      ))}
    </div>
  );
}

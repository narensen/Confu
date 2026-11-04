"use client";

import { useState } from "react";

// One series per day as columns: ink bars from a single baseline, 4px rounded
// tops, 2px gaps, a hover/focus tooltip per day, and a table view.

type Point = { day: string; value: number };

const fmt = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

// A clean axis maximum: 5, 10, 20, 50, 100…
function niceMax(v: number) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

export function DailyChart({ title, points, unit }: { title: string; points: Point[]; unit: string }) {
  const [active, setActive] = useState<number | null>(null);
  const top = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const total = points.reduce((s, p) => s + p.value, 0);
  const last = points.at(-1);
  const hovered = active !== null ? points[active] : null;

  return (
    <figure className="rounded-xl border border-ink bg-panel p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-serif text-xl">{title}</span>
        {/* The readout: the hovered day, otherwise the range total. */}
        <span aria-live="polite" className="font-mono text-[11px] text-muted">
          {hovered ? (
            <>
              <strong className="text-sm font-semibold text-ink">{hovered.value.toLocaleString("en")}</strong> {unit} · {fmt(hovered.day)}
            </>
          ) : (
            <>
              {total.toLocaleString("en")} total{last ? ` · ${last.value} today` : ""}
            </>
          )}
        </span>
      </figcaption>

      <div className="mt-4 flex gap-2">
        <div className="relative h-40 flex-1" onPointerLeave={() => setActive(null)}>
          {/* recessive grid: top, middle, baseline */}
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-line" />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-line" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-ink/40" />

          <div className="absolute inset-0 flex items-end gap-0.5">
            {points.map((p, i) => (
              <button
                key={p.day}
                type="button"
                aria-label={`${fmt(p.day)}: ${p.value} ${unit}`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="flex h-full min-w-0 flex-1 items-end justify-center rounded-sm outline-none focus-visible:bg-paper"
              >
                <span
                  className={`block w-full max-w-6 rounded-t-sm transition-colors duration-150 ${active === i ? "bg-yellow-400" : "bg-ink"}`}
                  style={{ height: `${(p.value / top) * 100}%`, minHeight: p.value ? 2 : 0 }}
                />
              </button>
            ))}
          </div>

        </div>
        {/* y-axis ticks */}
        <div className="flex h-40 w-8 flex-col justify-between text-right font-mono text-[10px] text-muted tabular-nums">
          <span className="-translate-y-1/2">{top}</span>
          <span>{top / 2}</span>
          <span className="translate-y-1/2">0</span>
        </div>
      </div>

      {points.length > 0 && (
        <div className="mt-2 mr-10 flex justify-between font-mono text-[10px] text-muted">
          <span>{fmt(points[0].day)}</span>
          <span>{fmt(points[Math.floor(points.length / 2)].day)}</span>
          <span>{fmt(points[points.length - 1].day)}</span>
        </div>
      )}

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted transition hover:text-ink">Table view</summary>
        <div className="mt-2 max-h-48 overflow-y-auto">
          <table className="w-full">
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.day} className="border-t border-line">
                  <td className="py-1">{fmt(p.day)}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{p.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

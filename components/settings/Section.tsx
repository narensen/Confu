import type { ReactNode } from "react";

// A settings section and its rows, in the style of a publication's settings:
// a serif heading, then "label · explanation · action" rows.
export function Section({ id, title, description, danger, children }: { id: string; title: string; description?: ReactNode; danger?: boolean; children: ReactNode }) {
  return (
    <section id={id} data-settings-section className="scroll-mt-28 lg:scroll-mt-16">
      <h2 className={`font-serif text-3xl tracking-tight ${danger ? "text-danger" : ""}`}>{title}</h2>
      {description && <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">{description}</p>}
      <div className={`mt-5 rounded-2xl border bg-panel ${danger ? "border-danger/50" : "border-ink"}`}>{children}</div>
    </section>
  );
}

export function Row({ label, hint, children, wide }: { label: string; hint?: ReactNode; children?: ReactNode; wide?: boolean }) {
  return (
    <div className={`grid gap-3 border-t border-line px-5 py-5 first:border-t-0 sm:px-6 ${wide ? "" : "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-8"}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <div className="mt-1 text-sm leading-relaxed text-muted">{hint}</div>}
      </div>
      {children && <div className={wide ? "" : "sm:justify-self-end"}>{children}</div>}
    </div>
  );
}

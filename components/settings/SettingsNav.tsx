"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type NavItem = { id: string; label: string; danger?: boolean; badge?: number };

// Section menu for Settings: highlights the section you're reading, scrolls
// smoothly on click. A sticky sidebar on desktop, swipeable tabs on phones.
export function SettingsNav({ items }: { items: NavItem[] }) {
  const [active, setActive] = useState(items[0]?.id);
  const list = useRef<HTMLUListElement>(null);
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    // The first section (in page order) inside a band near the top of the screen.
    const inBand = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target.id);
          else inBand.delete(e.target.id);
        }
        const first = items.find((i) => inBand.has(i.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-15% 0px -60% 0px" },
    );
    for (const i of items) {
      const section = document.getElementById(i.id);
      if (section) io.observe(section);
    }
    // Short sections at the very end never reach the band: at the bottom of
    // the page, the last one is the one being read.
    const onScroll = () => {
      const root = document.documentElement;
      if (window.innerHeight + window.scrollY >= root.scrollHeight - 4) setActive(items[items.length - 1]?.id);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [items]);

  useLayoutEffect(() => {
    const ul = list.current;
    const el = ul?.querySelector<HTMLElement>(`[data-nav="${active}"]`);
    if (!ul || !el) return;
    // Sliding marker beside the active item (desktop).
    setMarker({ top: el.offsetTop, height: el.offsetHeight });
    // Phones: keep the active tab in view. Only the tab strip scrolls, so a
    // smooth scroll to a section isn't interrupted.
    if (ul.scrollWidth > ul.clientWidth) ul.scrollTo({ left: el.offsetLeft - (ul.clientWidth - el.offsetWidth) / 2, behavior: "smooth" });
  }, [active]);

  return (
    <nav aria-label="Settings sections" className="sticky top-0 z-20 -mx-4 border-b border-ink/10 bg-paper/95 px-4 backdrop-blur lg:top-10 lg:mx-0 lg:self-start lg:border-0 lg:bg-transparent lg:px-0">
      <ul ref={list} className="relative flex gap-1 overflow-x-auto py-2 scrollbar-none lg:flex-col lg:gap-0.5 lg:overflow-visible lg:py-0">
        {marker && (
          <span
            aria-hidden
            className="absolute left-0 hidden w-0.5 rounded-full bg-ink transition-all duration-300 ease-fluid lg:block"
            style={{ top: marker.top, height: marker.height }}
          />
        )}
        {items.map((item) => (
          <li key={item.id} data-nav={item.id} className="shrink-0">
            <a
              href={`#${item.id}`}
              onClick={() => setActive(item.id)}
              aria-current={active === item.id ? "true" : undefined}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors lg:rounded-none lg:pl-4 ${
                active === item.id
                  ? "bg-ink text-white lg:bg-transparent lg:font-medium lg:text-ink"
                  : item.danger
                    ? "text-danger/80 hover:text-danger"
                    : "text-muted hover:text-ink"
              }`}
            >
              {item.label}
              {item.badge ? (
                <span className="rounded-full bg-yellow-300 px-1.5 font-mono text-[10px] leading-4 font-medium text-ink">{item.badge}</span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

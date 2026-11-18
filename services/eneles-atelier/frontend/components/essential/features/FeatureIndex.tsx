"use client";

import { useEffect, useRef } from "react";

/**
 * The Features page's index: one chip per section, in a bar that stays under the site header while the page scrolls, and fills as the page is read. Each chip carries a fill along its foot: full for the sections already read, partway for the one being read, empty for those ahead; the current chip's label is lit. The lit chip is kept in view (the bar scrolls sideways on a narrow window), and pressing a chip goes to its section.
 *
 * The fill moves on every scrolled frame, so it is written straight to the chips' styles instead of through React state: nothing re-renders while the page scrolls.
 */
export function FeatureIndex({ items }: { items: { id: string; label: string }[] }) {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = bar.current;
    if (!strip) return;
    const sections = items.map((item) => document.getElementById(item.id)).filter((el): el is HTMLElement => !!el);
    const chips = items.map((item) => strip.querySelector<HTMLElement>(`[data-id="${CSS.escape(item.id)}"]`));
    if (!sections.length) return;
    let frame = 0;
    let lit = -1;

    const read = () => {
      frame = 0;
      // The reading line: a third of the way down the window, under the bars.
      const line = window.innerHeight * 0.33;
      let current = -1;
      sections.forEach((section, i) => {
        const top = section.getBoundingClientRect().top;
        const next = sections[i + 1]?.getBoundingClientRect().top ?? section.getBoundingClientRect().bottom;
        const span = Math.max(1, next - top);
        const progress = Math.min(1, Math.max(0, (line - top) / span));
        if (progress > 0) current = i;
        const chip = chips[i];
        if (chip) {
          chip.style.setProperty("--fill", progress.toFixed(3));
          chip.dataset.state = progress >= 1 ? "read" : progress > 0 ? "reading" : "ahead";
        }
      });
      if (current !== lit) {
        lit = current;
        chips.forEach((chip, i) => chip?.toggleAttribute("aria-current", i === current));
        // The lit chip stays in view in the bar, without moving the page.
        const chip = chips[current];
        if (chip) strip.scrollTo({ left: chip.offsetLeft - strip.clientWidth / 2 + chip.offsetWidth / 2, behavior: "smooth" });
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  return (
    <nav aria-label="Features" className="sticky top-16 z-40 border-y border-line bg-background/85 backdrop-blur-xl">
      <div ref={bar} className="container flex items-center gap-1 overflow-x-auto py-2 [scrollbar-width:none] @5xl:justify-between [&::-webkit-scrollbar]:hidden">
        {items.map((item, i) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            data-id={item.id}
            data-state="ahead"
            className="group relative flex h-[var(--control-height)] shrink-0 items-center gap-2 overflow-hidden rounded-[var(--radius)] px-3 type-base font-medium text-muted-foreground transition-colors hover:bg-surface-hover/60 hover:text-foreground aria-[current]:bg-surface-hover aria-[current]:text-foreground data-[state=read]:text-foreground/80"
          >
            <span className="font-mono type-small tabular-nums opacity-60">{String(i + 1).padStart(2, "0")}</span>
            {item.label}
            {/* How much of the section has been read. */}
            <span aria-hidden className="absolute inset-x-2 bottom-1 h-0.5 overflow-hidden rounded-full bg-line/0 group-data-[state=reading]:bg-line group-data-[state=read]:bg-line">
              <span className="block h-full w-full origin-left scale-x-[var(--fill,0)] rounded-full bg-foreground/70 transition-transform duration-150 ease-out motion-still:transition-none group-data-[state=read]:bg-foreground/35" />
            </span>
          </a>
        ))}
      </div>
    </nav>
  );
}

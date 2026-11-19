"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface LongScrollProps {
  children: React.ReactNode;
  className?: string;
  /** Max height for the scroll area, e.g. "min(360px,70vh)". Ignored with `fill`. */
  maxHeight?: string;
  /** The scroll area fills its parent (give `className` a height, or flex-1 min-h-0). */
  fill?: boolean;
  /** A ref to the scrolling element, for scrollIntoView and the like. */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  /** Classes for the scrolling element (padding, scrollbar style). */
  scrollClassName?: string;
  /** Height of each fade. */
  fade?: string;
  /** Passed to the scrolling element. */
  scrollProps?: React.HTMLAttributes<HTMLDivElement>;
}

/**
 * A scroll area that shows there is more by fading its content out at the edge it continues past: nothing at the top when scrolled to the top, both edges in the middle, nothing at the bottom at the end.
 *
 * The fade is a mask on the content, not a painted gradient, so it is right on any surface (a panel, a dialog, a popover) in any theme, with no color to keep in sync. Content and size changes are watched as well as scrolling, so expanding something inside updates the fades.
 */
export function LongScroll({ children, className, maxHeight = "min(360px,70vh)", fill = false, scrollRef, scrollClassName, fade = "1.5rem", scrollProps = {} }: LongScrollProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = scrollRef ?? ownRef;
  const [edges, setEdges] = useState({ top: false, bottom: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      // A couple of pixels of slack, so sub-pixel rounding never leaves a fade on at an edge.
      const top = el.scrollTop > 2;
      const bottom = el.scrollTop < el.scrollHeight - el.clientHeight - 2;
      setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    el.addEventListener("scroll", schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    for (const child of Array.from(el.children)) resize.observe(child);
    const mutation = new MutationObserver(schedule);
    mutation.observe(el, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", schedule);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [ref]);

  return (
    <div className={cn("relative min-h-0", fill && "flex flex-col", className)}>
      <div
        {...scrollProps}
        ref={ref}
        data-fade-top={edges.top ? "" : undefined}
        data-fade-bottom={edges.bottom ? "" : undefined}
        style={{ "--fade": fade, ...(fill ? {} : { maxHeight }) } as React.CSSProperties}
        className={cn(
          "overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_var(--fade-top,0px),black_calc(100%-var(--fade-bottom,0px)),transparent)] data-[fade-bottom]:[--fade-bottom:var(--fade)] data-[fade-top]:[--fade-top:var(--fade)]",
          fill && "min-h-0 flex-1",
          scrollClassName,
          scrollProps.className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

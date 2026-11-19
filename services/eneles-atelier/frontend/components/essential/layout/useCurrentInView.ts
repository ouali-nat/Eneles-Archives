"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Keeps the current page's entry (`aria-current="page"`) in view inside a scrolling navigation column. When the page opens, and whenever `key` (the path) changes, an entry outside the column's visible box is scrolled to its middle; one already in sight is left where it is, so the column never jumps under the reader. Only the column scrolls, never the page. The first placement is instant; later ones glide unless the reader asked for less motion.
 */
export function useCurrentInView(scroller: RefObject<HTMLElement | null>, key: string) {
  const placed = useRef(false);
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const place = () => {
      const column = scroller.current;
      const entry = column?.querySelector<HTMLElement>('[aria-current="page"]');
      // The entry may appear a frame later (a package that opens for it); look again a few times.
      if (!column || !entry) {
        if (tries++ < 10) frame = requestAnimationFrame(place);
        return;
      }
      if (column.clientHeight === 0) return;
      const box = column.getBoundingClientRect();
      const at = entry.getBoundingClientRect();
      const fade = 48;
      const inSight = at.top >= box.top + fade && at.bottom <= box.bottom - fade;
      const first = !placed.current;
      placed.current = true;
      if (inSight) return;
      const top = column.scrollTop + (at.top - box.top) - (box.height - at.height) / 2;
      const still = first || (document.documentElement.dataset.motion ?? "full") !== "full";
      column.scrollTo({ top: Math.max(0, top), behavior: still ? "instant" : "smooth" });
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [scroller, key]);
}

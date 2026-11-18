"use client";

import type { ReactNode } from "react";
import { LongScroll } from "@/components/essential/layout/LongScroll";
import { cn } from "@/lib/utils";

/**
 * A navigation column that scrolls without a scrollbar and fades at the edge it continues past. A permanent scrollbar down a tree is noise; the fade keeps the cue that there is more.
 */
export function ScrollFade({ children, className, viewportClassName, scrollRef }: { children: ReactNode; className?: string; viewportClassName?: string; /** The scrolling element, to bring an entry into view. */ scrollRef?: React.RefObject<HTMLDivElement | null> }) {
  return (
    <LongScroll fill fade="3rem" scrollRef={scrollRef} className={cn("h-full", className)} scrollClassName={cn("scrollbar-hidden", viewportClassName)}>
      {children}
    </LongScroll>
  );
}

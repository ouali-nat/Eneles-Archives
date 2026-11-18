"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import { useMotion } from "@/hooks/useMotion";

/**
 * Makes every framer-motion animation follow the app's motion setting, the same one the CSS animations read from <html data-motion>: Full plays them, Reduced keeps fades and drops movement, and Off finishes them at once. Without this, scroll reveals and drawers ignored the setting.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const { level } = useMotion();
  return (
    <MotionConfig reducedMotion={level === "full" ? "never" : "always"} transition={level === "off" ? { duration: 0 } : undefined}>
      {children}
    </MotionConfig>
  );
}

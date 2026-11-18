"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { useTheme } from "next-themes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMotion } from "@/hooks/useMotion";
import { cn } from "@/lib/utils";

const noop = () => () => {};

// A view transition belongs to the whole document, so every toggle on the page shares one lock: a press while a reveal is running is dropped.
let revealing = false;

/** How long the reveal takes. Matches --theme-reveal-duration's use in globals.css. */
const REVEAL_MS = 600;

/**
 * One button that flips between the dark and the light palette.
 *
 * The change grows out of the button as a circle: the new palette is clipped to a circle that starts at the button's centre and widens until it covers the window. The stylesheet owns that animation from the snapshot's first frame (globals.css, "Theme reveal"), so there is no frame of the new palette unclipped. With motion reduced or off, or in a browser without view transitions, the palette simply changes.
 *
 * The glyph names where the press goes: a sun on the dark palette, a moon on the light one. It is one drawing with both forms in it; one sets, shrinking and turning away, as the other turns in. The sun's rays turn a step and the moon rocks when the button is hovered.
 */
export function ModeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const { animates } = useMotion();
  const button = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  // The resolved theme is only known in the browser.
  const ready = useSyncExternalStore(noop, () => true, () => false);
  const light = ready && resolvedTheme === "light";
  const next = light ? "dark" : "light";
  const label = ready ? `Switch to ${next} mode` : "Switch color mode";

  const toggle = async () => {
    const root = document.documentElement;
    if (!ready || revealing || root.hasAttribute("data-theme-transition")) return;
    const element = button.current;
    if (!animates || !element || typeof document.startViewTransition !== "function") {
      setTheme(next);
      return;
    }
    const { left, top, width, height } = element.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Percentages, so the geometry holds at fractional display scales; a circle's percentage radius is measured against the normalized diagonal.
    const origin = `${(x / vw) * 100}% ${(y / vh) * 100}%`;
    const radius = ((Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y)) + 1) / (Math.hypot(vw, vh) / Math.SQRT2)) * 100;
    root.style.setProperty("--theme-reveal-from", `circle(0% at ${origin})`);
    root.style.setProperty("--theme-reveal-to", `circle(${radius}% at ${origin})`);
    root.style.setProperty("--theme-reveal-duration", `${REVEAL_MS}ms`);
    root.dataset.themeTransition = "";
    revealing = true;
    setBusy(true);
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      flushSync(() => setTheme(next));
    };
    let transition: ViewTransition | undefined;
    try {
      transition = document.startViewTransition(commit);
      await transition.ready;
    } catch {
      transition?.skipTransition();
      commit();
    } finally {
      await transition?.finished.catch(() => {});
      delete root.dataset.themeTransition;
      root.style.removeProperty("--theme-reveal-from");
      root.style.removeProperty("--theme-reveal-to");
      root.style.removeProperty("--theme-reveal-duration");
      revealing = false;
      setBusy(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
    <button
      ref={button}
      type="button"
      onClick={() => void toggle()}
      disabled={!ready}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      aria-label={label}
      className={cn(
        "inline-flex size-[var(--control-height)] shrink-0 items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-100",
        className,
      )}
    >
      {/* Mounted afresh once the stored theme is known, so a reader on the light palette does not see the glyph turn on page load. */}
      <svg key={ready ? "ready" : "pending"} aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" data-active={light || undefined} className="mode-glyph size-4">
        <g data-part="sun">
          <path d="M17 12C17 14.7614 14.7614 17 12 17C9.23858 17 7 14.7614 7 12C7 9.23858 9.23858 7 12 7C14.7614 7 17 9.23858 17 12Z" />
          <path data-part="rays" d="M12 2V3.5M12 20.5V22M19.0708 19.0713L18.0101 18.0106M5.98926 5.98926L4.9286 4.9286M22 12H20.5M3.5 12H2M19.0713 4.92871L18.0106 5.98937M5.98975 18.0107L4.92909 19.0714" />
        </g>
        <path data-part="moon" d="M21.5 14.0784C20.3003 14.7189 18.9301 15.0821 17.4751 15.0821C12.7491 15.0821 8.91792 11.2509 8.91792 6.52485C8.91792 5.06986 9.28105 3.69968 9.92163 2.5C5.66765 3.49698 2.5 7.31513 2.5 11.8731C2.5 17.1899 6.8101 21.5 12.1269 21.5C16.6849 21.5 20.503 18.3324 21.5 14.0784Z" />
      </svg>
    </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

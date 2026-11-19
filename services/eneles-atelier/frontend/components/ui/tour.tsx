"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A guided tour: a short run of cards, each pointing at one part of the page while the rest dims behind a spotlight. The card sits beside what it describes and stays inside the window; moving between steps glides the spotlight (it jumps when motion is reduced). A step with no target, or whose target is not on the page, shows its card in the middle with the whole page dimmed.
 *
 * It can always be left: the close button, "Skip", and Escape all end it. While it is open the page behind does not take clicks, so nothing is changed by accident.
 */
export interface TourStep {
  id: string;
  /** What the step points at: a selector, or a function that finds the element. */
  target?: string | (() => Element | null | undefined);
  title: string;
  content: ReactNode;
  /** Where the card prefers to sit. It moves to another side when this one has no room. */
  side?: "top" | "right" | "bottom" | "left";
}

type Box = { top: number; left: number; width: number; height: number };

const GAP = 12;
const PADDING = 6;
const MARGIN = 12;

function find(step: TourStep): HTMLElement | null {
  try {
    const found = typeof step.target === "function" ? step.target() : step.target ? document.querySelector(step.target) : null;
    if (!(found instanceof HTMLElement)) return null;
    const rect = found.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? found : null;
  } catch {
    return null;
  }
}

/** Where the card goes: beside the target on the preferred side if it fits, else the first side that does, else over the target's corner; always inside the window. */
function place(target: Box | null, card: { width: number; height: number }, prefer: NonNullable<TourStep["side"]>): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.min(Math.max(x, MARGIN), Math.max(vw - card.width - MARGIN, MARGIN));
  const clampY = (y: number) => Math.min(Math.max(y, MARGIN), Math.max(vh - card.height - MARGIN, MARGIN));
  if (!target) return { top: clampY((vh - card.height) / 2), left: clampX((vw - card.width) / 2) };
  const centreX = target.left + target.width / 2 - card.width / 2;
  const centreY = target.top + target.height / 2 - card.height / 2;
  const spots = {
    right: { fits: target.left + target.width + GAP + card.width + MARGIN <= vw, top: clampY(Math.min(centreY, target.top)), left: target.left + target.width + GAP },
    left: { fits: target.left - GAP - card.width - MARGIN >= 0, top: clampY(Math.min(centreY, target.top)), left: target.left - GAP - card.width },
    bottom: { fits: target.top + target.height + GAP + card.height + MARGIN <= vh, top: target.top + target.height + GAP, left: clampX(centreX) },
    top: { fits: target.top - GAP - card.height - MARGIN >= 0, top: target.top - GAP - card.height, left: clampX(centreX) },
  };
  const order = [prefer, "right", "bottom", "left", "top"] as const;
  const side = order.find((s) => spots[s].fits);
  if (side) return { top: spots[side].top, left: spots[side].left };
  // No side has room (the target fills the window): sit inside its lower right corner.
  return { top: clampY(target.top + target.height - card.height - GAP), left: clampX(target.left + target.width - card.width - GAP) };
}

export function Tour({ steps, open, onClose, onFinish, finishLabel = "Done" }: { steps: TourStep[]; open: boolean; /** The reader left early or finished. */ onClose: () => void; /** The reader pressed the last step's button. */ onFinish?: () => void; finishLabel?: string }) {
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Box | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;

  // Each opening starts at the first step.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setIndex(0);
  }

  const measure = useCallback(() => {
    if (!step) return;
    const element = find(step);
    const rect = element?.getBoundingClientRect();
    const box = rect ? { top: rect.top - PADDING, left: rect.left - PADDING, width: rect.width + PADDING * 2, height: rect.height + PADDING * 2 } : null;
    setHole(box);
    const size = card.current ? { width: card.current.offsetWidth, height: card.current.offsetHeight } : { width: 360, height: 200 };
    setPosition(place(box, size, step.side ?? "right"));
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return;
    find(step)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    // Measured on the next frame, once the card has its size, and again as panels settle and fonts load: the target is followed for as long as the step is shown.
    const frame = requestAnimationFrame(measure);
    const again = window.setInterval(measure, 400);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(again);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step, measure]);

  // The card takes the focus on each step, so Enter moves on and a screen reader reads the step. It can only take it once it is placed: a hidden element cannot be focused.
  const placed = position !== null;
  useEffect(() => {
    if (open && placed) card.current?.querySelector<HTMLElement>("[data-tour-primary]")?.focus({ preventScroll: true });
  }, [open, placed, index]);

  // Keys are the tour's while it is open, wherever the focus was left: a key pressed in the page behind (the editor, say) must not type into it.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const next = () => {
    if (last) {
      onFinish?.();
      onClose();
    } else setIndex((i) => i + 1);
  };
  const back = () => setIndex((i) => Math.max(i - 1, 0));

  const onKey = (event: KeyboardEvent) => {
    const inside = !!card.current?.contains(event.target as Node);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (!inside) {
      // The focus is somewhere behind the tour: bring it back, and let Enter and the arrows drive the tour from there.
      event.preventDefault();
      event.stopPropagation();
      card.current?.querySelector<HTMLElement>("[data-tour-primary]")?.focus({ preventScroll: true });
      if (event.key === "Enter" || event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") back();
      return;
    }
    if (event.key === "ArrowRight") next();
    else if (event.key === "ArrowLeft") back();
    else if (event.key === "Tab") {
      // Keep the focus in the card: the page behind is not usable while the tour is open.
      const stops = [...(card.current?.querySelectorAll<HTMLElement>("button, a[href]") ?? [])];
      if (!stops.length) return;
      const first = stops[0];
      const final = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        final.focus();
      } else if (!event.shiftKey && document.activeElement === final) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  // The window listener above calls whatever this render's handler is.
  useEffect(() => {
    keys.current = onKey;
  });

  if (!open || !step || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      {/* The page behind takes no clicks while the tour is open. */}
      <div className="absolute inset-0" aria-hidden />
      {/* The spotlight: one box whose shadow is the dimming, so the box itself is the hole. With no target it is a point off screen and everything dims. */}
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-[var(--radius-card)] shadow-[0_0_0_200vmax_var(--overlay)] ring-1 ring-line transition-[top,left,width,height] duration-300 ease-[cubic-bezier(0.2,0.9,0.3,1)] motion-still:transition-none"
        style={hole ? { top: hole.top, left: hole.left, width: hole.width, height: hole.height } : { top: -10, left: -10, width: 0, height: 0 }}
      />
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className={cn("absolute flex w-[22.5rem] max-w-[calc(100vw-1.5rem)] flex-col gap-3 rounded-[var(--radius-popover)] border border-line bg-panel p-4 shadow-modal transition-[top,left] duration-300 ease-[cubic-bezier(0.2,0.9,0.3,1)] motion-still:transition-none", !position && "invisible")}
        style={position ?? { top: 0, left: 0 }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="type-small text-muted-foreground tabular-nums">
              {index + 1} of {steps.length}
            </p>
            <h2 id="tour-title" className="mt-0.5 text-lg font-semibold tracking-[-0.01em]">
              {step.title}
            </h2>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close the tutorial" title="Close (Esc)" onClick={onClose} className="-me-1.5 -mt-1.5 shrink-0">
            <X />
          </Button>
        </div>
        <div id="tour-body" className="type-base leading-relaxed text-muted-foreground [&_kbd]:rounded-[var(--radius-inset)] [&_kbd]:border [&_kbd]:border-line [&_kbd]:bg-surface [&_kbd]:px-1.5 [&_kbd]:py-0.5 [&_kbd]:font-mono [&_kbd]:type-small [&_kbd]:text-foreground [&_strong]:font-medium [&_strong]:text-foreground">
          {step.content}
        </div>
        <div className="mt-1 flex items-center gap-2">
          {!last && (
            <Button variant="ghost" onClick={onClose} className="-ms-2 text-muted-foreground">
              Skip
            </Button>
          )}
          <span className="ms-auto flex items-center gap-2">
            {index > 0 && (
              <Button variant="outline" onClick={back}>
                Back
              </Button>
            )}
            <Button data-tour-primary onClick={next}>
              {last ? finishLabel : "Next"}
            </Button>
          </span>
        </div>
        {/* Where the reader is in the run. */}
        <div aria-hidden className="flex gap-1">
          {steps.map((s, i) => (
            <span key={s.id} className={cn("h-0.5 flex-1 rounded-full transition-colors", i <= index ? "bg-foreground" : "bg-line")} />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

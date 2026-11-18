"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle } from "@/components/icons";
import { cn } from "@/lib/utils";

/** A check that draws itself when it appears. Reduced motion shows it drawn. */
export function DrawnCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("size-3.5 shrink-0", className)}>
      <path pathLength={1} d="M20 6 9 17l-5-5" className="stroke-current [stroke-dasharray:1] [animation:status-draw_360ms_cubic-bezier(0.2,0.9,0.3,1)_60ms_both] motion-still:[animation:none]" />
    </svg>
  );
}

/** The small ring that turns while something runs. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn("size-3.5 shrink-0 animate-spin", className)}>
      <circle cx="12" cy="12" r="9" className="stroke-current opacity-25" strokeWidth={2.5} />
      <path d="M21 12a9 9 0 0 0-9-9" className="stroke-current" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}

export type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

const SAVE_LABELS: Record<Exclude<SaveState, "idle">, string> = {
  unsaved: "Unsaved changes",
  saving: "Saving",
  saved: "Saved",
  error: "Save failed",
};

/**
 * The save state beside a document's title: a dot for unsaved changes, a spinner while saving, a check that draws in green and settles to the muted text when saved, and the danger tone when a save fails.
 *
 * It follows `state` with two timings so it never flickers: a save shorter than `delay` never shows "Saving" at all, and once "Saving" is shown it stays for at least `minimum`. Only outcomes (saved, failed) are announced to assistive tech, never each save starting.
 */
export function SaveStatus({ state, delay = 300, minimum = 700, className }: { state: SaveState; delay?: number; minimum?: number; className?: string }) {
  const [shown, setShown] = useState<SaveState>(state);
  const shownSince = useRef(0);
  // Changes that need no wait apply during render; only entering "saving" (after `delay`) and leaving it (after `minimum`) go through a timer.
  if (state !== shown && (state === "saving" ? delay <= 0 : shown !== "saving")) setShown(state);
  useEffect(() => {
    shownSince.current = performance.now();
  }, [shown]);
  useEffect(() => {
    if (state === shown) return;
    const wait = state === "saving" ? delay : Math.max(0, minimum - (performance.now() - shownSince.current));
    const timer = window.setTimeout(() => setShown(state), wait);
    return () => window.clearTimeout(timer);
  }, [state, shown, delay, minimum]);

  if (shown === "idle") return null;
  return (
    <span data-state={shown} className={cn("inline-flex shrink-0 items-center type-small text-muted-foreground data-[state=error]:text-danger", className)}>
      <span key={shown} className="inline-flex items-center gap-1.5 [animation:status-in_220ms_cubic-bezier(0.2,0.9,0.3,1)] motion-off:[animation:none]">
        <span aria-hidden className="grid size-3.5 place-items-center">
          {shown === "unsaved" && <span className="size-1.5 rounded-full bg-current opacity-70" />}
          {shown === "saving" && <Spinner />}
          {shown === "saved" && <DrawnCheck className="text-success [animation:status-settle_600ms_ease_2.4s_forwards] motion-off:text-muted-foreground" />}
          {shown === "error" && <AlertCircle className="size-3.5" />}
        </span>
        <span className="whitespace-nowrap">{SAVE_LABELS[shown]}</span>
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {shown === "saved" || shown === "error" ? SAVE_LABELS[shown] : ""}
      </span>
    </span>
  );
}

export type BusyState = "idle" | "busy" | "success" | "error";

/**
 * The faces of a button whose action takes a moment (Recompile): the idle label, then a spinner with `busyLabel`, then a drawn check with `successLabel` or an alert with `errorLabel`. Every face sits in one grid cell, so the button keeps the width of its widest face and nothing beside it moves. Put this inside a Button; while busy, mark the button aria-busy and ignore presses instead of disabling it, so keyboard focus is not thrown out mid-action.
 */
export function BusyFaces({ state, children, busyLabel, successLabel, errorLabel }: { state: BusyState; children: ReactNode; busyLabel: string; successLabel: string; errorLabel: string }) {
  const face = "col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5 transition-[opacity,scale] duration-200 [&:not([data-current])]:pointer-events-none [&:not([data-current])]:scale-90 [&:not([data-current])]:opacity-0 motion-still:[&:not([data-current])]:scale-100";
  const current = (s: BusyState) => (state === s ? "" : undefined);
  return (
    <span className="grid place-items-center">
      <span data-current={current("idle")} className={face}>
        {children}
      </span>
      <span aria-hidden data-current={current("busy")} className={face}>
        <Spinner className={state === "busy" ? undefined : "[animation-play-state:paused]"} />
        {busyLabel}
      </span>
      <span aria-hidden data-current={current("success")} className={face}>
        {state === "success" && <DrawnCheck />}
        {successLabel}
      </span>
      <span aria-hidden data-current={current("error")} className={face}>
        <AlertCircle className="size-3.5" />
        {errorLabel}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "busy" ? busyLabel : state === "success" ? successLabel : state === "error" ? errorLabel : ""}
      </span>
    </span>
  );
}

/**
 * Turns "is it running" into the four busy states: busy while running, then success or error for a moment (decided by `failed` when it stops), then idle.
 */
export function useBusyState(running: boolean, failed: boolean, hold = 1600): BusyState {
  const [outcome, setOutcome] = useState<"success" | "error" | null>(null);
  const wasRunning = useRef(running);
  const failedRef = useRef(failed);
  useEffect(() => {
    failedRef.current = failed;
  }, [failed]);
  useEffect(() => {
    if (wasRunning.current && !running) {
      // The result (errors or none) lands in the same commit that ends the run; read it a tick later.
      const decide = window.setTimeout(() => setOutcome(failedRef.current ? "error" : "success"), 0);
      const clear = window.setTimeout(() => setOutcome(null), hold);
      wasRunning.current = running;
      return () => {
        window.clearTimeout(decide);
        window.clearTimeout(clear);
      };
    }
    wasRunning.current = running;
  }, [running, hold]);
  // A new run clears the last outcome. Adjusted during render, so no effect has to set state.
  if (running && outcome !== null) setOutcome(null);
  return running ? "busy" : (outcome ?? "idle");
}

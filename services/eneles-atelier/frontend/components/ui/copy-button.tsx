"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The copy action for code. Pressing it copies, and the glyph shows it
 * happen: the front sheet slides onto the back one, both fold away, and a
 * check draws itself. The word under it changes to "Copied" in the same
 * space, so nothing beside the button moves. It turns back after a moment.
 * Reduced motion crossfades; Off switches at once. A refused clipboard says
 * "Failed".
 */
export function CopyButton({
  text,
  label = "Copy",
  showLabel = true,
  className,
  onCopied,
}: {
  text: string | (() => string);
  /** The word at rest, and the accessible name. */
  label?: string;
  showLabel?: boolean;
  className?: string;
  onCopied?: () => void;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      setState("copied");
      onCopied?.();
    } catch {
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), 1600);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={showLabel ? undefined : label}
      title={showLabel ? undefined : label}
      data-state={state}
      className={cn(
        "copy-button inline-flex items-center gap-1.5 rounded-[var(--radius-inset)] px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=copied]:text-success data-[state=failed]:text-danger",
        className,
      )}
    >
      <CopyGlyph copied={state === "copied"} />
      {showLabel && (
        <span className="inline-grid [&>span]:[grid-area:1/1] [&>span]:invisible [&>span[data-shown]]:visible">
          <span data-shown={state === "idle" || undefined}>{label}</span>
          <span data-shown={state === "copied" || undefined}>Copied</span>
          <span data-shown={state === "failed" || undefined}>Failed</span>
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : ""}
      </span>
    </button>
  );
}

/** Two sheets that become a check. */
export function CopyGlyph({ copied, className }: { copied: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      data-copied={copied || undefined}
      className={cn("copy-glyph size-3.5 shrink-0 overflow-visible", className)}
    >
      <rect data-part="back" x="9" y="9" width="12" height="12" rx="2.5" />
      <path data-part="front" d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
      <path data-part="check" d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
    </svg>
  );
}

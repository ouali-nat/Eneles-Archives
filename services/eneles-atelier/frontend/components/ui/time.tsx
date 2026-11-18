"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/*
 * Times, the one way the whole site writes them. A time is shown as how long ago it was ("3 minutes ago", "yesterday"), or as a short date or clock time where that reads better, and hovering or focusing it opens the app's own tooltip with the exact local date and time ("Tue, Dec 1, 2026, 12:00 AM"); where the place shows a date or a clock time, a second, quieter line says how long ago it was. Every time on the site is a <RelativeTime>, so none of them is a bare string with a browser title.
 *
 * The server has no clock of the reader's, so the words are written only once the page is running in the browser; until then the element is there, empty, which keeps the server's markup and the browser's first render the same.
 */

const LOCALE = "en-US";
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();
const sentence = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

function relativeFormat(style: "long" | "short") {
  let format = relativeFormats.get(style);
  if (!format) {
    format = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto", style });
    relativeFormats.set(style, format);
  }
  return format;
}

const STEPS: [limit: number, unit: Intl.RelativeTimeFormatUnit, size: number][] = [
  [3600, "minute", 60],
  [86_400, "hour", 3600],
  [604_800, "day", 86_400],
  [2_592_000, "week", 604_800],
  [31_536_000, "month", 2_592_000],
  [Infinity, "year", 31_536_000],
];

const toDate = (value: string | number | Date) => (value instanceof Date ? value : new Date(value));

/** "Just now", "3 minutes ago", "Yesterday", "2 weeks ago"; with `style: "short"`, "3 min. ago". */
export function relativeTime(value: string | number | Date, style: "long" | "short" = "long"): string {
  const seconds = (toDate(value).getTime() - Date.now()) / 1000;
  if (!Number.isFinite(seconds)) return "";
  if (Math.abs(seconds) < 45) return "Just now";
  const [, unit, size] = STEPS.find(([limit]) => Math.abs(seconds) < limit) ?? STEPS[STEPS.length - 1];
  return sentence(relativeFormat(style).format(Math.round(seconds / size), unit));
}

const fullMoment = new Intl.DateTimeFormat(LOCALE, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
const shortDate = new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", year: "numeric" });
const shortDateThisYear = new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric" });
const clock = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" });

/** Whether a moment is more than `days` days away from now, either way. */
function olderThan(date: Date, days: number): boolean {
  return Math.abs(Date.now() - date.getTime()) > days * 86_400_000;
}

/** "Sunday, November 8, 2026 at 9:23 AM". */
export function exactTime(value: string | number | Date): string {
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? "" : fullMoment.format(date);
}

/** "Nov 8" this year, "Nov 8, 2025" before it. */
export function shortDateText(value: string | number | Date): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.getFullYear() === new Date().getFullYear() ? shortDateThisYear.format(date) : shortDate.format(date);
}

// The tooltip: the moment in the reader's own zone, no seconds ("Tue, Dec 1, 2026, 12:00 AM").
const tipMoment = new Intl.DateTimeFormat(LOCALE, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

// One clock for every time on the page: they all move on together, once a minute, and rest while the tab is hidden (catching up as soon as it is shown again).
const listeners = new Set<() => void>();
let ticker = 0;
function tickAll() {
  listeners.forEach((listener) => listener());
}
function onVisibility() {
  if (document.visibilityState === "hidden") {
    window.clearInterval(ticker);
    ticker = 0;
  } else if (listeners.size && !ticker) {
    tickAll();
    ticker = window.setInterval(tickAll, 60_000);
  }
}
function useMinute() {
  const [, tick] = useState(0);
  useEffect(() => {
    const listener = () => tick((n) => n + 1);
    listeners.add(listener);
    if (listeners.size === 1) document.addEventListener("visibilitychange", onVisibility);
    if (!ticker && document.visibilityState !== "hidden") ticker = window.setInterval(tickAll, 60_000);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        window.clearInterval(ticker);
        ticker = 0;
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, []);
}

const noop = () => () => {};
/** False on the server and in the first render in the browser, then true. */
function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}

export type TimeFormat = "relative" | "date" | "time";

export interface RelativeTimeProps {
  value: string | number | Date | null | undefined;
  /** What to show when there is no time ("Never"). */
  fallback?: string;
  /** For the middle of a sentence: "edited 3 minutes ago". */
  lowercase?: boolean;
  /** "relative" ("3 minutes ago", the default), "date" ("Nov 8, 2026"), or "time" ("9:23 AM"). The tooltip is the same for all three. */
  format?: TimeFormat;
  /** "3 min. ago" where room is short (a list's trailing column). */
  style?: "long" | "short";
  /** Past this many days the date is shown instead ("Nov 8"); unset keeps it relative. */
  absoluteAfterDays?: number;
  /** Off inside a link or a row that is itself the control, where a second tab stop would be in the way; the tooltip still opens on hover. */
  focusable?: boolean;
  /** Words to show in place of the time ("Edited"), keeping the tooltip with the moment. */
  children?: ReactNode;
  className?: string;
}

/**
 * A time as people say it, with the exact moment in the app's own tooltip on hover (after a short pause) and at once on keyboard focus. The text carries a dotted underline so a reader knows there is more to it.
 */
export function RelativeTime({ value, fallback = "", lowercase = false, format = "relative", style = "long", absoluteAfterDays, focusable = true, children, className }: RelativeTimeProps) {
  useMinute();
  const hydrated = useHydrated();
  if (value === null || value === undefined || value === "") return fallback ? <span className={className}>{fallback}</span> : null;
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return fallback ? <span className={className}>{fallback}</span> : null;
  const ago = hydrated ? relativeTime(date, style) : "";
  const old = absoluteAfterDays !== undefined && hydrated && olderThan(date, absoluteAfterDays);
  let text: ReactNode = "";
  if (children !== undefined) text = children;
  else if (hydrated) {
    if (format === "date") text = shortDate.format(date);
    else if (format === "relative" && old) text = shortDateText(date);
    else if (format === "time") text = clock.format(date);
    else text = lowercase && ago ? ago[0].toLowerCase() + ago.slice(1) : ago;
  }
  // A second line only where the place does not already say how long ago it was.
  const second = typeof text === "string" && text.toLowerCase() === ago.toLowerCase() ? "" : ago;
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <time
          dateTime={date.toISOString()}
          tabIndex={focusable ? 0 : undefined}
          className={cn(
            "time-hint cursor-default whitespace-nowrap rounded-[var(--radius-inset)] underline decoration-dotted decoration-[color-mix(in_oklch,currentColor_45%,transparent)] underline-offset-[0.2em] outline-none transition-[text-decoration-color] hover:decoration-current focus-visible:ring-2 focus-visible:ring-focus data-[state=delayed-open]:decoration-current data-[state=instant-open]:decoration-current",
            className,
          )}
        >
          {text}
        </time>
      </TooltipTrigger>
      {hydrated && (
        <TooltipContent side="top" sideOffset={6} collisionPadding={8} className="max-w-none text-wrap">
          <span className="block whitespace-nowrap">{tipMoment.format(date)}</span>
          {second && <span className="block whitespace-nowrap text-muted-foreground">{second}</span>}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

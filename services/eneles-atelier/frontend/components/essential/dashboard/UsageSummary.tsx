"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { bytes, count } from "@/components/admin/format";
import { usageAPI } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/time";

/** What `GET /usage/current` answers: this month's metered conversions and the upload storage, each against the allowance (-1 means no subscription quota). */
export type PlanSummary = {
  plan: string;
  snipsUsed: number;
  snipsLimit: number;
  pdfPagesUsed: number;
  pdfPagesLimit: number;
  storageUsedBytes: number;
  storageLimitBytes: number;
};


/**
 * Your monthly usage at a glance, at the foot of the sidebar: snips and PDF pages converted this month and the upload storage, each against the technical service capacity, and when the month's counters reset. The whole card opens your access details. Read again whenever `refreshKey` changes (the shell passes the route), so it follows conversions made on other pages.
 */
export function UsageSummary({ refreshKey, hidden = false, onNavigate }: { refreshKey?: string | null; hidden?: boolean; onNavigate?: () => void }) {
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    usageAPI
      .getCurrentUsage()
      .then((data: PlanSummary) => {
        if (!live) return;
        setSummary(data);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  const now = new Date();
  const resetsAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const meters = summary
    ? [
        { label: "Snips", used: summary.snipsUsed, limit: summary.snipsLimit, format: count },
        { label: "PDF pages", used: summary.pdfPagesUsed, limit: summary.pdfPagesLimit, format: count },
        { label: "Storage", used: summary.storageUsedBytes, limit: summary.storageLimitBytes, format: bytes },
      ]
    : [];

  // The month's counters start again on the first of the next month.
  const days = Math.max(1, Math.ceil((resetsAt.getTime() - now.getTime()) / 86_400_000));

  return (
    <Link
      href="/billing"
      onClick={onNavigate}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      aria-label={summary ? `Eneles usage this month` : "Usage summary"}
      className={cn(
        // As wide as the open sidebar's content (264px less its edge and padding), so it is clipped and never reflowed while the sidebar narrows; in the phone drawer it fills the row.
        "flex w-full min-w-[239px] flex-col gap-2 rounded-[var(--radius-tray)] border border-line bg-background px-3 py-2.5 text-start shadow-lit-drop transition-[opacity,border-color] duration-[var(--motion-pane-duration)] hover:border-[color-mix(in_oklch,var(--line),var(--foreground)_20%)]",
        hidden && "pointer-events-none opacity-0",
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span className="truncate type-small font-medium">{summary ? "Eneles" : "Usage"}</span>
        <span className="flex-1" />
        <span className="whitespace-nowrap type-tiny text-muted-foreground">
          Resets{" "}
          <RelativeTime value={resetsAt} focusable={false}>
            in {days === 1 ? "1 day" : `${days} days`}
          </RelativeTime>
        </span>
      </span>
      {summary ? (
        <span className="flex w-full flex-col gap-1.5">
          {meters.map((m) => {
            const ratio = m.limit > 0 ? Math.min(1, m.used / m.limit) : 0;
            return (
              <span key={m.label} className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between gap-2 type-micro">
                  <span className="text-muted-foreground">{m.label}</span>
                  <span className="tabular-nums">
                    {m.format(m.used)}
                    {m.limit >= 0 && ` / ${m.format(m.limit)}`}
                  </span>
                </span>
                <span role="meter" aria-label={`${m.label} this month`} aria-valuemin={0} aria-valuemax={m.limit >= 0 ? m.limit : undefined} aria-valuenow={m.used} className="block h-1 w-full overflow-hidden rounded-full bg-surface">
                  {/* The fill warms as the month's allowance runs out. */}
                  <span className={cn("block h-full w-[var(--fill)] rounded-full transition-[width] duration-[var(--motion-pane-duration)]", ratio >= 0.9 ? "bg-danger" : ratio >= 0.7 ? "bg-warning" : "bg-accent")} style={{ "--fill": `${ratio * 100}%` } as React.CSSProperties} />
                </span>
              </span>
            );
          })}
        </span>
      ) : failed ? (
        <span className="type-tiny text-muted-foreground">Usage could not be read.</span>
      ) : (
        <span className="flex w-full flex-col gap-1.5" role="status" aria-label="Loading usage">
          {/* The three meters' shape: a label line over a bar, so the card keeps its height when the figures arrive. */}
          {["40%", "52%", "36%"].map((width) => (
            <span key={width} className="flex flex-col gap-1">
              <SkeletonText className="type-micro" width={width} />
              <Skeleton className="h-1 w-full rounded-full" />
            </span>
          ))}
        </span>
      )}
    </Link>
  );
}

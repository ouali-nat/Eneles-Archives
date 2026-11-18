import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/essential/layout/PageHeader";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { cn } from "@/lib/utils";

export type SectionState = "loading" | "error" | "empty" | "ready";

/** The leading visual of the rows, so the skeleton draws the same box: an icon tile (32px), a snip's square (44px), or a PDF's first page (32 by 40). */
export type RowLeading = "icon" | "thumb" | "page";

const LEADING: Record<RowLeading, string> = {
  icon: "size-8 rounded-[var(--radius)]",
  thumb: "size-11 rounded-[var(--radius-item)]",
  page: "h-10 w-8 rounded-[var(--radius-inset)]",
};

interface RecentSectionProps {
  title: string;
  /** Where "View all" leads. */
  href: string;
  state: SectionState;
  /** One line saying what failed, shown with Retry. */
  error?: string;
  onRetry?: () => void;
  /** What will appear here, and the one action that makes it appear. */
  empty: { text: string; action?: { label: string; href: string } };
  /** The rows' leading visual and how many rows the list holds at most, for the skeleton. */
  leading: RowLeading;
  rows: number;
  children?: ReactNode;
}

/**
 * A dashboard card listing a few recent items. Owns every data state: a skeleton of the rows themselves (the same leading box, line heights, and padding as RecentRow, after a short delay, with the same space held before it shows), one error line with Retry, an empty sentence with its action, and the rows. The card is a flex column, so when a grid stretches it to its neighbour's height the empty and error states sit in the middle of the space instead of at its top.
 */
export function RecentSection({ title, href, state, error, onRetry, empty, leading, rows, children }: RecentSectionProps) {
  const showSkeleton = useDelayedFlag(state === "loading");
  const headingId = `recent-${title.toLowerCase().replace(/\W+/g, "-")}`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col rounded-[var(--radius-surface)] border border-line bg-card shadow-lit-drop">
      <RecentSectionHeader id={headingId} title={title} href={href} />

      <div className="flex flex-1 flex-col p-2" aria-busy={state === "loading"}>
        {state === "loading" && <RecentRowsSkeleton leading={leading} rows={rows} label={`Loading ${title.toLowerCase()}`} hidden={!showSkeleton} />}

        {state === "error" && (
          <EmptyState bare action={onRetry && <Button variant="outline" onClick={onRetry}>Retry</Button>}>
            {error}
          </EmptyState>
        )}

        {state === "empty" && (
          <EmptyState
            bare
            action={
              empty.action && (
                <Button asChild variant="outline">
                  <Link href={empty.action.href}>{empty.action.label}</Link>
                </Button>
              )
            }
          >
            {empty.text}
          </EmptyState>
        )}

        {state === "ready" && <ul className="space-y-0.5">{children}</ul>}
      </div>
    </section>
  );
}

function RecentSectionHeader({ id, title, href }: { id?: string; title: string; href: string }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
      <h2 id={id} className="type-base font-semibold">
        {title}
      </h2>
      <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
        <Link href={href}>
          View all
          <ArrowRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
        </Link>
      </Button>
    </header>
  );
}

/** Rows of placeholders in RecentRow's exact boxes. `hidden` holds their space without drawing them, for the moment before a skeleton is worth showing. */
function RecentRowsSkeleton({ leading, rows, label, hidden = false }: { leading: RowLeading; rows: number; label: string; hidden?: boolean }) {
  const widths = ["46%", "34%", "52%", "40%", "30%"];
  return (
    <ul role="status" aria-label={label} className={cn("space-y-0.5", hidden && "invisible")}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className={cn("shrink-0", LEADING[leading])} />
          <span className="min-w-0 flex-1">
            <SkeletonText className="type-base" width={widths[i % widths.length]} />
            <SkeletonText className="type-tiny" width="22%" />
          </span>
          <SkeletonText className="w-12 shrink-0 type-tiny" width="100%" />
        </li>
      ))}
    </ul>
  );
}

/** The whole card while the page itself is still loading (the route's skeleton): the real header and the rows' skeleton. */
export function RecentSectionSkeleton({ title, href, leading, rows }: { title: string; href: string; leading: RowLeading; rows: number }) {
  return (
    <section className="flex flex-col rounded-[var(--radius-surface)] border border-line bg-card shadow-lit-drop">
      <RecentSectionHeader title={title} href={href} />
      <div className="flex flex-1 flex-col p-2">
        <RecentRowsSkeleton leading={leading} rows={rows} label={`Loading ${title.toLowerCase()}`} />
      </div>
    </section>
  );
}

/** One row in a RecentSection: a leading visual, a title, a detail line, and a trailing time. */
export function RecentRow({
  href,
  leading,
  title,
  detail,
  trailing,
}: {
  href: string;
  leading: ReactNode;
  title: string;
  detail?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-[var(--radius-tray)] px-2 py-2 transition-colors hover:bg-surface-hover"
      >
        <span className="flex shrink-0 items-center justify-center">{leading}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate type-base font-medium">{title}</span>
          {detail && <span className="block truncate type-tiny text-muted-foreground">{detail}</span>}
        </span>
        {trailing && <span className="shrink-0 type-tiny text-muted-foreground">{trailing}</span>}
      </Link>
    </li>
  );
}

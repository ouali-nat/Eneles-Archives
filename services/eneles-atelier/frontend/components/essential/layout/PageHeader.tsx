import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The top of every signed-in page: one title size, one optional line of description, and the page's actions on the right at the default control height. Pages use this instead of their own h1 so the title sits at the same place, in the same weight, everywhere.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">{title}</h1>
        {description && <p className="mt-1 type-base text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A heading for a group of cards inside a page (Security, API keys, …). */
export function SectionHeading({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
        {description && <p className="mt-0.5 type-base text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * What a list or panel shows when there is nothing in it: an icon, a sentence on what will appear, and at most one action. The same frame on every page, so empty never looks like broken.
 *
 * It centres its content both ways and grows to fill the box it is in: inside a flex column (a card body, a list area, a page) it takes the free height and keeps its content in the middle at any height, and it never collapses below its own minimum. A caller whose box should be filled makes that box a flex column.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
  bare = false,
}: {
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Inside a card that already has a border. */
  bare?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-3 self-stretch px-6 text-center",
        bare ? "min-h-40 py-8" : "min-h-64 rounded-[var(--radius-surface)] border border-dashed border-line py-12",
        className,
      )}
    >
      {Icon && (
        <span className="mb-1 grid size-11 place-items-center rounded-full bg-surface text-muted-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      {title && <p className="type-base font-medium text-foreground">{title}</p>}
      {children && <p className="max-w-md type-base text-muted-foreground">{children}</p>}
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

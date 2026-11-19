import { cn } from "@/lib/utils"

/**
 * The one placeholder block. It is drawn in the foreground at a low strength (the `.skeleton` rule in globals.css), so it reads on the page, a card, or a panel in both palettes; under Full motion a single quiet band of light crosses the window, and under Reduced and Off it holds still. Give it the exact box of what it stands in for: the same height as the line or control, the same radius as the card, so nothing moves when the content arrives.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden className={cn("skeleton rounded-[var(--radius-inset)]", className)} {...props} />
}

/**
 * A placeholder for one line of text: the line box keeps the text's own height (pass its type class, such as `type-base`), and the bar sits inside it at about the height of the letters, so a column of these lines up with the column of text that replaces it.
 */
function SkeletonText({ className, width = "60%" }: { className?: string; width?: string }) {
  return (
    <span aria-hidden className={cn("flex h-[1lh] items-center", className)}>
      <span className="skeleton block h-[0.72em] max-w-full rounded-[var(--radius-inset)]" style={{ width }} />
    </span>
  )
}

export { Skeleton, SkeletonText }

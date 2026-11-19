import { BrandMarks } from "@/components/BrandMarks";
import { cn } from "@/lib/utils";

/**
 * The site's one indeterminate progress mark: a hairline track with a short segment running along it (`.loading-track` in globals.css). Under Reduced and Off motion the segment holds still in the middle. Used where work of unknown length has no shape to show (a page whose shape is unknown, a render on demand), never as a spinner.
 */
export function LoadingBar({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("loading-track relative block h-px w-24 overflow-hidden rounded-full bg-line", className)}>
      <span className="absolute inset-y-0 start-0 block w-[28%] rounded-full bg-foreground" />
    </span>
  );
}

/**
 * The wait before a page whose shape is not known: the wordmark in the middle of the window and the loading bar under it. It belongs with the status pages (the same centred body on the plain ground, no shader: a load is not a fault), and it stays invisible for the first 300ms so a fast load never flashes it (`.loading-mark` in globals.css). `showLabel` writes the label under the bar, for a wait that is doing something the reader asked for (accepting an invitation).
 */
export function LoadingScreen({ label = "Loading", showLabel = false, className }: { label?: string; showLabel?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-h-dvh w-full flex-1 items-center justify-center bg-background px-6", className)}>
      <div role="status" aria-live="polite" className="loading-mark flex flex-col items-center gap-5">
        <BrandMarks.logo aria-hidden className="h-6 w-auto fill-foreground text-foreground" />
        <LoadingBar />
        <span className={showLabel ? "type-base text-muted-foreground" : "sr-only"}>{label}</span>
      </div>
    </div>
  );
}

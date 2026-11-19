import { cn } from "@/lib/utils";
import { LABEL_HUE_CLASSES, labelHue } from "@/lib/labels";

/** A label on a listing row. Its color is one of the theme's hues; uncolored labels stay neutral. */
export function LabelChip({ label, color, className }: { label: string; color?: string | null; className?: string }) {
  const hue = labelHue(color);
  return (
    <span
      className={cn(
        "inline-flex max-w-40 items-center gap-1 rounded-full border px-2 py-0.5 type-micro font-medium",
        hue ? LABEL_HUE_CLASSES[hue].chip : "border-line bg-surface text-muted-foreground",
        className,
      )}
    >
      {hue && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", LABEL_HUE_CLASSES[hue].dot)} />}
      <span className="truncate">{label}</span>
    </span>
  );
}

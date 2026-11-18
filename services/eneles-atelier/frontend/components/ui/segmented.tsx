"use client";

import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

/**
 * A segmented control: one choice from a few, shown together. A recessed tray
 * with the selected segment lifted, one tab stop, arrow keys inside. Selection
 * cannot be cleared by clicking the selected segment again.
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
  labelledBy,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string }[];
  /** Accessible name when no visible label names the group. */
  label?: string;
  labelledBy?: string;
  className?: string;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      aria-label={label}
      aria-labelledby={labelledBy}
      className={cn(
        "inline-flex h-10 items-stretch rounded-[var(--radius-popover)] border border-line bg-background p-1 shadow-lit-well",
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className="rounded-[var(--radius-item)] px-3.5 type-base font-medium text-muted-foreground transition-[color,background-color,box-shadow] hover:text-foreground data-[state=on]:bg-surface data-[state=on]:text-foreground data-[state=on]:shadow-[var(--lit-drop),var(--lit-raised)]"
        >
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

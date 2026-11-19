"use client";

import type { ComponentProps, ReactNode } from "react";
import { formatShortcut, usePlatform } from "@/lib/keys";
import { cn } from "@/lib/utils";

/** The keycap every key legend on the site is drawn with: 20px tall, the interface font at 11px, a hairline edge. */
export const kbdClass = "inline-flex h-5 shrink-0 items-center justify-center rounded-[var(--radius-inset)] border border-line bg-panel px-1.5 font-sans type-micro font-medium leading-none text-muted-foreground";

/** A key that reads the same everywhere (Esc, ↵, ↑↓). For anything with a modifier, use Shortcut. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn(kbdClass, className)}>{children}</kbd>;
}

/**
 * A shortcut written in the neutral notation ("Mod+K") and shown for the platform in use: "⌘K" on Apple devices, "Ctrl K" elsewhere. Until the browser has said which platform it is, the keycap keeps its place but stays invisible, so nothing flashes and the server's text never differs from the first render.
 */
export function Shortcut({ keys, className, ...rest }: { keys: string; className?: string } & Omit<ComponentProps<"kbd">, "children">) {
  const platform = usePlatform();
  return (
    <kbd {...rest} aria-hidden={platform ? undefined : true} data-platform={platform ?? undefined} className={cn(kbdClass, !platform && "invisible", className)}>
      {formatShortcut(keys, platform ?? "other")}
    </kbd>
  );
}

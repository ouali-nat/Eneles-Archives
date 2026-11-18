"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The slim bar at the top of a dock panel (Files, History, Logs): what the panel is showing at the start (a count, a file name, a status), its actions at the end. The panel's name is on its tab, so the bar never repeats it. Every panel that needs a bar uses this one, so they cannot drift apart.
 */
export function PanelBar({ children, actions, className }: { children?: ReactNode; /** Buttons at the end of the row (new file, clear logs). */ actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-11 shrink-0 items-center gap-2 border-b border-line ps-3 pe-1.5", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-2 type-small text-muted-foreground">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  );
}

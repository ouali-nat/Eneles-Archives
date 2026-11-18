"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Ported from the Thry UI kit (components/navigation/DisclosureBody.tsx). Keeps the content mounted so both directions animate; closed, its descendants leave keyboard navigation and the accessibility tree at once. */
export function DisclosureBody({ open, id, labelledBy, className, children }: { open: boolean; id?: string; labelledBy?: string; className?: string; children: ReactNode }) {
  return (
    <div
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        "invisible grid grid-rows-[0fr] opacity-0 [transition:grid-template-rows_var(--motion-pane-duration)_var(--motion-ease),opacity_var(--motion-pane-duration)_var(--motion-ease),visibility_0s_linear_var(--motion-pane-duration)] data-[open=true]:visible data-[open=true]:grid-rows-[1fr] data-[open=true]:opacity-100 data-[open=true]:delay-[0s]!",
        className,
      )}
      data-open={open}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

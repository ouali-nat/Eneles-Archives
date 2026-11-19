import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "field flex h-[var(--control-height)] w-full min-w-0 px-3 type-base text-foreground outline-none placeholder:text-muted-foreground selection:bg-selection disabled:cursor-not-allowed disabled:opacity-50",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:type-small file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input }

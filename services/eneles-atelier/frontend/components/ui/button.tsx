import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/*
 * One button for every action. One control height; sm is for dense toolbars.
 * A press never moves the button: the plate darkens, its drop goes, and the
 * pressed light sits inside. Keyboard focus is the global offset ring.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] type-base font-medium transition-[background-color,border-color,box-shadow,color] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-on-accent shadow-[var(--lit-drop),var(--lit-raised)] hover:bg-accent/90 active:shadow-lit-pressed",
        destructive:
          "bg-danger text-on-danger shadow-[var(--lit-drop),var(--lit-raised)] hover:bg-danger/90 active:shadow-lit-pressed",
        // Approving: accepting a change, resolving a thread.
        success:
          "bg-success text-on-success shadow-[var(--lit-drop),var(--lit-raised)] hover:bg-success/90 active:shadow-lit-pressed",
        outline:
          "border border-line bg-surface text-foreground shadow-lit-drop hover:bg-surface-hover active:bg-surface active:shadow-lit-pressed",
        secondary:
          "border border-line bg-surface text-foreground shadow-lit-drop hover:bg-surface-hover active:bg-surface active:shadow-lit-pressed",
        ghost:
          "text-foreground hover:bg-surface-hover active:shadow-lit-pressed",
        link: "h-auto px-0 text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[var(--control-height)] px-3.5 has-[>svg]:px-3",
        // The large size is for a page's main calls to action; everything in
        // a bar (headers, toolbars) is the default control height.
        lg: "h-11 gap-2 px-6 text-[15px] has-[>svg]:px-5",
        // There is one control height. "sm" is kept as a name for the many call sites that use it; it is the same height with a little less padding, not a smaller button.
        sm: "h-[var(--control-height)] gap-1.5 px-3 has-[>svg]:px-2.5",
        icon: "size-[var(--control-height)]",
        // The one smaller size, for an action inside a row that is itself a control's height (a file in a list, a tab).
        "icon-sm": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

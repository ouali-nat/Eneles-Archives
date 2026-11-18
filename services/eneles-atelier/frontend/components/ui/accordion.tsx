"use client";

import { useId, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ChevronDown } from "@/components/icons";
import { DisclosureBody } from "@/components/ui/disclosure-body";
import { cn } from "@/lib/utils";

/* Ported from the Thry UI kit (components/layout/Accordion.tsx), one to one: Eneles names the pane timing --motion-pane-duration, and spells the kit's `muted` as text-muted-foreground. Stacked sections that open in place: one at a time (`single`, optionally never all closed) or any number (`multiple`). Bodies are DisclosureBody, so they stay mounted and animate their height both ways under the motion preference, and a closed body is inert. Each header is a real heading holding a button (the WAI-ARIA accordion pattern): Enter and Space toggle, Up and Down move between headers, Home and End jump to the first and last. `divided` is hairline rows on whatever surface holds it (docs, a pane); `boxed` is a SettingGroup-style plate for a pane or a dialog; `cards` sets every item in a card of its own (a site's questions). Styles are this file's own Tailwind classes. */

export type AccordionItem = {
  id: string;
  title: ReactNode;
  content: ReactNode;
  /* Muted text before the chevron: a count, a status, a date. */
  meta?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
};

export type AccordionProps = {
  items: AccordionItem[];
  type?: "single" | "multiple";
  /* Open item ids. In `single` there is at most one. */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /* `single` only: whether the open item closes when its header is pressed again. */
  collapsible?: boolean;
  variant?: "divided" | "boxed" | "cards";
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /* Shown in place of the list when there are no items. */
  empty?: ReactNode;
  className?: string;
};

export function Accordion({
  items,
  type = "single",
  value,
  defaultValue = [],
  onValueChange,
  collapsible = true,
  variant = "divided",
  headingLevel = 3,
  empty,
  className,
}: AccordionProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const open = value ?? uncontrolled;
  const base = useId();
  const Heading = `h${headingLevel}` as "h3";

  const toggle = (id: string) => {
    const isOpen = open.includes(id);
    let next: string[];
    if (type === "multiple") next = isOpen ? open.filter((entry) => entry !== id) : [...open, id];
    else if (isOpen) next = collapsible ? [] : open;
    else next = [id];
    if (next === open) return;
    if (value === undefined) setUncontrolled(next);
    onValueChange?.(next);
  };

  /* Arrow keys walk this accordion's own headers, not those of one nested inside it. */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const root = event.currentTarget;
    const target = event.target as HTMLElement;
    if (!target.matches("[data-accordion-trigger]") || target.closest("[data-accordion]") !== root) return;
    const triggers = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-accordion-trigger]:not(:disabled)")).filter(
      (trigger) => trigger.closest("[data-accordion]") === root,
    );
    const index = triggers.indexOf(target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? triggers.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + triggers.length) % triggers.length;
    triggers[nextIndex]?.focus();
  };

  if (items.length === 0) return empty ? <p className="type-small text-muted-foreground">{empty}</p> : null;

  const boxed = variant === "boxed";
  const cards = variant === "cards";
  /* Boxed, the first header (and the last while it is closed) runs into the plate's corners, so it takes the plate's inner curve there and its inset focus ring stays concentric with the plate. */
  return (
    <div
      data-accordion=""
      data-variant={variant}
      onKeyDown={onKeyDown}
      className={cn(
        "accordion flex w-full min-w-0 flex-col",
        variant === "divided" && "border-y border-[color-mix(in_oklch,var(--line)_60%,transparent)]",
        boxed && "rounded-(--radius-card) border border-line bg-card",
        cards && "gap-2.5",
        className,
      )}
    >
      {items.map((item, index) => {
        const isOpen = open.includes(item.id);
        const triggerId = `${base}-${item.id}-trigger`;
        const panelId = `${base}-${item.id}-panel`;
        /* A lone open item in a non-collapsible single accordion cannot be closed; say so rather than ignore the press. */
        const locked = type === "single" && !collapsible && isOpen;
        const first = index === 0;
        const last = index === items.length - 1;
        return (
          <div
            key={item.id}
            data-open={isOpen || undefined}
            data-disabled={item.disabled || undefined}
            className={cn(
              "min-w-0",
              !cards && !first && "border-t border-[color-mix(in_oklch,var(--line)_60%,transparent)]",
              cards &&
                "overflow-hidden rounded-(--radius-surface) border border-line bg-[color-mix(in_oklch,var(--surface)_70%,var(--background))] transition-[border-color,background-color] duration-200 hover:border-[color-mix(in_oklch,var(--foreground)_16%,var(--line))] data-open:border-[color-mix(in_oklch,var(--foreground)_18%,var(--line))] data-open:bg-surface",
            )}
          >
            <Heading className="m-0">
              <button
                type="button"
                id={triggerId}
                data-accordion-trigger=""
                aria-expanded={isOpen}
                aria-controls={panelId}
                aria-disabled={locked || undefined}
                disabled={item.disabled}
                onClick={() => toggle(item.id)}
                className={cn(
                  "group/trigger flex w-full min-w-0 cursor-pointer items-center rounded-(--radius) border-0 bg-transparent text-start text-foreground focus-visible:outline-offset-[-2px] aria-disabled:cursor-default disabled:cursor-not-allowed disabled:opacity-45 [&>svg]:size-4 [&>svg]:shrink-0",
                  cards ? "min-h-15 gap-4 px-5 py-4" : "min-h-11 gap-3 py-2.5",
                  boxed ? "px-3" : !cards && "px-1",
                  boxed && first && "rounded-ss-[max(0px,calc(var(--radius-card)-1px))] rounded-se-[max(0px,calc(var(--radius-card)-1px))]",
                  boxed && last && !isOpen && "rounded-es-[max(0px,calc(var(--radius-card)-1px))] rounded-ee-[max(0px,calc(var(--radius-card)-1px))]",
                )}
              >
                {item.icon && (
                  <span className="flex shrink-0 items-center text-muted-foreground [&>svg]:size-4" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                <span className={cn("min-w-0 flex-1", cards ? "text-base font-semibold" : "type-small font-medium")}>{item.title}</span>
                {item.meta && <span className="shrink-0 type-tiny tabular-nums text-muted-foreground">{item.meta}</span>}
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "text-muted-foreground [transition:rotate_var(--motion-pane-duration)_var(--motion-ease),color_var(--motion-control-duration)] group-hover/trigger:text-foreground group-focus-visible/trigger:text-foreground group-disabled/trigger:text-muted-foreground",
                    cards && "size-[18px]!",
                    isOpen && "rotate-180",
                  )}
                />
              </button>
            </Heading>
            <DisclosureBody open={isOpen}>
              <div
                id={panelId}
                role="region"
                aria-labelledby={triggerId}
                className={cn(
                  cards ? "px-5 pb-5 text-[15px] leading-[1.65] text-muted-foreground" : "type-small pb-4 leading-[1.6] text-[color-mix(in_oklch,var(--foreground)_82%,var(--muted-foreground))]",
                  boxed ? "px-3" : !cards && "px-1",
                  item.icon && !cards && (boxed ? "ps-10" : "ps-8"),
                )}
              >
                {item.content}
              </div>
            </DisclosureBody>
          </div>
        );
      })}
    </div>
  );
}

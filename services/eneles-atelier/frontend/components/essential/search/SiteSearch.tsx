"use client";

import { useEffect, useRef, useState, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import { Search, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd, Shortcut } from "@/components/ui/kbd";
import { ariaShortcut, formatShortcut, matchesShortcut, usePlatform } from "@/lib/keys";
import { cn } from "@/lib/utils";

/*
 * Search, the one way the site does it: a field-like row that opens a search dialog, and Mod+K, which opens it from anywhere on the page. Docs, Learn, the Library, and the dashboard all use these parts, so they look and behave the same.
 */

const SHORTCUT = "Mod+K";

/** Opens (or closes) search on Mod+K anywhere on the page. */
export function useSearchShortcut(toggle: () => void) {
  const latest = useRef(toggle);
  useEffect(() => {
    latest.current = toggle;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, SHORTCUT)) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * The search row: a recessed field the height of every control, a 34px cell holding the search icon, the label, and the shortcut's keycap at the end, set 8px in from the field's top, bottom, and end edges. `collapsed` fades the label and keycap (the dashboard's icon rail); `hint={false}` leaves the keycap out. The keycap is also left out on a phone-width screen, where there is no keyboard.
 */
export function SearchTrigger({ label, onOpen, collapsed = false, hint = true, className, ...rest }: { label: string; onOpen: () => void; collapsed?: boolean; hint?: boolean } & Omit<ComponentProps<"button">, "onClick" | "children">) {
  const platform = usePlatform();
  const fade = cn("transition-opacity duration-[var(--motion-pane-duration)]", collapsed && "opacity-0");
  return (
    <button
      {...rest}
      type="button"
      onClick={onOpen}
      aria-label={platform ? `${label} (${formatShortcut(SHORTCUT, platform)})` : label}
      aria-keyshortcuts={ariaShortcut(SHORTCUT, platform)}
      data-search-trigger=""
      className={cn(
        "field flex h-[var(--control-height)] w-full min-w-0 items-center pe-[7px] text-start type-base text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground",
        className,
      )}
    >
      <span className="grid h-full w-[34px] shrink-0 place-items-center">
        <Search aria-hidden className="size-4" />
      </span>
      <span className={cn("min-w-0 flex-1 truncate", fade)}>{label}</span>
      {/* A phone has no keyboard to press it with. */}
      {hint && <Shortcut keys={SHORTCUT} className={cn("ms-2 max-sm:hidden", fade)} data-search-hint="" />}
    </button>
  );
}

const WORD = /[\p{L}\p{N}]+/gu;

/** Every word typed must begin some word of the entry (its title, description, keywords, or id), so "venn" finds the Venn diagrams and nothing that merely contains a v, an e, and two n's. An entry whose title holds every word ranks first. */
function matchWords(value: string, search: string, keywords?: string[]): number {
  const terms = search.toLowerCase().match(WORD);
  if (!terms) return 1;
  const [title = "", ...rest] = keywords ?? [];
  const titleWords = title.toLowerCase().match(WORD) ?? [];
  const words = [...titleWords, ...`${value} ${rest.join(" ")}`.toLowerCase().match(WORD) ?? []];
  if (!terms.every((term) => words.some((word) => word.startsWith(term)))) return 0;
  return terms.every((term) => titleWords.some((word) => word.startsWith(term))) ? 1 : 0.5;
}

export interface SearchEntry {
  /** Unique within the dialog. */
  id: string;
  title: string;
  description?: string;
  /** Words that find the entry without being shown. */
  keywords?: readonly string[];
  href: string;
  icon?: ComponentType<{ className?: string }>;
  /** The title is code (a package name). */
  mono?: boolean;
}

export interface SearchGroup {
  heading: string;
  entries: readonly SearchEntry[];
}

/**
 * The search dialog: a field, results grouped under headings (a title, and a description under it when there is one), and a line of key legends. Up and Down move, Enter opens, Escape closes.
 */
export function SearchDialog({
  open,
  onOpenChange,
  title,
  placeholder,
  groups,
  empty = "Nothing matches.",
  notice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read by assistive technology; the field's placeholder says the same thing on screen. */
  title: string;
  placeholder: string;
  groups: readonly SearchGroup[];
  empty?: ReactNode;
  /** A line under the results (something could not be loaded). */
  notice?: ReactNode;
}) {
  const router = useRouter();
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[min(20vh,10rem)] flex translate-y-0 flex-col gap-0 overflow-hidden p-0 @min-[40rem]:max-w-xl [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">Type to filter, Up and Down to move, Enter to open, Escape to close.</DialogDescription>
        <CommandPrimitive className="flex min-h-0 min-w-0 flex-col" loop filter={matchWords}>
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line ps-4 pe-3">
            <Search aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input placeholder={placeholder} className="h-full min-w-0 flex-1 bg-transparent type-large text-foreground outline-none placeholder:text-muted-foreground" />
            {/* Escape closes it; on a phone, where there is no key legend, this button does. */}
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label="Close" className="shrink-0 text-muted-foreground @min-[40rem]:hidden">
              <X />
            </Button>
          </div>
          <CommandPrimitive.List className="max-h-[min(440px,55vh)] scroll-py-2 overflow-y-auto overscroll-contain p-2">
            <CommandPrimitive.Empty className="px-3 py-10 text-center type-base text-muted-foreground">{empty}</CommandPrimitive.Empty>
            {groups.map(
              (group) =>
                group.entries.length > 0 && (
                  <CommandPrimitive.Group
                    key={group.heading}
                    heading={group.heading}
                    className="[&_[cmdk-group-heading]]:px-0 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:type-small [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground first:[&_[cmdk-group-heading]]:pt-1"
                  >
                    {group.entries.map((entry) => (
                      <CommandPrimitive.Item
                        key={entry.id}
                        value={entry.id}
                        keywords={[entry.title, entry.description ?? "", ...(entry.keywords ?? [])]}
                        onSelect={() => go(entry.href)}
                        className="flex min-h-10 cursor-default select-none items-center gap-3 rounded-[var(--radius-item)] px-3 py-1.5 type-base text-foreground outline-none data-[selected=true]:bg-surface-hover"
                      >
                        {entry.icon && <entry.icon className="size-4 shrink-0 text-muted-foreground" />}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className={cn("truncate", entry.mono && "font-mono")}>{entry.title}</span>
                          {entry.description && <span className="truncate type-small text-muted-foreground">{entry.description}</span>}
                        </span>
                      </CommandPrimitive.Item>
                    ))}
                  </CommandPrimitive.Group>
                ),
            )}
            {notice && <p className="px-3 py-2 type-small text-muted-foreground">{notice}</p>}
          </CommandPrimitive.List>
          <div className="hidden h-11 shrink-0 items-center gap-4 border-t border-line px-4 type-small text-muted-foreground @min-[40rem]:flex">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              to move
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              to open
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>Esc</Kbd>
              to close
            </span>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}

/** A search row and its dialog together, with Mod+K: what a manual's sidebar holds. */
export function SiteSearch({ label, title, groups, hint = true, className }: { label: string; title?: string; groups: readonly SearchGroup[]; hint?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  useSearchShortcut(() => setOpen((was) => !was));
  return (
    <>
      <SearchTrigger label={label} onOpen={() => setOpen(true)} hint={hint} className={className} />
      <SearchDialog open={open} onOpenChange={setOpen} title={title ?? label} placeholder={label} groups={groups} />
    </>
  );
}

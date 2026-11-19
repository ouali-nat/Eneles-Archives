"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "@/components/icons";
import {
  libraryEntries,
  libraryHref,
  exampleHref,
  templateGroups,
  templateHref,
  totalExampleCount,
} from "@/lib/library-nav";
import { ScrollFade } from "@/components/essential/ScrollFade";
import { isPackageName } from "@/lib/tikz/libraries";
import { SearchTrigger } from "@/components/essential/search/SiteSearch";
import { useCurrentInView } from "@/components/essential/layout/useCurrentInView";
import { cn } from "@/lib/utils";

/**
 * The library tree: packages at the top level, their examples nested beneath.
 *
 * Only the package you are inside is expanded by default. Twenty-one packages
 * with a hundred and twenty examples between them is far too much to show at
 * once, and a sidebar you have to scroll past to reach anything is slower than
 * the index-and-back-button flow this replaces.
 *
 * Search is the site's one search dialog (the row at the top, or Mod+K), which the layout owns; the tree itself is not filtered. The current page's entry is kept in view as the reader moves through the library.
 */
export function LibrarySidebar({ onNavigate, onSearch }: { onNavigate?: () => void; /** Shows the search row at the top (not in the phone drawer, where the row sits beside the menu button). */ onSearch?: () => void }) {
  const pathname = usePathname();
  const scroller = useRef<HTMLDivElement>(null);
  useCurrentInView(scroller, pathname);
  const [manuallyOpen, setManuallyOpen] = useState<Set<string>>(new Set());

  const segments = pathname.split("/").filter(Boolean); // ["library", ...]
  const isTemplateRoute = segments[1] === "templates";
  const activeLibrary = isTemplateRoute ? undefined : segments[1];
  const activeExample = isTemplateRoute ? undefined : segments[2];
  const activeTemplate = isTemplateRoute ? segments[2] : undefined;

  const results = libraryEntries;
  const templateResults = templateGroups;

  const toggle = (id: string) => {
    setManuallyOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isOpen = (id: string) =>
    manuallyOpen.has(id) || activeLibrary === id;

  /** Categories follow the same rule, keyed with a prefix to avoid collisions. */
  const isCategoryOpen = (category: string) =>
    manuallyOpen.has(`category:${category}`) ||
    templateResults
      .find((g) => g.category === category)
      ?.templates.some((t) => t.id === activeTemplate) === true;

  return (
    <div className="flex h-full flex-col">
      {onSearch && (
        <div className="mb-4 shrink-0">
          <SearchTrigger label="Search the library" onOpen={onSearch} />
        </div>
      )}

      <ScrollFade className="min-h-0 flex-1" scrollRef={scroller} viewportClassName="pb-8">
        <nav aria-label="Library" className="pe-1">
        <p className="mb-2 type-small font-medium text-muted-foreground">
          Packages
        </p>

          <ul className="space-y-0.5">
            {results.map((lib) => {
              const open = isOpen(lib.id);
              const isActiveLib = activeLibrary === lib.id;
              return (
                <li key={lib.id}>
                  <div className="flex items-stretch">
                    <button
                      type="button"
                      onClick={() => toggle(lib.id)}
                      aria-expanded={open}
                      aria-label={`${open ? "Collapse" : "Expand"} ${lib.name}`}
                      className="flex w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ChevronRight
                        className={cn(
                          "h-3 w-3 transition-transform duration-200",
                          open && "rotate-90",
                        )}
                        aria-hidden
                      />
                    </button>
                    <Link
                      href={libraryHref(lib.id)}
                      onClick={onNavigate}
                      aria-current={
                        isActiveLib && !activeExample ? "page" : undefined
                      }
                      className={cn(
                        "min-w-0 flex-1 truncate rounded px-1.5 py-1.5 text-[13px] transition-colors",
                        isPackageName(lib) && "font-mono",
                        isActiveLib
                          ? "font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {lib.name}
                    </Link>
                  </div>

                  {open && lib.examples.length > 0 && (
                    <ul className="ms-[0.65rem] border-s">
                      {lib.examples.map((ex) => {
                        const active = isActiveLib && activeExample === ex.id;
                        return (
                          <li key={ex.id}>
                            <Link
                              href={exampleHref(lib.id, ex.id)}
                              onClick={onNavigate}
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                "-ms-px block border-s-2 py-1 ps-3 text-[12.5px] leading-snug transition-colors",
                                active
                                  ? "border-foreground font-medium text-foreground"
                                  : "border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                              )}
                            >
                              {ex.name}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-7">
            <p className="mb-2 type-small font-medium text-muted-foreground">
              Templates
            </p>
            <ul className="space-y-0.5">
              {templateResults.map((group) => {
                const open = isCategoryOpen(group.category);
                return (
                  <li key={group.category}>
                    <button
                      type="button"
                      onClick={() => toggle(`category:${group.category}`)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-1 rounded py-1.5 pe-1.5 text-start text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <span className="flex w-5 shrink-0 items-center justify-center">
                        <ChevronRight
                          className={cn(
                            "h-3 w-3 transition-transform duration-200",
                            open && "rotate-90",
                          )}
                          aria-hidden
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {group.category}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground/50">
                        {group.templates.length}
                      </span>
                    </button>

                    {open && (
                      <ul className="ms-[0.65rem] border-s">
                        {group.templates.map((template) => (
                          <li key={template.id}>
                            <Link
                              href={templateHref(template.id)}
                              onClick={onNavigate}
                              aria-current={
                                activeTemplate === template.id
                                  ? "page"
                                  : undefined
                              }
                              className={cn(
                                "-ms-px block truncate border-s-2 py-1 ps-3 text-[12.5px] leading-snug transition-colors",
                                activeTemplate === template.id
                                  ? "border-foreground font-medium text-foreground"
                                  : "border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                              )}
                            >
                              {template.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

        <p className="mt-7 px-1 pb-2 text-[11px] text-muted-foreground/60">
          {results.length} packages, {totalExampleCount} examples
        </p>
        </nav>
      </ScrollFade>
    </div>
  );
}

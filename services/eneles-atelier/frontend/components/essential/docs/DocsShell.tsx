"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Menu, PenLine } from "@/components/icons";
import { MANUALS, manualAdjacent, manualGroupOf, manualHref, manualPage, manualSlug, type ManualId } from "@/lib/manuals";
import { siteConfig } from "@/config/site";
import { DocsSidebar } from "@/components/essential/docs/DocsSidebar";
import { DocsToc } from "@/components/essential/docs/DocsToc";
import { DocsSearch } from "@/components/essential/docs/DocsSearch";
import { SearchTrigger, useSearchShortcut } from "@/components/essential/search/SiteSearch";
import { useCurrentInView } from "@/components/essential/layout/useCurrentInView";
import { Breadcrumbs } from "@/components/essential/Breadcrumbs";
import { ScrollFade } from "@/components/essential/ScrollFade";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

/**
 * The shell of a manual (Docs or Learn): navigation on the left, the page in the middle, and on wide screens the page's contents in the right margin. Both manuals use this one component, so they cannot drift apart.
 */
export function DocsShell({ manual: manualId, children }: { manual: ManualId; children: React.ReactNode }) {
  const manual = MANUALS[manualId];
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useSearchShortcut(() => setSearchOpen((open) => !open));
  const navScroll = useRef<HTMLDivElement>(null);
  useCurrentInView(navScroll, pathname);
  const drawerScroll = useRef<HTMLDivElement>(null);
  useCurrentInView(drawerScroll, `${pathname}:${mobileOpen}`);

  const slug = manualSlug(manual, pathname);
  const current = manualPage(manual, slug);
  const group = manualGroupOf(manual, slug);
  const { prev, next } = manualAdjacent(manual, slug);

  // Pages are written in the manual's own repository. The overview pages are part of the site and have no page there to edit.
  const forge = siteConfig.links.forge;
  const editUrl = current && !current.builtIn ? (forge ? `${forge}/texer/${manual.repository}/_edit/main/${manual.pagesDir}/${slug}.mdx` : `${siteConfig.links.github}/${manual.repository}/edit/main/${manual.pagesDir}/${slug}.mdx`) : null;

  return (
    <div className="container relative">
      <div className="flex items-start gap-8 @7xl:gap-12">
        {/* Sidebar: it stays under the header as the page scrolls, scrolls inside itself when it is taller than the window, and keeps the current page's entry in view. */}
        <div className="manual-nav hidden w-60 shrink-0 flex-col pt-8 pe-2 @5xl:flex">
          <div className="mb-4 shrink-0">
            <SearchTrigger label={manual.searchLabel} onOpen={() => setSearchOpen(true)} />
          </div>
          <ScrollFade className="min-h-0 flex-1" scrollRef={navScroll} viewportClassName="pb-8">
            <DocsSidebar manual={manual} />
          </ScrollFade>
        </div>

        {/* Content */}
        <div className="flex min-h-[calc(100dvh-var(--header-height))] min-w-0 flex-1 flex-col py-8">
          {/* Mobile controls */}
          <div className="mb-8 flex items-center gap-2 @5xl:hidden">
            <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
              <DrawerTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-[var(--control-height)] shrink-0 items-center gap-2 rounded-[var(--radius)] border border-line px-3 type-base font-medium"
                >
                  <Menu className="h-4 w-4" aria-hidden />
                  {manual.name}
                </button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>{manual.title}</DrawerTitle>
                </DrawerHeader>
                <div ref={drawerScroll} className="max-h-[65vh] overflow-y-auto px-4 pb-8 scrollbar-modern">
                  <DocsSidebar manual={manual} onNavigate={() => setMobileOpen(false)} />
                </div>
              </DrawerContent>
            </Drawer>
            <div className="min-w-0 flex-1">
              <SearchTrigger label={manual.searchLabel} onOpen={() => setSearchOpen(true)} />
            </div>
          </div>

          {/* Breadcrumb. The group segment links back to the docs index rather
              than sitting there as inert text, which is what it used to do. */}
          {current && slug !== "" && (
            <Breadcrumbs
              items={[
                { label: manual.name, href: manual.base },
                ...(group && group !== manual.groups[0]?.title
                  ? [{ label: group, href: manual.base }]
                  : []),
                { label: current.title },
              ]}
            />
          )}

          {/* The paragraph right after a page's title is its description, set like every other page header's. */}
          <article className="flex-1 [&>h1+p]:mb-10 [&>h1+p]:text-lg! [&>h1+p]:leading-relaxed!">{children}</article>

          {/* Footer: edit link, then prev/next */}
          <div className="mt-16 border-t border-line pt-6">
            {editUrl && (
              <a href={editUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
                <PenLine className="h-3.5 w-3.5" aria-hidden />
                Edit this page
              </a>
            )}
          </div>

          {(prev || next) && (
            <div className="mt-6 grid gap-3 @min-[40rem]:grid-cols-2">
              {prev ? (
                <Link
                  href={manualHref(manual, prev.slug)}
                  className="group flex items-center gap-3 rounded-[var(--radius-surface)] border border-line p-4 transition-colors hover:border-foreground/25"
                >
                  <ChevronLeft
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">Previous</p>
                    <p className="truncate text-sm font-medium">{prev.title}</p>
                  </div>
                </Link>
              ) : (
                <div className="hidden @min-[40rem]:block" />
              )}

              {next && (
                <Link
                  href={manualHref(manual, next.slug)}
                  className="group flex items-center justify-end gap-3 rounded-xl border p-4 text-end transition-colors hover:border-foreground/25 hover:bg-surface/40"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">Next</p>
                    <p className="truncate text-sm font-medium">{next.title}</p>
                  </div>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Table of contents: in the right margin, outside the content column, so the article is as wide as a library page. Shown only where the margin has room for it. */}
        <div className="absolute start-full top-0 hidden h-full w-52 ps-8 @min-[104rem]:block">
          <div className="sticky top-[var(--header-height)] py-8">
            <DocsToc />
          </div>
        </div>
      </div>
      <DocsSearch manual={manual} open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

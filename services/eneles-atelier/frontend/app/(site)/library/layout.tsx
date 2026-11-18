"use client";

import { useState } from "react";
import { Menu } from "@/components/icons";
import { LibrarySidebar } from "@/components/essential/library/LibrarySidebar";
import { LibrarySearch } from "@/components/essential/library/LibrarySearch";
import { SearchTrigger, useSearchShortcut } from "@/components/essential/search/SiteSearch";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

/**
 * Persistent shell for the library browser.
 *
 * The sidebar living in the layout rather than on each page is the whole
 * point: navigating between examples swaps only the content pane, so the tree
 * keeps its scroll position and its expanded state instead of remounting.
 */
export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useSearchShortcut(() => setSearchOpen((open) => !open));

  return (
    <div className="container">
      <div className="flex items-start gap-8 @7xl:gap-12">
        {/* The tree stays under the header as the page scrolls, scrolls inside itself, and keeps the current entry in view. */}
        <aside className="manual-nav hidden w-60 shrink-0 pt-8 pe-2 @5xl:block">
          <LibrarySidebar onSearch={() => setSearchOpen(true)} />
        </aside>

        <div className="min-h-[calc(100dvh-var(--header-height))] min-w-0 flex-1 py-8">
          <div className="mb-6 flex items-center gap-2 @5xl:hidden">
            <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
              <DrawerTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-[var(--control-height)] shrink-0 items-center gap-2 rounded-[var(--radius)] border border-line px-3 type-base font-medium"
                >
                  <Menu className="size-4" aria-hidden />
                  Library
                </button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Library</DrawerTitle>
                </DrawerHeader>
                <div className="h-[65vh] px-4 pb-6">
                  <LibrarySidebar onNavigate={() => setMobileOpen(false)} />
                </div>
              </DrawerContent>
            </Drawer>
            <div className="min-w-0 flex-1">
              <SearchTrigger label="Search the library" onOpen={() => setSearchOpen(true)} />
            </div>
          </div>

          {children}
        </div>
      </div>
      <LibrarySearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

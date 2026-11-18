"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";
import { BrandMarks } from "@/components/BrandMarks";
import { ModeToggle } from "@/components/essential/layout/ModeToggle";
import { AuthButtons } from "@/components/essential/auth/AuthButtons";
import { ProfileMenu } from "@/components/essential/account/ProfileMenu";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useState, useEffect } from "react";
import { Menu } from "@/components/icons";

/** `marketing`: about the product rather than part of it, so the desktop app (which is the platform without the site around it) leaves it out. */
const navItems = [
  { title: "Features", href: "/features", marketing: true },
  { title: "Library", href: "/library" },
  { title: "Pricing", href: "/pricing", marketing: true },
  { title: "Learn", href: "/learn" },
  { title: "Docs", href: "/docs" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close drawer on route change
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setMobileOpen(false);
  }

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 w-full transition-all duration-200",
          scrolled
            ? "border-b bg-background/80 backdrop-blur-xl shadow-sm"
            : "border-b border-transparent bg-transparent",
        )}
      >
        {/* Three columns, the middle one exactly centered. Wide: the logo, the navigation, and the account corner. Narrow (a phone): the menu button, the logo in the middle, and the theme and the account face. */}
        <div className="container grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex items-center justify-self-start">
            <Link href="/" aria-label="Eneles home" className="hidden items-center @3xl:flex">
              <BrandMarks.logo className="h-5 w-auto fill-foreground" />
            </Link>
            {/* The phone's menu: the navigation in a drawer that slides up from the bottom. */}
            <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
              <DrawerTrigger asChild>
                <Button variant="ghost" size="icon" className="-ms-2 @3xl:hidden">
                  <Menu className="size-5" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader className="sr-only">
                  <DrawerTitle>Menu</DrawerTitle>
                </DrawerHeader>
                <nav className="grid gap-0.5 px-2 pb-2">
                  {navItems.map((item) => (
                    <DrawerClose key={item.title} asChild>
                      <Link
                        href={item.href}
                        data-marketing={item.marketing || undefined}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-[var(--radius)] px-4 py-3 text-base font-medium transition-colors",
                          pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href)) ? "bg-surface-hover text-foreground" : "text-muted-foreground hover:bg-surface-hover/50 hover:text-foreground",
                        )}
                      >
                        {item.title}
                      </Link>
                    </DrawerClose>
                  ))}
                </nav>
                <div className="mx-4 flex items-center justify-between gap-3 border-t border-line px-2 pt-4 pb-6">
                  <AuthButtons menu={false} />
                  <span data-marketing className="flex items-center gap-1">
                  <Link href={siteConfig.links.source} target="_blank" rel="noreferrer" className="inline-flex size-[var(--control-height)] items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground">
                    <BrandMarks.forgejo className="size-4" />
                    <span className="sr-only">Source code on GitHub Eneles</span>
                  </Link>
                  <Link href={siteConfig.links.github} target="_blank" rel="noreferrer" className="inline-flex size-[var(--control-height)] items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground">
                    <BrandMarks.gitHub className="size-4" />
                    <span className="sr-only">GitHub</span>
                  </Link>
                  </span>
                </div>
              </DrawerContent>
            </Drawer>
          </div>

          <div className="flex items-center justify-center">
            <Link href="/" aria-label="Eneles home" className="flex items-center @3xl:hidden">
              <BrandMarks.logo className="h-5 w-auto fill-foreground" />
            </Link>
            <nav className="hidden items-center gap-1 @3xl:flex">
              {navItems.map((item) => (
                <Link
                  key={item.title}
                  href={item.href}
                  data-marketing={item.marketing || undefined}
                  className={cn(
                    "inline-flex h-[var(--control-height)] items-center rounded-[var(--radius)] px-3.5 type-base font-medium transition-colors",
                    pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href)) ? "bg-foreground/[0.07] text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
                  )}
                >
                  {item.title}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center justify-end gap-1.5">
            {/* The source on our own Git server, then its mirror on GitHub. */}
            <Link
              data-marketing
              href={siteConfig.links.source}
              target="_blank"
              rel="noreferrer"
              title="Source code on GitHub Eneles"
              className="hidden size-[var(--control-height)] items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground @3xl:inline-flex"
            >
              <BrandMarks.forgejo className="size-4" />
              <span className="sr-only">Source code on GitHub Eneles</span>
            </Link>
            <Link
              data-marketing
              href={siteConfig.links.github}
              target="_blank"
              rel="noreferrer"
              className="hidden size-[var(--control-height)] items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground @3xl:inline-flex"
            >
              <BrandMarks.gitHub className="size-4" />
              <span className="sr-only">GitHub</span>
            </Link>
            <ModeToggle />
            <div className="ms-1 hidden items-center @3xl:flex">
              <AuthButtons />
            </div>
            {/* On a phone the face alone: signed in it opens the account menu, signed out it offers Log in and Sign up. */}
            <div className="-me-1 @3xl:hidden">
              <ProfileMenu compact destinations={["dashboard", "profile", "settings", "ai"]} />
            </div>
          </div>
        </div>
      </header>
    </>
  );
}

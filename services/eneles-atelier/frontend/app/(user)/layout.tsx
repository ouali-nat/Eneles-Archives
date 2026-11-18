"use client"

import React, { useState, useEffect, useCallback, useSyncExternalStore } from "react"
import Link from "next/link"
import { AppSidebar } from "@/components/essential/dashboard/DashboardSidebar"
import { SearchDialog } from "@/components/essential/dashboard/SearchDialog"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { BrandMarks } from "@/components/BrandMarks"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer"
import { Menu, Search } from "@/components/icons";
import { useElementWidth } from "@/hooks/useElementWidth"
import { RouteSkeleton } from "@/components/essential/layout/RouteSkeleton"
import { DropZoneWrapper } from "@/components/essential/layout/DropZone"
import { LoadingScreen } from "@/components/essential/status/LoadingScreen"
import { StatusPage } from "@/components/essential/status/StatusPage"

const SIDEBAR_COLLAPSED_KEY = "texer-sidebar-collapsed"
const noopSubscribe = () => () => {}

export default function UserLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout, isInitialized, isAuthenticated, refreshUser } = useAuth()

  // All hooks must be declared unconditionally before any early return
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // Sidebar collapse state, persisted in localStorage
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"
  })

  // The shell measures itself: phones get the drawer, medium widths an icon
  // rail unless the reader opens it, wide widths the saved preference.
  const [shellRef, shellWidth] = useElementWidth<HTMLDivElement>()
  const isMedium = shellWidth >= 640 && shellWidth < 1024
  const [mediumExpanded, setMediumExpanded] = useState(false)
  const collapsed = isMedium ? !mediumExpanded : sidebarCollapsed

  const toggleSidebar = useCallback(() => {
    if (isMedium) {
      setMediumExpanded((v) => !v)
      return
    }
    setSidebarCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }, [isMedium])

  // Close the drawer when the route changes (back and forward included)
  const [drawerPath, setDrawerPath] = useState(pathname)
  if (drawerPath !== pathname) {
    setDrawerPath(pathname)
    setDrawerOpen(false)
  }

  // Mod+K opens search from anywhere in the signed-in pages (the editor and the PDF view have their own shortcuts and no sidebar).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        const fullScreen = (pathname !== "/projects" && pathname?.startsWith("/projects/")) || (pathname !== "/pdfs" && pathname?.startsWith("/pdfs/"))
        if (fullScreen) return
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pathname])

  // Hard redirect signed-out visitors to login with return URL. A sign-in
  // whose profile could not load (API unreachable) stays here instead: the
  // login page would only send it straight back.
  useEffect(() => {
    if (isInitialized && !user && !isAuthenticated) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname ?? "/dashboard")}`)
    }
  }, [isInitialized, user, isAuthenticated, pathname, router])

  // Full-screen routes: editor and PDF detail pages
  const isEditorRoute = pathname !== "/projects" && pathname?.startsWith("/projects/")
  const isPdfDetailRoute = pathname !== "/pdfs" && pathname?.startsWith("/pdfs/")
  const isFullScreenRoute = isEditorRoute || isPdfDetailRoute

  // Until the sign-in is known, nothing protected renders: the full-screen views wait on the quiet loading screen, and the other pages show the shell with their own skeleton in the content area (below), so the sidebar never flashes in after a blank page.
  const checking = !isInitialized
  if (checking && isFullScreenRoute) return <LoadingScreen />
  // The shell reads the saved sidebar width from this browser, which the server cannot know, so it first draws once hydrated.
  if (checking && !hydrated) return null
  if (!checking && !user) {
    if (!isAuthenticated) return null
    // Signed in, but the profile could not be read: the API is down or the connection is gone.
    return <StatusPage kind="offline" actions={[{ label: "Try again", onClick: () => void refreshUser() }]} />
  }

  // Full-screen routes: no sidebar or header
  if (isFullScreenRoute) {
    return <div key="fullscreen" className="fixed inset-0 overflow-hidden">{children}</div>
  }


  return (
    <div key="dashboard" ref={shellRef} className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar: an icon rail when collapsed, never gone above phone width */}
      <div className="hidden shrink-0 @min-[40rem]:block">
        <AppSidebar collapsed={collapsed} onCollapse={toggleSidebar} onSearch={() => setSearchOpen(true)} />
      </div>

      {/* Main Content */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Phone header: the menu opens the same sidebar as a drawer from the start edge. */}
        <header className="z-40 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-background px-3 @min-[40rem]:hidden">
          <Button variant="ghost" size="icon" aria-label="Open menu" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
            <Menu aria-hidden className="size-4" />
          </Button>
          <Link href="/dashboard" aria-label="Eneles dashboard" className="absolute left-1/2 flex -translate-x-1/2 items-center">
            <BrandMarks.logo className="h-5 w-auto fill-foreground" />
          </Link>
          <Button variant="ghost" size="icon" className="ms-auto" aria-label="Search" onClick={() => setSearchOpen(true)}>
            <Search aria-hidden className="size-4" />
          </Button>
          <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} direction="left">
            <DrawerContent className="w-[min(300px,85%)] border-line">
              <DrawerTitle className="sr-only">Menu</DrawerTitle>
              <DrawerDescription className="sr-only">Navigation, plan usage, and your account</DrawerDescription>
              <AppSidebar drawer={{ onClose: () => setDrawerOpen(false) }} onSearch={() => { setDrawerOpen(false); setSearchOpen(true) }} />
            </DrawerContent>
          </Drawer>
        </header>

        {/* Main content */}
        {/* The page keeps its place whether the sidebar is open or a rail: Expand lives in the rail. */}
        <main className="@container relative w-full min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] pt-6 pb-32">
          <DropZoneWrapper pathname={pathname}>
            {checking ? <RouteSkeleton pathname={pathname} /> : children}
          </DropZoneWrapper>
        </main>
      </div>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}

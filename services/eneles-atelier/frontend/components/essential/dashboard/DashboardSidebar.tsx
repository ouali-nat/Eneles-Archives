'use client';

import Link from "next/link"
import { usePathname } from "next/navigation"
import { PanelLeft, Search, X } from "@/components/icons";
import { BrandMarks } from "@/components/BrandMarks"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ProfileMenu } from "@/components/essential/account/ProfileMenu"
import { UsageSummary } from "./UsageSummary"
import { SearchTrigger } from "@/components/essential/search/SiteSearch"
import { Shortcut } from "@/components/ui/kbd"
import { accountMenu, isActive, navGroups } from "./nav"

interface AppSidebarProps {
  collapsed?: boolean
  /** Collapses the sidebar to its icon rail, and opens it again: in the rail the same button takes the small logo's place on hover or focus, so nothing outside the sidebar moves. */
  onCollapse?: () => void
  /** Opens search (the shell owns the dialog and its Mod+K shortcut). */
  onSearch: () => void
  /** As the phone drawer: full width, a close button in place of collapse, and every link closes it. */
  drawer?: { onClose: () => void }
}

/**
 * The signed-in sidebar. From the top: the logo and the collapse button; Search; the navigation in two groups; the plan's month at a glance; and one account row that opens the account menu.
 *
 * Collapsing must not move anything except the sidebar's own edge. Every row keeps the same padding in both states and starts with a 36px cell for its icon or face, which is exactly the rail's inner width (60px minus 12px on each side), so an icon sits in the same place whether the sidebar is open or closed. Labels are clipped by the shrinking sidebar and fade; group headings keep their height and turn into a short rule; nothing re-centers, so nothing jumps mid-transition.
 */
export function AppSidebar({ collapsed = false, onCollapse, onSearch, drawer }: AppSidebarProps) {
  const pathname = usePathname()
  const label = cn("truncate transition-opacity duration-[var(--motion-pane-duration)]", collapsed && "opacity-0")
  const close = drawer?.onClose
  const row = "flex h-[var(--control-height)] w-full items-center rounded-[var(--radius)] type-base font-medium transition-colors"

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "flex h-full flex-col overflow-hidden bg-panel transition-[width] duration-[var(--motion-pane-duration)]",
          drawer ? "w-full" : cn("border-e border-line", collapsed ? "w-[60px]" : "w-[264px]")
        )}
      >
        {/* Logo: the wordmark when open, a small one centered in the rail when closed. Both stay mounted and cross-fade. In the rail, pointing at the small logo (or tabbing to it) shows Expand in its place. */}
        <div className="group/brand relative h-14 shrink-0 border-b border-line">
          <Link href="/dashboard" aria-label="Eneles dashboard" onClick={close} className="absolute inset-y-0 start-0 flex items-center">
            <span className={cn("flex h-full items-center ps-5 transition-opacity duration-[var(--motion-pane-duration)]", collapsed && "pointer-events-none opacity-0")}>
              <BrandMarks.logo className="h-5 w-auto fill-foreground" />
            </span>
            <span aria-hidden className={cn("pointer-events-none absolute inset-y-0 start-0 flex w-[60px] items-center justify-center transition-opacity duration-[var(--motion-pane-duration)]", !collapsed && "opacity-0", collapsed && onCollapse && !drawer && "group-focus-within/brand:opacity-0 group-hover/brand:opacity-0")}>
              <BrandMarks.logo className="h-3 w-auto fill-foreground" />
            </span>
          </Link>
          {drawer ? (
            <button
              type="button"
              onClick={drawer.onClose}
              aria-label="Close menu"
              className="absolute end-3 top-1/2 flex size-[var(--control-height)] -translate-y-1/2 items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : onCollapse && (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* One button for both: at end-3 it sits by the wordmark when open, and in the 60px rail that is the rail's center, where the small logo is. */}
                <button
                  type="button"
                  onClick={onCollapse}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  aria-expanded={!collapsed}
                  className={cn(
                    "absolute end-3 top-1/2 flex size-[var(--control-height)] -translate-y-1/2 items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-[opacity,background-color,color] duration-[var(--motion-pane-duration)] hover:bg-surface-hover hover:text-foreground",
                    collapsed && "opacity-0 group-hover/brand:opacity-100 focus-visible:opacity-100"
                  )}
                >
                  <PanelLeft aria-hidden className="size-4 rtl:-scale-x-100" />
                </button>
              </TooltipTrigger>
              <TooltipContent side={collapsed ? "right" : "bottom"} sideOffset={collapsed ? 8 : undefined}>
                {collapsed ? "Expand sidebar" : "Collapse sidebar"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Only the navigation scrolls. The plan card and the account button are docked under it, so a scrollbar never takes room from them. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 pt-3 pb-2">
          {/* Search: the site's one search row, which opens the search dialog. In the rail its label and keycap fade and its icon stays put; the tooltip names it. */}
          {/* Tooltips stay uncontrolled (switching between controlled and not warns); only the rail renders their content. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <SearchTrigger label="Search" onOpen={onSearch} collapsed={collapsed} hint={!drawer} />
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right" sideOffset={8} className="flex items-center gap-2">
                Search <Shortcut keys="Mod+K" />
              </TooltipContent>
            )}
          </Tooltip>

          <nav aria-label="Main" className="mt-4 flex flex-col gap-4">
            {navGroups.map((group) => (
              <div key={group.id} role="group" aria-labelledby={`nav-${group.id}`} className="flex flex-col gap-0.5">
                {/* The heading keeps its height in the rail, where a short rule stands for it. The rule sits midway between the row above the heading and the row below it (24px and 25px), so the rail's groups are evenly spaced. */}
                <div className="relative flex h-8 items-end pb-1.5">
                  {/* A group's title starts at its rows' left edge. */}
                  <span id={`nav-${group.id}`} className={cn(label, "type-small font-medium text-muted-foreground")}>
                    {group.label}
                  </span>
                  <span aria-hidden className={cn("absolute top-2 start-2.5 h-px w-4 bg-line transition-opacity duration-[var(--motion-pane-duration)]", !collapsed && "opacity-0")} />
                </div>
                {group.items.map((item) => {
                  const active = isActive(pathname, item.url)
                  return (
                    <Tooltip key={item.url}>
                      <TooltipTrigger asChild>
                        <Link
                          href={item.url}
                          onClick={close}
                          aria-current={active ? "page" : undefined}
                          aria-label={collapsed ? item.title : undefined}
                          className={cn(row, active ? "bg-surface-hover text-foreground" : "text-muted-foreground hover:bg-surface-hover/60 hover:text-foreground")}
                        >
                          <span className="grid h-full w-9 shrink-0 place-items-center">
                            <item.icon aria-hidden className="size-4" />
                          </span>
                          <span className={cn(label, "pe-3")}>{item.title}</span>
                        </Link>
                      </TooltipTrigger>
                      {collapsed && (<TooltipContent side="right" sideOffset={8}>
                        {item.title}
                      </TooltipContent>)}
                    </Tooltip>
                  )
                })}
              </div>
            ))}
          </nav>

        </div>

        {/* The plan card, docked between the navigation and the account button. It is clipped, never reflowed, while the sidebar narrows, and fades out of the rail. */}
        <div className="shrink-0 overflow-hidden px-3 pt-1 pb-3">
          <UsageSummary refreshKey={pathname} hidden={collapsed} onNavigate={close} />
        </div>

        {/* The footer keeps its height in the rail, where the button is the 36px face. */}
        <div className="flex h-[73px] shrink-0 items-center border-t border-line p-3">
          <ProfileMenu collapsed={collapsed} onNavigate={close} destinations={accountMenu.signedIn} signedOutDestinations={accountMenu.signedOut} />
        </div>
      </aside>
    </TooltipProvider>
  )
}

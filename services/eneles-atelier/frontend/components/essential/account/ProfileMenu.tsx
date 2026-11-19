"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { ChevronDown, KeyRound, LayoutDashboard, LogIn, LogOut, Monitor, Moon, Settings, Sun, User, UserPlus } from "@/components/icons";
import { Avatar } from "@/components/people/Avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { settingsAPI } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const noop = () => () => {};
const THEMES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

const DESTINATIONS = {
  dashboard: { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  profile: { title: "Profile", href: "/profile", icon: User },
  settings: { title: "Settings", href: "/settings", icon: Settings },
  ai: { title: "AI", href: "/ai", icon: KeyRound },
} as const;
export type ProfileDestination = keyof typeof DESTINATIONS;

const item = "min-h-9 gap-2.5 px-2.5";
const separator = "mx-1.5";

/**
 * The account menu, the one place the site puts who is signed in. Two triggers open the same menu:
 *
 * - The full trigger, for a sidebar's footer: a 48px bordered button with the face, the name over the address, and a chevron; the menu opens above it, exactly as wide as the button, so it reads as the button unfolding. With `collapsed` (the sidebar's rail) the same button draws in to a 36px round face and the menu opens beside it.
 * - `compact`, for a header: the face alone in a 36px round button, named by its tooltip; the menu opens under it.
 *
 * The menu: the name and address, the account's pages, the color mode, and Log out. Signed out, the trigger is a placeholder face and the menu offers Log in and Sign up.
 */
export function ProfileMenu({ compact = false, collapsed = false, destinations = ["profile", "settings", "ai"], signedOutDestinations = [], onNavigate, className }: { compact?: boolean; /** The sidebar is closed to its rail: only the face shows. */ collapsed?: boolean; destinations?: ProfileDestination[]; /** Pages listed under Log in and Sign up while signed out, for pages that need no account. */ signedOutDestinations?: ProfileDestination[]; /** Called when a link in the menu is followed (a drawer closes itself). */ onNavigate?: () => void; className?: string }) {
  const { user, isInitialized, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const current = THEMES.find((t) => t.value === (mounted ? theme : "system")) ?? THEMES[0];
  const name = user?.name?.trim() || user?.email || "Account";
  const round = compact || collapsed;

  const changeTheme = (value: string) => {
    setTheme(value);
    // Saved to the account too, as the Settings page does; the change has already applied here.
    if (user) settingsAPI.updateAppearanceSettings({ theme: value }).catch(() => undefined);
  };

  const face = user ? (
    <Avatar person={user} size="md" decorative />
  ) : isInitialized ? (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface text-muted-foreground shadow-lit-drop">
      <User className="size-4" />
    </span>
  ) : (
    <Skeleton className="size-8 shrink-0 rounded-full" />
  );

  const trigger = compact ? (
    <Button variant="ghost" size="icon" aria-label="Account menu" className={cn("rounded-full p-0", className)}>
      {face}
    </Button>
  ) : (
    <Button
      variant="outline"
      aria-label={`Account menu for ${name}`}
      data-collapsed={collapsed || undefined}
      className={cn(
        // The button draws in to the round face when the sidebar closes to its rail: width, height, corners, and plate change together, and the face stays where it was.
        "h-12 w-full min-w-0 justify-start gap-3 overflow-hidden rounded-[var(--radius-popover)] ps-[7px]! pe-3! transition-[width,height,padding,border-radius,background-color,border-color,box-shadow] duration-[var(--motion-pane-duration)]",
        "data-collapsed:size-9 data-collapsed:rounded-full data-collapsed:border-transparent data-collapsed:bg-transparent data-collapsed:pe-0! data-collapsed:ps-px! data-collapsed:shadow-none data-collapsed:hover:bg-surface-hover",
        className,
      )}
    >
      {face}
      <span className={cn("flex min-w-0 flex-1 flex-col items-start leading-tight transition-opacity duration-[var(--motion-pane-duration)]", collapsed && "opacity-0")}>
        <span className="max-w-full truncate">{user ? name : isInitialized ? "Account" : ""}</span>
        {user?.name && <span className="max-w-full truncate type-micro font-normal text-muted-foreground">{user.email}</span>}
      </span>
      <ChevronDown className={cn("opacity-50 transition-opacity duration-[var(--motion-pane-duration)]", collapsed && "opacity-0")} />
    </Button>
  );

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        </TooltipTrigger>
        {round && (
          <TooltipContent side={collapsed ? "right" : "bottom"} sideOffset={8}>
            {user ? name : "Account"}
          </TooltipContent>
        )}
      </Tooltip>
      <DropdownMenuContent
        side={compact ? "bottom" : collapsed ? "right" : "top"}
        align={compact || collapsed ? "end" : "start"}
        sideOffset={collapsed ? 12 : 6}
        className={cn("p-1", compact || collapsed ? "w-64" : "w-[var(--radix-dropdown-menu-trigger-width)] min-w-52")}
      >
        <DropdownMenuLabel className="flex flex-col gap-1 px-2.5 py-2 font-normal">
          <span className="truncate type-base font-medium text-foreground">{user ? name : "Welcome to Eneles"}</span>
          <span className="truncate type-tiny text-muted-foreground">{user ? user.email : "Sign in to open your dashboard"}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className={separator} />
        {user ? (
          destinations.map((id) => {
            const page = DESTINATIONS[id];
            return (
              <DropdownMenuItem key={id} asChild className={item}>
                <Link href={page.href} onClick={onNavigate}>
                  <page.icon />
                  {page.title}
                </Link>
              </DropdownMenuItem>
            );
          })
        ) : (
          <>
            <DropdownMenuItem asChild className={item}>
              <Link href="/login" onClick={onNavigate}>
                <LogIn />
                Log in
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className={item}>
              <Link href="/signup" onClick={onNavigate}>
                <UserPlus />
                Sign up
              </Link>
            </DropdownMenuItem>
            {signedOutDestinations.map((id) => {
              const page = DESTINATIONS[id];
              return (
                <DropdownMenuItem key={id} asChild className={item}>
                  <Link href={page.href} onClick={onNavigate}>
                    <page.icon />
                    {page.title}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </>
        )}
        <DropdownMenuSeparator className={separator} />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={item}>
            <current.icon className="size-4 text-muted-foreground" />
            <span className="flex-1">Theme: {current.label}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-40 p-1">
            <DropdownMenuRadioGroup value={current.value} onValueChange={changeTheme}>
              {THEMES.map((t) => (
                <DropdownMenuRadioItem key={t.value} value={t.value} className="min-h-9">
                  {t.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {user && (
          <>
            <DropdownMenuSeparator className={separator} />
            <DropdownMenuItem variant="destructive" className={item} onSelect={() => logout()}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

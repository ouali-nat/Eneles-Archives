"use client"

import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { ProfileMenu } from "@/components/essential/account/ProfileMenu"

/** The site header's account corner: signed in, the way to the dashboard and the account menu behind the person's face; signed out, Log in and Sign up. `menu={false}` leaves the face out, for a place that already has it (the phone header shows it beside the theme button, so its drawer does not repeat it). */
export function AuthButtons({ menu = true }: { menu?: boolean }) {
  const { user, isInitialized } = useAuth()

  // Nothing flashes while the first sign-in check runs: the room is held instead.
  if (!isInitialized) {
    return <div className="h-[var(--control-height)] w-40" aria-hidden />
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <Button asChild variant="default">
          <Link href="/dashboard">Dashboard</Link>
        </Button>
        {menu && <ProfileMenu compact destinations={["dashboard", "profile", "settings"]} />}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="ghost">
        <Link href="/login">Log in</Link>
      </Button>
      <Button asChild variant="default">
        <Link href="/signup">Sign up</Link>
      </Button>
    </div>
  )
}

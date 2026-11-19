"use client";

import "@/app/globals.css";
import { useEffect, useLayoutEffect } from "react";
import { fontMono, fontSans } from "@/lib/fonts";
import { MOTION_STORAGE_KEY, resolveMotion } from "@/lib/appearance";
import { StatusPage } from "@/components/essential/status/StatusPage";
import { cn } from "@/lib/utils";

/** The root layout itself failed, so nothing above this exists: it draws its own document, and sets the theme and the motion level that the layout's boot script and theme provider would have set, read from the same stored preferences. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    try {
      const theme = localStorage.getItem("theme") ?? "system";
      const dark = theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.setAttribute("data-mode", dark ? "dark" : "light");
      const motion = localStorage.getItem(MOTION_STORAGE_KEY) ?? "system";
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      root.setAttribute("data-motion", resolveMotion(motion === "full" || motion === "reduced" || motion === "off" ? motion : "system", reduced));
    } catch {
      root.setAttribute("data-mode", "dark");
      root.setAttribute("data-motion", "full");
    }
  }, []);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Something went wrong - Eneles</title>
      </head>
      <body className={cn("min-h-screen bg-background font-sans text-foreground antialiased", fontSans.variable, fontMono.variable)}>
        <div className="@container flex min-h-screen w-full flex-col">
          <StatusPage
            kind="error"
            detail={error.digest}
            actions={[
              { label: "Try again", onClick: reset },
              // The router lives in the layout that failed, so home is a full page load.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              { label: "Go home", onClick: () => window.location.assign("/") },
            ]}
          />
        </div>
      </body>
    </html>
  );
}

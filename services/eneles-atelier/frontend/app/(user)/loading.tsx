"use client";

import { usePathname } from "next/navigation";
import { RouteSkeleton } from "@/components/essential/layout/RouteSkeleton";

/** A signed-in route that is still loading: only the content area waits, in the shape of the page that is coming; the sidebar around it stays. */
export default function UserLoading() {
  return <RouteSkeleton pathname={usePathname()} />;
}

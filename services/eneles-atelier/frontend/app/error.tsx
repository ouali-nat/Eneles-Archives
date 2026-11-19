"use client";

import { useEffect } from "react";
import { StatusPage } from "@/components/essential/status/StatusPage";

/** A page that threw while rendering. The layout above it still stands; this replaces the page, offers to render it again, and quotes the error's digest so a report can be matched to the server log. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <StatusPage kind="error" detail={error.digest} actions={[{ label: "Try again", onClick: reset }, { label: "Go home", href: "/" }]} />;
}

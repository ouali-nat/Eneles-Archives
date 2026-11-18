"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMarks } from "@/components/BrandMarks";
import { Button } from "@/components/ui/button";
import { StatusGrid } from "@/components/essential/shaders/StatusGrid";
import { cn } from "@/lib/utils";

/**
 * Every status the site can show instead of a page, with its copy written once. A route passes the kind and the actions that fit where it is; it never writes new sentences. `disorder` is the one thing the ground changes between them (components/essential/shaders/StatusGrid.tsx): the worse the state, the more of the ruled sheet has come loose.
 */
export const STATUS = {
  "not-found": { code: "404", title: "Page not found", sentence: "This page does not exist, or it has moved.", disorder: 0.05 },
  "project-missing": { code: "404", title: "Project not found", sentence: "This project does not exist, or you do not have access to it.", disorder: 0.05 },
  "snip-missing": { code: "404", title: "Snip not found", sentence: "This snip does not exist, or it was deleted.", disorder: 0.05 },
  "pdf-missing": { code: "404", title: "PDF not found", sentence: "This PDF does not exist, or it was deleted.", disorder: 0.05 },
  forbidden: { code: "403", title: "No access", sentence: "Your account does not have access to this page.", disorder: 0.03 },
  error: { code: "500", title: "Something went wrong", sentence: "Something went wrong on our side. Try again in a moment.", disorder: 0.1 },
  offline: { code: "Offline", title: "Cannot reach Eneles", sentence: "Eneles could not reach its server. Check your connection, then try again.", disorder: 0.07 },
} as const;

export type StatusKind = keyof typeof STATUS;

/** One action: a link, a handler, or the browser's Back (which goes to `fallback` when there is no page to go back to). */
export type StatusAction = { label: string } & ({ href: string } | { onClick: () => void } | { back: true; fallback: string });

export function StatusPage({
  kind,
  actions,
  sentence,
  detail,
  frame = "page",
  children,
}: {
  kind: StatusKind;
  /** The first is the main action; at most two make sense. */
  actions: StatusAction[];
  /** Replaces the default sentence only where the page knows more (the admin panel's reason for refusing). */
  sentence?: ReactNode;
  /** A reference to quote to support (an error's digest), shown small under the sentence. */
  detail?: string;
  /** "page" draws the whole window with the wordmark on top; "fill" fills the area it is placed in (inside the site's header and footer, or the signed-in shell). */
  frame?: "page" | "fill";
  /** Anything to show under the actions (the account that is signed in). */
  children?: ReactNode;
}) {
  const status = STATUS[kind];
  const word = status.code.length > 3;

  return (
    <div className={cn("@container/status relative isolate flex w-full flex-col bg-background text-foreground", frame === "page" ? "min-h-dvh" : "min-h-[min(44rem,calc(100dvh-var(--header-height)))] flex-1")} data-status={kind}>
      {/* Inside a frame the sheet fades out at its top and bottom, so it never meets the header or the footer with an edge. */}
      <StatusGrid disorder={status.disorder} className={cn("-z-10", frame === "fill" && "[mask-image:linear-gradient(to_bottom,transparent,black_14%,black_86%,transparent)]")} />
      {frame === "page" && (
        <header className="container flex h-16 shrink-0 items-center">
          <Link href="/" aria-label="Eneles home" className="flex items-center rounded-[var(--radius)]">
            <BrandMarks.logo className="h-5 w-auto fill-foreground" />
          </Link>
        </header>
      )}
      <main className={cn("flex flex-1 items-center justify-center px-6", frame === "page" ? "pb-16" : "py-16")}>
        <div className="flex w-full max-w-md flex-col items-center text-center">
          <h1 className="font-semibold leading-none tracking-[-0.04em] tabular-nums">
            <span aria-hidden className={cn("block", word ? "text-[clamp(3.5rem,16cqi,6rem)]" : "text-[clamp(6rem,30cqi,9.5rem)]")}>
              {status.code}
            </span>
            <span className="sr-only">{status.title}</span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground text-balance">{sentence ?? status.sentence}</p>
          {detail && <p className="mt-2 font-mono type-small text-muted-foreground">Reference {detail}</p>}
          <div className="mt-8 flex w-full flex-col gap-2 @min-[28rem]/status:w-auto @min-[28rem]/status:flex-row @min-[28rem]/status:justify-center">
            {actions.map((action, index) => (
              <ActionButton key={action.label} action={action} primary={index === 0} />
            ))}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function ActionButton({ action, primary }: { action: StatusAction; primary: boolean }) {
  const variant = primary ? "default" : "outline";
  if ("href" in action) {
    return (
      <Button asChild variant={variant}>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }
  if ("back" in action) {
    const back = () => {
      if (window.history.length > 1) window.history.back();
      else window.location.assign(action.fallback);
    };
    return (
      <Button variant={variant} onClick={back}>
        {action.label}
      </Button>
    );
  }
  return (
    <Button variant={variant} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMarks } from "@/components/BrandMarks";
import { ModeToggle } from "@/components/essential/layout/ModeToggle";
import { AsciiField } from "@/components/essential/shaders/AsciiField";
import { cn } from "@/lib/utils";

/**
 * The sign-in and sign-up screens: a field of characters drifting across the whole page at low opacity, and the form on a plain card in the middle.
 */
export function AuthFrame({ children, actions }: { children: ReactNode; /** Drawn beside the color mode button (the desktop app's sign-in, which sits over the app, puts its close button here). */ actions?: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <div aria-hidden className="absolute inset-0 -z-10 opacity-[0.22]">
        <AsciiField />
      </div>
      <header className="flex h-16 shrink-0 items-center justify-between px-5 @min-[40rem]:px-8">
        <Link href="/" aria-label="Eneles home" className="inline-flex items-center">
          <BrandMarks.logo className="h-5 w-auto fill-foreground" />
        </Link>
        <div className="flex items-center gap-2">
          <ModeToggle />
          {actions}
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">{children}</main>
      <footer className="flex h-12 shrink-0 items-center justify-center gap-4 px-5 text-xs text-muted-foreground">
        <Link href="/terms" className="hover:text-foreground">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <Link href="/contact" className="hover:text-foreground">
          Help
        </Link>
      </footer>
    </div>
  );
}

/** The card a sign-in step sits on. */
export function AuthCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="auth-title"
      className={cn(
        "w-full max-w-[28rem] rounded-[var(--radius-surface)] border border-line bg-panel p-8 shadow-[var(--modal-shadow)] @min-[40rem]:p-10",
        className,
      )}
    >
      <h1 id="auth-title" className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">
        {title}
      </h1>
      {description && <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{description}</p>}
      <div className="mt-8">{children}</div>
      {footer && <div className="mt-8 border-t border-line pt-6 text-sm text-muted-foreground">{footer}</div>}
    </section>
  );
}

/** A labelled field at the size the sign-in forms use. */
export const authInput = "h-11 px-3.5 text-[15px]";

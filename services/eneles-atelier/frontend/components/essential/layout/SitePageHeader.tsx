import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The top of every public page outside the docs and library shells (Features, Pricing, About, Contact, Changelog, Contribute): one centered title, one line or two of description, and optional actions, at one size and with one rhythm, so moving between pages never shifts the title.
 */
export function SitePageHeader({ title, description, children, className }: { title: ReactNode; description?: ReactNode; /** Actions or controls under the description. */ children?: ReactNode; className?: string }) {
  return (
    <header className={cn("container pt-24 pb-14 text-center @min-[40rem]:pt-32 @min-[40rem]:pb-16", className)}>
      <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-pretty @min-[40rem]:text-5xl">{title}</h1>
      {description && <p className="mx-auto mt-5 max-w-4xl text-lg leading-relaxed text-muted-foreground text-pretty @min-[40rem]:text-xl">{description}</p>}
      {children && <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{children}</div>}
    </header>
  );
}

/**
 * The top of a page inside the docs or library shell, where a sidebar already sits to the left: the same title size on every page of both, set flush left.
 */
export function ShellPageHeader({ title, description, eyebrow, actions, mono = false, className }: { title: ReactNode; description?: ReactNode; /** A line above the title (a package's category). */ eyebrow?: ReactNode; /** Buttons at the end of the title row. */ actions?: ReactNode; /** Set the title in the code face (a package name). */ mono?: boolean; className?: string }) {
  return (
    <header className={cn("mb-10", className)}>
      {eyebrow && <p className="mb-2 type-small text-muted-foreground">{eyebrow}</p>}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <h1 className={cn("min-w-0 text-3xl font-semibold tracking-[-0.02em] text-pretty", mono && "font-mono")}>{title}</h1>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="mt-3 text-lg leading-relaxed text-muted-foreground text-pretty">{description}</p>}
    </header>
  );
}

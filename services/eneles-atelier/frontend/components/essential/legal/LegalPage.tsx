import type { ReactNode } from "react";
import { SitePageHeader } from "@/components/essential/layout/SitePageHeader";

/**
 * Shared shell for the legal pages.
 *
 * These pages each used to roll their own heading sizes and spacing, which is
 * how legal copy drifts out of sync: one page gets updated and the others
 * quietly keep contradicting it. A single layout at least keeps the structure
 * and the "last updated" treatment identical across all three.
 */

export function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <SitePageHeader title={title} description={intro}>
        <p className="type-base text-muted-foreground">Last updated {updated}</p>
      </SitePageHeader>
      <div className="container max-w-3xl pb-16 @min-[40rem]:pb-20">
      <div className="divide-y">{children}</div>

      <footer className="mt-12 rounded-xl border bg-surface/30 p-5">
        <p className="text-sm leading-relaxed text-muted-foreground">
          This document is written to describe how Eneles actually works, in
          plain language. It is not legal advice, and it is not a substitute for
          your own review if you are adopting the service on behalf of an
          institution. If anything here conflicts with what the product does,
          treat it as a bug and tell us at{" "}
          <a
            className="underline underline-offset-4"
            href="/contact"
          >
            le formulaire de contact Eneles
          </a>
          .
        </p>
      </footer>
      </div>
    </div>
  );
}

export function LegalSection({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="py-8">
      <h2 className="text-xl font-semibold tracking-tight">
        <span className="me-3 tabular-nums text-muted-foreground/50">{n}</span>
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2.5 ps-1">
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <span
            className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40"
            aria-hidden
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

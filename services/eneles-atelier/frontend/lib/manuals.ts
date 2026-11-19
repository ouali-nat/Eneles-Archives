import { docsGroups, type DocGroup, type DocPage } from "@/lib/docs-nav";
import { learnGroups } from "@/lib/learn-nav";

/**
 * The site has two manuals that share one shell (sidebar, search, breadcrumbs, previous and next): Docs, on using Eneles, and Learn, on LaTeX itself. A manual is its base path and its groups of pages; everything the shell needs is derived from that.
 */
export type ManualId = "docs" | "learn";

export interface Manual {
  id: ManualId;
  /** The path its pages live under. */
  base: string;
  /** Short name, for breadcrumbs and the mobile button. */
  name: string;
  /** Full name, for landmarks and dialog titles. */
  title: string;
  searchLabel: string;
  /** The repository its pages are written in, and the folder they sit in there, for "Edit this page". */
  repository: string;
  pagesDir: string;
  groups: DocGroup[];
}

export const MANUALS: Record<ManualId, Manual> = {
  docs: { id: "docs", base: "/docs", name: "Docs", title: "Documentation", searchLabel: "Search docs", repository: "docs", pagesDir: "pages", groups: docsGroups },
  learn: { id: "learn", base: "/learn", name: "Learn", title: "Learn LaTeX", searchLabel: "Search lessons", repository: "learn", pagesDir: "lessons", groups: learnGroups },
};

export function manualHref(manual: Manual, slug: string): string {
  return slug ? `${manual.base}/${slug}` : manual.base;
}

/** Every page, in sidebar order. */
export function manualPages(manual: Manual): DocPage[] {
  return manual.groups.flatMap((g) => g.items);
}

export function manualPage(manual: Manual, slug: string): DocPage | undefined {
  return manualPages(manual).find((p) => p.slug === slug);
}

export function manualGroupOf(manual: Manual, slug: string): string | undefined {
  return manual.groups.find((g) => g.items.some((i) => i.slug === slug))?.title;
}

export function manualAdjacent(manual: Manual, slug: string): { prev?: DocPage; next?: DocPage } {
  const pages = manualPages(manual);
  const index = pages.findIndex((p) => p.slug === slug);
  if (index === -1) return {};
  return { prev: pages[index - 1], next: pages[index + 1] };
}

/** The slug a pathname names within a manual. */
export function manualSlug(manual: Manual, pathname: string): string {
  return pathname.slice(manual.base.length).replace(/^\//, "").replace(/\/$/, "");
}

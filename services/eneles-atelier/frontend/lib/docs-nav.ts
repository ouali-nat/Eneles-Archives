import docsManifest from "@/content/docs.json";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface DocPage {
  /** Path after `/docs/`. The overview page uses an empty slug. */
  slug: string;
  title: string;
  /** Shown in search results and on the docs landing page. */
  description: string;
  /** A longer description, 120 to 160 characters, for search results and link previews. Falls back to the description. */
  summary?: string;
  /**
   * Extra search terms that do not appear in the title. Search is over this
   * metadata rather than page bodies: MDX content is not available at runtime
   * without a build-time indexing step, and for a docs set this size, titles
   * plus deliberate keywords beat a half-working full-text index.
   */
  keywords?: string[];
  /** Badge in the API sidebar. */
  method?: HttpMethod;
  /** A page built into the site (the overview pages), not written in the docs repository. */
  builtIn?: boolean;
}

export interface DocGroup {
  title: string;
  items: DocPage[];
}

/**
 * The guides and their order come from the docs repository's nav.json and each page's frontmatter, copied in by scripts/sync-content.mjs. Nothing about the manual's contents is written here.
 */
export const docsGroups: DocGroup[] = (docsManifest as { groups: DocGroup[] }).groups;

/** Flat, in sidebar order. Used for prev/next and search. */
export const docsNav: DocPage[] = docsGroups.flatMap((g) => g.items);

export function docHref(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}

export function getDocBySlug(slug: string): DocPage | undefined {
  return docsNav.find((d) => d.slug === slug);
}

export function getGroupOf(slug: string): string | undefined {
  return docsGroups.find((g) => g.items.some((i) => i.slug === slug))?.title;
}

export function getAdjacentDocs(slug: string): {
  prev?: DocPage;
  next?: DocPage;
} {
  const idx = docsNav.findIndex((d) => d.slug === slug);
  if (idx === -1) return {};
  return {
    prev: idx > 0 ? docsNav[idx - 1] : undefined,
    next: idx < docsNav.length - 1 ? docsNav[idx + 1] : undefined,
  };
}

/** Turn a pathname into the slug used throughout this module. */
export function slugFromPathname(pathname: string): string {
  return pathname.replace(/^\/docs\/?/, "").replace(/\/$/, "");
}

"use client";

import { useMemo } from "react";
import { SearchDialog } from "@/components/essential/search/SiteSearch";
import { manualHref, type Manual } from "@/lib/manuals";

/**
 * The search dialog of a manual (Docs or Learn), on the site's one search dialog. Matching runs against each page's title, description, and its hand-picked `keywords`, not page bodies: MDX compiles to components, so there is no runtime text to index without a build step, and chosen keywords beat a half-working full-text index.
 */
export function DocsSearch({ manual, open, onOpenChange }: { manual: Manual; open: boolean; onOpenChange: (open: boolean) => void }) {
  const groups = useMemo(
    () =>
      manual.groups.map((group) => ({
        heading: group.title,
        entries: group.items.map((item) => ({
          id: item.slug || "overview",
          title: item.title,
          description: item.description,
          keywords: item.keywords,
          href: manualHref(manual, item.slug),
        })),
      })),
    [manual],
  );
  return <SearchDialog open={open} onOpenChange={onOpenChange} title={manual.searchLabel} placeholder={manual.searchLabel} groups={groups} empty="No matching page." />;
}

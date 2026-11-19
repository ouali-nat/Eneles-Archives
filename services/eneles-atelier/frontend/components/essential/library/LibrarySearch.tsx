"use client";

import { SearchDialog, type SearchGroup } from "@/components/essential/search/SiteSearch";
import { exampleHref, libraryEntries, libraryHref, templateGroups, templateHref } from "@/lib/library-nav";

/** Everything in the library, grouped as its sidebar is: packages, their examples, and the templates. */
const groups: SearchGroup[] = [
  {
    heading: "Packages",
    entries: libraryEntries.map((lib) => ({ id: `package-${lib.id}`, title: lib.name, description: lib.description, keywords: [lib.category], href: libraryHref(lib.id), mono: true })),
  },
  {
    heading: "Examples",
    entries: libraryEntries.flatMap((lib) => lib.examples.map((ex) => ({ id: `example-${lib.id}-${ex.id}`, title: ex.name, description: `${lib.name}: ${ex.description}`, keywords: [lib.name, ...ex.tags], href: exampleHref(lib.id, ex.id) }))),
  },
  {
    heading: "Templates",
    entries: templateGroups.flatMap((group) => group.templates.map((t) => ({ id: `template-${t.id}`, title: t.name, description: t.description, keywords: [group.category], href: templateHref(t.id) }))),
  },
];

/** The library's search dialog, on the site's one search dialog. */
export function LibrarySearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <SearchDialog open={open} onOpenChange={onOpenChange} title="Search the library" placeholder="Search the library" groups={groups} empty="Nothing in the library matches." />;
}

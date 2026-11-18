"use client";

import { useEffect, useState } from "react";
import { FileCode, FileText, FolderOpen } from "@/components/icons";
import { SearchDialog as SiteSearchDialog, type SearchEntry, type SearchGroup } from "@/components/essential/search/SiteSearch";
import { pdfsAPI, projectsAPI, snipsAPI } from "@/lib/api";
import { accountPages, navGroups } from "./nav";

type Directory = { projects: SearchEntry[]; snips: SearchEntry[]; pdfs: SearchEntry[] };

const pages: SearchEntry[] = [
  ...navGroups.flatMap((g) => g.items.map((item) => ({ id: `page-${item.url}`, title: item.title, href: item.url, icon: item.icon }))),
  ...accountPages.map((page) => ({ id: `page-${page.href}`, title: page.title, href: page.href, icon: page.icon })),
];

/**
 * Search across the signed-in pages and the person's projects, snips, and PDFs, on the site's one search dialog, opened from the sidebar or with Mod+K. The lists are read the first time it opens and again on each later opening, so a new project is found without a reload.
 */
export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    Promise.allSettled([projectsAPI.getProjects(1, 100), snipsAPI.getMySnips(1, 100), pdfsAPI.getMyPdfs(1, 100)]).then(([projects, snips, pdfs]) => {
      if (!live) return;
      setFailed([projects, snips, pdfs].every((r) => r.status === "rejected"));
      setDirectory({
        projects: projects.status === "fulfilled" ? (projects.value.data ?? []).map((p) => ({ id: `project-${p.uid}`, title: p.title || "Untitled project", href: `/projects/${p.uid}`, icon: FolderOpen })) : [],
        snips: snips.status === "fulfilled" ? (snips.value.data ?? []).map((s) => ({ id: `snip-${s.id}`, title: s.title || "Untitled snip", href: `/snips/${s.id}`, icon: FileCode })) : [],
        pdfs: pdfs.status === "fulfilled" ? (pdfs.value.data ?? []).map((p) => ({ id: `pdf-${p.id}`, title: p.title || "Untitled PDF", href: `/pdfs/${p.id}`, icon: FileText })) : [],
      });
    });
    return () => {
      live = false;
    };
  }, [open]);

  const groups: SearchGroup[] = [
    { heading: "Pages", entries: pages },
    ...(directory
      ? [
          { heading: "Projects", entries: directory.projects },
          { heading: "Snips", entries: directory.snips },
          { heading: "PDFs", entries: directory.pdfs },
        ]
      : []),
  ];

  return (
    <SiteSearchDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      placeholder="Search pages, projects, snips, and PDFs"
      groups={groups}
      empty={directory ? "Nothing matches." : "Loading your projects…"}
      notice={failed ? "Your projects, snips, and PDFs could not be read, so only pages are listed." : undefined}
    />
  );
}

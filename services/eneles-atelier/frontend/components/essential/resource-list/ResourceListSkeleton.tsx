"use client";

import type { ReactNode } from "react";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/essential/layout/PageHeader";
import { cn } from "@/lib/utils";
import { ResourceListToolbar } from "./ResourceListToolbar";
import type { ResourcePreview } from "./types";

/** Each preview's box as ResourceListItem's callers draw it (projects, snips, PDFs), and how many rows fill a first screen of that list. */
const PREVIEW: Record<ResourcePreview, { box: string; rows: number }> = {
  icon: { box: "size-10", rows: 6 },
  thumb: { box: "size-32", rows: 4 },
  page: { box: "h-32 w-24", rows: 4 },
};

const TITLE_WIDTHS = ["38%", "52%", "30%", "46%", "34%", "42%"];

/** Rows in ResourceListItem's exact frame (the same border, radius, padding, gap, preview box, title line, time, and the actions button's space), so the list does not move when the items arrive. */
export function ResourceRowsSkeleton({ preview, label }: { preview: ResourcePreview; label: string }) {
  const { box, rows } = PREVIEW[preview];
  return (
    <div role="status" aria-label={label} className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-lg border border-line/60">
          <div className="flex items-center gap-4 p-4">
            <Skeleton className={cn("shrink-0 rounded-[var(--radius)]", box)} />
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <SkeletonText className="min-w-0 flex-1 text-sm leading-tight" width={TITLE_WIDTHS[i % TITLE_WIDTHS.length]} />
              <SkeletonText className="w-[5.25rem] shrink-0 justify-end type-small" width="70%" />
              <span aria-hidden className="size-8 shrink-0" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const noop = () => {};

/** A whole list page before its route has loaded: the real header (title, description, and the page's action), the real search bar, and the rows' skeleton. */
export function ResourceListSkeleton({ title, description, itemNoun, preview, action, archive = true }: { title: string; description: string; itemNoun: string; preview: ResourcePreview; action: ReactNode; archive?: boolean }) {
  return (
    <Container className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-6">
        <PageHeader title={title} description={description} actions={action} />
        <ResourceListToolbar
          itemNoun={itemNoun}
          selectMode={false}
          selectedCount={0}
          searchQuery=""
          onSearchChange={noop}
          customTags={[]}
          selectedTag="all"
          onSelectedTagChange={noop}
          showArchived={false}
          onToggleArchived={noop}
          hasArchive={archive}
          hasLabel
          onBulkArchive={noop}
          onBulkLabel={noop}
          onBulkDelete={noop}
          onExitSelectMode={noop}
        />
        <ResourceRowsSkeleton preview={preview} label={`Loading ${itemNoun}`} />
      </div>
    </Container>
  );
}

"use client";

import { Plus, Upload } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/essential/layout/PageHeader";
import { DashboardSkeleton } from "@/components/essential/dashboard/DashboardParts";
import { ResourceListSkeleton } from "@/components/essential/resource-list/ResourceListSkeleton";
import { StatisticsSkeleton } from "@/components/essential/statistics/StatisticsSkeleton";
import { LoadingScreen } from "@/components/essential/status/LoadingScreen";

/**
 * The signed-in pages' content while a route loads, chosen by the address, so the placeholder is the page's own shape: the real title and description, the real controls that do not wait for data, and skeletons in the boxes that do. The shell (sidebar and phone header) is never part of it; it stays on screen around this. The full-screen views (the editor and a PDF) have no shell, so they get the quiet loading screen.
 */
export function RouteSkeleton({ pathname }: { pathname: string | null }) {
  const path = pathname ?? "";
  if ((path.startsWith("/projects/") && path !== "/projects/") || (path.startsWith("/pdfs/") && path !== "/pdfs/")) return <LoadingScreen />;

  if (path === "/dashboard") return <DashboardSkeleton />;
  // The list pages' actions are drawn for real but do nothing until the page arrives.
  if (path === "/projects")
    return (
      <ResourceListSkeleton
        title="Projects"
        description="Your LaTeX projects."
        itemNoun="projects"
        preview="icon"
        action={
          <Button className="pointer-events-none gap-1.5" tabIndex={-1}>
            <Plus className="h-4 w-4" />
            New project
          </Button>
        }
      />
    );
  if (path === "/snips")
    return (
      <ResourceListSkeleton
        title="Snips"
        description="Upload, process, and extract LaTeX from images"
        itemNoun="snips"
        preview="thumb"
        action={
          <Button className="pointer-events-none" tabIndex={-1}>
            <Upload aria-hidden />
            Upload image
          </Button>
        }
      />
    );
  if (path === "/pdfs")
    return (
      <ResourceListSkeleton
        title="PDFs"
        description="Upload and extract LaTeX from PDF documents"
        itemNoun="PDFs"
        preview="page"
        action={
          <Button className="pointer-events-none" tabIndex={-1}>
            <Upload aria-hidden />
            Upload PDF
          </Button>
        }
      />
    );
  if (path === "/statistics")
    return (
      <Container>
        <div className="flex flex-col gap-8">
          <PageHeader title="Statistics" description="Your projects, conversions, AI use, and storage." />
          <StatisticsSkeleton />
        </div>
      </Container>
    );
  if (path === "/templates")
    return (
      <Container>
        <div className="flex flex-col gap-6">
          <PageHeader title="Templates" description="Start a project from a shared template, or manage your own. To save one, open a project and choose File, then Save as template." />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-10 w-44 rounded-[var(--radius-popover)]" />
            <Skeleton className="h-[var(--control-height)] w-full max-w-xs rounded-[var(--radius)]" />
          </div>
          <CardsSkeleton count={3} columns />
        </div>
      </Container>
    );
  if (path === "/billing") return <SettingsSkeleton title="Accès Eneles" description="Toutes les fonctionnalités sont accessibles gratuitement." />;
  if (path === "/settings") return <SettingsSkeleton title="Settings" description="Security, sessions, API keys, and editor preferences." />;
  if (path === "/ai") return <SettingsSkeleton title="AI" description="Your API keys, the model Axya uses, and what it has used." />;
  if (path === "/profile") return <SettingsSkeleton title="Profile" description="How collaborators see you." />;
  return <SettingsSkeleton />;
}

/** A settings-like page: its header, then cards. Used for the account pages, which render at once after their code arrives, and for any address not listed above. */
function SettingsSkeleton({ title, description }: { title?: string; description?: string }) {
  return (
    <Container>
      <div role="status" aria-label="Loading" className="flex flex-col gap-6">
        {title ? (
          <PageHeader title={title} description={description} />
        ) : (
          <div>
            <SkeletonText className="text-2xl" width="10rem" />
            <SkeletonText className="mt-1 type-base" width="18rem" />
          </div>
        )}
        <CardsSkeleton count={3} />
      </div>
    </Container>
  );
}

function CardsSkeleton({ count, columns = false }: { count: number; columns?: boolean }) {
  return (
    <div className={columns ? "grid gap-3 @min-[40rem]:grid-cols-2 @5xl:grid-cols-3" : "flex flex-col gap-4"}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-lit-drop">
          <SkeletonText className="type-base" width={["40%", "55%", "32%"][i % 3]} />
          <SkeletonText className="type-small" width="85%" />
          <SkeletonText className="type-small" width="60%" />
          {columns && <Skeleton className="mt-4 h-[var(--control-height)] w-28 rounded-[var(--radius)]" />}
        </div>
      ))}
    </div>
  );
}


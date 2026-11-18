"use client";

import { SnipThumb } from "@/components/essential/snips/SnipThumb";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { pdfsAPI, projectsAPI, snipsAPI, type PDF, type Project, type Snip } from "@/lib/api";
import { Container } from "@/components/ui/container";
import { FileText, FolderOpen } from "@/components/icons";
import { RecentRow, RecentSection, type SectionState } from "@/components/essential/dashboard/RecentSection";
import { useResource, type ResourceStatus } from "@/hooks/useResource";
import { formatCount } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/time";
import { DashboardHeader, DashboardSkeleton, QuickActions, RECENT } from "@/components/essential/dashboard/DashboardParts";


function newestFirst<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, RECENT);
}

function sectionState(status: ResourceStatus, count: number): SectionState {
  if (status === "error") return "error";
  if (status !== "ready") return "loading";
  return count === 0 ? "empty" : "ready";
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push("/login");
  }, [isLoading, isAuthenticated, router]);

  const projects = useResource<Project[]>(
    isAuthenticated ? () => projectsAPI.getProjects().then((r) => r.data) : null,
    "Your projects could not be loaded.",
  );
  const snips = useResource<Snip[]>(
    isAuthenticated ? () => snipsAPI.getMySnips().then((r) => r.data) : null,
    "Your snips could not be loaded.",
  );
  const pdfs = useResource<PDF[]>(
    isAuthenticated ? () => pdfsAPI.getMyPdfs().then((r) => r.data) : null,
    "Your PDFs could not be loaded.",
  );

  const recentProjects = useMemo(() => newestFirst((projects.data ?? []).filter((p) => !p.archived)), [projects.data]);
  const recentSnips = useMemo(() => newestFirst(snips.data ?? []), [snips.data]);
  const recentPdfs = useMemo(() => newestFirst(pdfs.data ?? []), [pdfs.data]);

  // First-page thumbnails made at upload; a PDF without one keeps its icon.
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!isAuthenticated || recentPdfs.length === 0) return;
    let cancelled = false;
    Promise.all(
      recentPdfs.map(async (pdf) => [pdf.id, await pdfsAPI.getPdfThumbnailUrl(String(pdf.id)).catch(() => null)] as const),
    ).then((pairs) => {
      if (cancelled) return;
      setThumbnails(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => !!p[1])));
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, recentPdfs]);

  if (!user) return <DashboardSkeleton />;

  return (
    <Container>
      <div className="space-y-6">
        <DashboardHeader />

        <QuickActions />

        <RecentSection
          title="Recent projects"
          href="/projects"
          leading="icon"
          rows={RECENT}
          state={sectionState(projects.status, recentProjects.length)}
          error={projects.error}
          onRetry={projects.reload}
          empty={{ text: "Projects you create or are invited to appear here.", action: { label: "New project", href: "/projects?new=1" } }}
        >
          {recentProjects.map((project) => {
            const files = project._count?.files ?? project.files?.length ?? 0;
            return (
              <RecentRow
                key={project.uid}
                href={`/projects/${project.uid}`}
                leading={<RowIcon icon={FolderOpen} />}
                title={project.title}
                detail={
                  <>
                    {formatCount(files, "file", "files")}
                    {project.isShared && <> · Shared with you</>}
                  </>
                }
                trailing={<RelativeTime value={project.updatedAt} style="short" focusable={false} />}
              />
            );
          })}
        </RecentSection>

        <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-2">
          <RecentSection
            title="Recent snips"
            href="/snips"
            leading="thumb"
            rows={RECENT}
            state={sectionState(snips.status, recentSnips.length)}
            error={snips.error}
            onRetry={snips.reload}
            empty={{ text: "Images you convert to LaTeX appear here.", action: { label: "Upload an image", href: "/snips" } }}
          >
            {recentSnips.map((snip) => (
              <RecentRow
                key={snip.id}
                href={`/snips/${snip.id}`}
                leading={<SnipThumb imageUrl={snip.imageUrl} latex={snip.latexContent} title={snip.title} className="size-11" />}
                title={snip.title || "Untitled snip"}
                detail={snip.description || undefined}
                trailing={<RelativeTime value={snip.updatedAt} style="short" focusable={false} />}
              />
            ))}
          </RecentSection>

          <RecentSection
            title="Recent PDFs"
            href="/pdfs"
            leading="page"
            rows={RECENT}
            state={sectionState(pdfs.status, recentPdfs.length)}
            error={pdfs.error}
            onRetry={pdfs.reload}
            empty={{ text: "PDFs you extract LaTeX from appear here.", action: { label: "Upload a PDF", href: "/pdfs" } }}
          >
            {recentPdfs.map((pdf) => (
              <RecentRow
                key={pdf.id}
                href={`/pdfs/${pdf.id}`}
                leading={
                  thumbnails[pdf.id] ? (
                    // A signed, short-lived storage URL: next/image's optimizer cannot cache it.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnails[pdf.id]}
                      alt=""
                      className="h-10 w-8 rounded-[var(--radius-inset)] border border-line bg-paper object-cover object-top"
                    />
                  ) : (
                    <RowIcon icon={FileText} />
                  )
                }
                title={pdf.title || "Untitled PDF"}
                detail={pdf.pageCount ? formatCount(pdf.pageCount, "page", "pages") : "Processing"}
                trailing={<RelativeTime value={pdf.updatedAt} style="short" focusable={false} />}
              />
            ))}
          </RecentSection>
        </div>
      </div>
    </Container>
  );
}

function RowIcon({ icon: Icon }: { icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> }) {
  return (
    <span className="flex size-8 items-center justify-center rounded-[var(--radius)] border border-line bg-surface text-muted-foreground">
      <Icon aria-hidden className="size-4" />
    </span>
  );
}

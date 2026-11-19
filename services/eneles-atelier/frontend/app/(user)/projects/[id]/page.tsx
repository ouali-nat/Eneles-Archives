"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { projectsAPI, type Project } from "@/lib/api";
import { EditorView } from "@/components/editor/EditorView";
import { type ProjectFileItem } from "@/components/editor/FileTree";
import { BrandMarks } from "@/components/BrandMarks";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { StatusPage } from "@/components/essential/status/StatusPage";
import { LoadingScreen } from "@/components/essential/status/LoadingScreen";

export default function ProjectEditorPage() {
  const router = useRouter();
  const params = useParams();
  const projectUid = params.id as string;
  const { isAuthenticated } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [acceptingInvite, setAcceptingInvite] = useState(false);

  const createCalledRef = useRef(false);

  // If the URL is /projects/new, create a project and redirect to /projects/{uid}
  useEffect(() => {
    if (projectUid !== "new" || !isAuthenticated || createCalledRef.current) return;
    createCalledRef.current = true;
    setIsCreating(true);
    projectsAPI
      .createProject("Untitled Project")
      .then((project) => {
        router.replace(`/projects/${project.uid}`);
      })
      .catch(() => {
        setIsCreating(false);
        createCalledRef.current = false; // allow retry
      });
  }, [projectUid, isAuthenticated, router]);

  // Show the loader again whenever a new fetch starts (a sign-in or another project). The first fetch needs nothing: `loading` starts true.
  const fetchKey = projectUid !== "new" && isAuthenticated ? projectUid : null;
  const [fetchedKey, setFetchedKey] = useState(fetchKey);
  if (fetchedKey !== fetchKey) {
    setFetchedKey(fetchKey);
    if (fetchKey) setLoading(true);
  }

  // Fetch full project data for existing projects
  useEffect(() => {
    if (projectUid === "new" || !isAuthenticated) return;
    projectsAPI
      .getProject(projectUid)
      .then((p) => {
        setProject(p);
      })
      .catch(() => {
        // Not found, or not shared with this person: the page says so (below) instead of dropping them on the list with no word of why.
        setProject(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectUid, isAuthenticated, router]);

  // Show loading while creating a new project or fetching data
  if ((projectUid === "new" && isCreating) || loading) {
    return <LoadingScreen />;
  }

  if (!project) {
    return (
      <StatusPage
        kind="project-missing"
        frame="page"
        actions={[
          { label: "Go to projects", href: "/projects" },
          { label: "Go back", back: true, fallback: "/projects" },
        ]}
      />
    );
  }

  // Map DB files to Editor files (includes folders from isFolder)
  const initialFiles: ProjectFileItem[] = (project.files || []).map((f) => {
    if ((f as { isFolder?: boolean }).isFolder) {
      return {
        id: f.id.toString(),
        path: f.path,
        isMain: false,
        type: "folder" as const,
      };
    }
    const isTex = f.path.endsWith(".tex");
    const isBib = f.path.endsWith(".bib");
    const isSty = f.path.endsWith(".sty") || f.path.endsWith(".cls");
    const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f.path);
    const type = isTex
      ? "tex"
      : isBib
        ? "bib"
        : isSty
          ? "sty"
          : isImage
            ? "image"
            : "other";

    return {
      id: f.id.toString(),
      path: f.path,
      isMain: f.isMain,
      type,
      binary: !!f.filePath,
    };
  });

  const initialFileContents = (project.files || []).reduce(
    (acc: any, f) => {
      acc[f.id.toString()] = f.content || "";
      return acc;
    },
    {} as Record<string, string>,
  );

  // Seed the editor's optimistic-locking map so the very first save is
  // guarded too, rather than only saves after the first successful write.
  const initialFileVersions = (project.files || []).reduce(
    (acc, f) => {
      if (typeof f.version === "number") acc[f.id.toString()] = f.version;
      return acc;
    },
    {} as Record<string, number>,
  );

  const hasPendingInvite =
    project.invitationStatus === "pending" && project.invitationToken;
  const myRole = hasPendingInvite ? "viewer" : project.myRole || "owner";

  const handleAcceptInvite = async () => {
    if (!isAuthenticated || !project.invitationToken) return;
    setAcceptingInvite(true);
    try {
      await projectsAPI.acceptInvitation(project.invitationToken);
      toast.success("You've been added as a collaborator!");
      const updated = await projectsAPI.getProject(projectUid);
      setProject(updated);
    } catch (e: any) {
      toast.error(e.message || "Failed to accept invitation");
    } finally {
      setAcceptingInvite(false);
    }
  };

  const handleDeclineInvite = async () => {
    if (!isAuthenticated || !project.invitationToken) return;
    try {
      await projectsAPI.declineInvitation(project.invitationToken);
      toast.success("Invitation declined");
      router.push("/projects");
    } catch (e: any) {
      toast.error(e.message || "Failed to decline invitation");
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      {hasPendingInvite && (
        <div className="shrink-0 border-b bg-accent/10 px-4 py-2 flex items-center justify-between gap-4">
          <p className="text-sm text-foreground">
            You&apos;ve been invited to collaborate on this project. Accept to
            start editing.
          </p>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={handleDeclineInvite}
              disabled={acceptingInvite}
            >
              Decline
            </Button>
            <Button
              size="sm"
              onClick={handleAcceptInvite}
              disabled={acceptingInvite}
              className="gap-1.5"
            >
              {acceptingInvite && (
                <BrandMarks.spinner className="h-4 w-4 animate-spin" />
              )}
              Accept invitation
            </Button>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <EditorView
          key={projectUid}
          projectId={projectUid}
          projectTitle={project.title || "Untitled Project"}
          initialFiles={initialFiles}
          initialFileContents={initialFileContents}
          initialFileVersions={initialFileVersions}
          initialPendingAiDiff={project.pendingAiDiff ?? null}
          onBack={() => router.push(project.referenceOf ? `/projects/${project.referenceOf.uid}` : "/projects")}
          referenceOf={project.referenceOf ?? null}
          myRole={myRole}
          collaborators={project.collaborators || []}
          pendingInvitations={project.invitations || []}
          owner={project.user || null}
          initialAccess={project.access || "private"}
        />
      </div>
    </div>
  );
}

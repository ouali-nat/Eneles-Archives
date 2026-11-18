"use client";

import { RouteSkeleton } from "@/components/essential/layout/RouteSkeleton";
import { useLabelColors } from "@/hooks/useLabelColors";
import { LabelChip } from "@/components/essential/resource-list/LabelChip";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  Project,
  ProjectCollaborator,
  ProjectCollaboratorUser,
  projectsAPI,
} from "@/lib/api";
import JSZip from "jszip";
import { entriesFromZip, importProject, type ImportEntry } from "@/lib/project-import";
import { ResourceList } from "@/components/essential/resource-list/ResourceList";
import { NewProjectDialog } from "@/components/essential/projects/NewProjectDialog";
import { LATEX_TEMPLATES, getTemplateById } from "@/lib/latex/templates";
import { Plus, FileText } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AvatarGroup } from "@/components/people/Avatar";
import { toast } from "sonner";


interface ProjectResource {
  id: string;
  title: string;
  tags: string[];
  status: "pending" | "processing" | "completed" | "error";
  createdAt: string;
  updatedAt: string;
  color: string | null;
  archived: boolean;
  uid: string;
  isShared: boolean;
  myRole: string;
  ownerName: string;
  collaboratorCount: number;
  collaborators: Array<{
    userId: number;
    name: string;
    email: string;
    avatarUrl: string | null;
    role: "viewer" | "editor";
  }>;
  owner: { name: string; avatarUrl: string | null } | null;
}

function toResource(p: Project): ProjectResource {
  return {
    id: p.uid,
    title: p.title,
    tags: p.tags || [],
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt || p.createdAt,
    color: p.color || null,
    archived: p.archived || false,
    uid: p.uid,
    isShared: !!p.isShared,
    myRole: p.myRole || "owner",
    ownerName: p.ownerName || "",
    collaboratorCount: (p.collaborators || []).length,
    collaborators: (p.collaborators || []).map((c) => ({
      userId: c.userId,
      name: c.user?.name || c.user?.email || "Unknown",
      email: c.user?.email || "",
      avatarUrl: c.user?.avatarUrl || null,
      role: c.role,
    })),
    owner: p.user
      ? { name: p.user.name || p.user.email, avatarUrl: p.user.avatarUrl }
      : null,
  };
}

function ProjectsContent() {
  const { user, isAuthenticated } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<ProjectResource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const { colors: tagColors, setColor: saveTagColor } = useLabelColors();

  // Show the loader again whenever a sign-in starts a new fetch. The first fetch needs nothing: `isLoading` starts true.
  const [wasAuthenticated, setWasAuthenticated] = useState(isAuthenticated);
  if (wasAuthenticated !== isAuthenticated) {
    setWasAuthenticated(isAuthenticated);
    if (isAuthenticated) setIsLoading(true);
  }

  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchProjects = async () => {
      try {
        const res = await projectsAPI.getProjects();
        setProjects(res.data.map(toResource));
      } catch (err) {
        console.error("Failed to fetch projects:", err);
        toast.error("Failed to load projects");
      } finally {
        setIsLoading(false);
      }
    };

    fetchProjects();
  }, [isAuthenticated]);

  // Remember template from URL for modal (before we clear it)
  const [initialTemplateId, setInitialTemplateId] = useState<string | null>(
    null,
  );
  // ?template=<id> opens the dialog on that template; ?new=1 opens it blank. The dialog opens in the render that first sees the query, and the effect below then clears the query from the URL.
  const [handledSearchParams, setHandledSearchParams] = useState<typeof searchParams | null>(null);
  if (handledSearchParams !== searchParams) {
    setHandledSearchParams(searchParams);
    const templateId = searchParams.get("template");
    if (templateId || searchParams.get("new")) {
      if (templateId) setInitialTemplateId(templateId);
      setShowNewProjectDialog(true);
    }
  }
  useEffect(() => {
    if (searchParams.get("template") || searchParams.get("new")) {
      router.replace("/projects", { scroll: false });
    }
  }, [searchParams, router]);

  const handleCreateProject = async (data: {
    name: string;
    description?: string;
    templateId?: string;
    tags?: string[];
    content?: string;
    entries?: ImportEntry[];
  }) => {
    if (!isAuthenticated) return;
    setIsCreating(true);
    try {
      if (data.entries) {
        const { project, skipped } = await importProject(data.name, data.entries);
        if (skipped.length) {
          toast.warning(`${skipped.length} file${skipped.length === 1 ? " was" : "s were"} left out: ${skipped.slice(0, 3).map((s) => `${s.path} (${s.reason})`).join(", ")}${skipped.length > 3 ? "…" : ""}`);
        }
        setProjects((prev) => [toResource(project), ...prev]);
        router.push(`/projects/${project.uid}`);
        return;
      }
      const templateContent =
        data.content ??
        (data.templateId
          ? getTemplateById(data.templateId)?.content
          : undefined);
      const project = await projectsAPI.createProject(data.name,
        templateContent,
      );
      const updates: Record<string, any> = {};
      if (data.tags && data.tags.length > 0) updates.tags = data.tags;
      if (Object.keys(updates).length > 0) {
        await projectsAPI.updateProject(project.uid, updates);
      }
      const projectWithTags = { ...project, tags: data.tags || project.tags };
      setProjects((prev) => [toResource(projectWithTags as Project), ...prev]);
      router.push(`/projects/${project.uid}`);
    } catch (err) {
      console.error("Failed to create project:", err);
      toast.error("Failed to create project");
      throw err;
    } finally {
      setIsCreating(false);
    }
  };
  /** A ZIP becomes a project with all its files (a .tex file goes through handleUpload below). Dropped on the page or chosen with Upload. */
  const importZip = async (file: File) => {
    const toastId = toast.loading(`Importing ZIP "${file.name}"…`);
    try {
      const title = file.name.replace(/\.zip$/i, "");
      const { project, skipped } = await importProject(title, await entriesFromZip(file), (done, total) =>
        toast.loading(`Importing ZIP "${file.name}": ${done} of ${total} files`, { id: toastId }),
      );
      setProjects((prev) => [toResource(project), ...prev]);
      if (skipped.length) {
        toast.warning(`Imported "${title}". ${skipped.length} file${skipped.length === 1 ? " was" : "s were"} left out: ${skipped.slice(0, 3).map((s) => `${s.path} (${s.reason})`).join(", ")}${skipped.length > 3 ? "…" : ""}`, { id: toastId });
      } else {
        toast.success(`Imported "${title}" from ZIP`, { id: toastId });
      }
    } catch (err) {
      console.error("Failed to import ZIP:", err);
      toast.error(err instanceof Error ? `Could not import the ZIP: ${err.message}` : "Failed to import ZIP", { id: toastId });
    }
  };

  const handleUpload = async (file: File) => {
    if (!isAuthenticated) return;
    if (file.name.toLowerCase().endsWith(".zip")) return importZip(file);
    try {
      const content = await file.text();
      const title = file.name.replace(/\.tex$/i, "");
      const project = await projectsAPI.createProject(title, content);
      setProjects((prev) => [toResource(project), ...prev]);
      toast.success(`Imported "${title}"`);
    } catch (err) {
      console.error("Failed to import file:", err);
      toast.error("Failed to import file");
    }
  };

  const handleClone = async (id: string) => {
    if (!isAuthenticated) return;
    const source = projects.find((p) => p.id === id);
    if (!source) return;
    const cloneName = `${source.title} (copy)`;
    const toastId = toast.loading(`Cloning "${source.title}"…`);
    try {
      // 1. Fetch source files
      const files = await projectsAPI.getFiles(id);
      // 2. Find main file content for the initial create
      const mainFile = files.find((f) => f.isMain && !f.isFolder);
      // 3. Create the new project (blank or with main file content)
      const newProject = await projectsAPI.createProject(cloneName,
        mainFile?.content ?? undefined,
      );
      // 4. Recreate all remaining non-main files (and folders as needed)
      const filesToClone = files.filter((f) => !(f.isMain && !f.isFolder));
      await Promise.all(
        filesToClone.map((f) =>
          projectsAPI.createFile(newProject.uid, {
            path: f.path,
            content: f.isFolder ? undefined : (f.content ?? ""),
            isMain: false,
            isFolder: f.isFolder ?? false,
          }),
        ),
      );
      setProjects((prev) => [toResource(newProject), ...prev]);
      toast.success(`Cloned as "${cloneName}"`, { id: toastId });
    } catch (err) {
      console.error("Failed to clone project:", err);
      toast.error("Failed to clone project", { id: toastId });
    }
  };

  const handleDelete = async (id: string) => {
    if (!isAuthenticated) return;
    const project = projects.find((p) => p.id === id);
    if (project?.isShared) {
      toast.error("You can only delete projects you own");
      return;
    }
    try {
      await projectsAPI.deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast.success("Project deleted");
    } catch (err) {
      console.error("Failed to delete project:", err);
      toast.error("Failed to delete project");
    }
  };

  const handleRename = async (id: string, newTitle: string) => {
    if (!isAuthenticated) return;
    try {
      await projectsAPI.updateProject(id, { title: newTitle });
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, title: newTitle } : p)),
      );
    } catch (err) {
      console.error("Failed to rename project:", err);
      toast.error("Failed to rename project");
      throw err;
    }
  };

  const handleArchive = async (ids: string[]) => {
    if (!isAuthenticated) return;
    try {
      const updates = ids
        .map((id) => {
          const project = projects.find((p) => p.id === id);
          if (!project) return null;
          return { id, newArchived: !project.archived };
        })
        .filter((u): u is { id: string; newArchived: boolean } => u !== null);

      await Promise.all(
        updates.map(({ id, newArchived }) =>
          projectsAPI.updateProject(id, { archived: newArchived }),
        ),
      );

      setProjects((prev) =>
        prev.map((p) => {
          const update = updates.find((u) => u.id === p.id);
          return update ? { ...p, archived: update.newArchived } : p;
        }),
      );
      toast.success(
        ids.length === 1 ? "Project updated" : `${ids.length} projects updated`,
      );
    } catch (err) {
      console.error("Failed to archive:", err);
      toast.error("Failed to archive");
    }
  };

  const handleLabel = async (ids: string[], tag: string, color?: string) => {
    if (!isAuthenticated) return;
    try {
      const updates = ids
        .map((id) => {
          const project = projects.find((p) => p.id === id);
          if (!project) return null;
          const currentTags = project.tags || [];
          const newTags = currentTags.includes(tag)
            ? currentTags.filter((t) => t !== tag)
            : [...currentTags, tag];
          return { id, newTags };
        })
        .filter((u): u is { id: string; newTags: string[] } => u !== null);

      await Promise.all(
        updates.map(({ id, newTags }) =>
          projectsAPI.updateProject(id, { tags: newTags }),
        ),
      );

      setProjects((prev) =>
        prev.map((p) => {
          const update = updates.find((u) => u.id === p.id);
          return update ? { ...p, tags: update.newTags } : p;
        }),
      );
      if (color) saveTagColor(tag, color);
      toast.success("Labels updated");
    } catch (err) {
      console.error("Failed to update labels:", err);
      toast.error("Failed to update labels");
    }
  };

  const handleExport = async (id: string) => {
    if (!isAuthenticated) return;
    try {
      const data = await projectsAPI.exportProject(id);
      const zip = new JSZip();
      for (const file of data.files) {
        zip.file(file.path, file.content, { base64: file.encoding === "base64" });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.name.replace(/[^a-zA-Z0-9-_ ]/g, "_")}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Project exported as ZIP");
    } catch (err) {
      console.error("Failed to export project:", err);
      toast.error("Failed to export project");
    }
  };

  const handleItemClick = (item: ProjectResource) => {
    router.push(`/projects/${item.uid}`);
  };

  const renderItemPreview = (item: ProjectResource) => {
    return (
      <div
        className="w-10 h-10 rounded-md overflow-hidden shrink-0 border flex items-center justify-center relative"
        style={{ backgroundColor: item.color ? `${item.color}15` : undefined }}
      >
        {item.color && (
          <div
            className="absolute inset-y-0 start-0 w-1 rounded-s-md"
            style={{ backgroundColor: item.color }}
          />
        )}
        <FileText
          className="h-5 w-5 text-muted-foreground"
          style={item.color ? { color: item.color } : undefined}
        />
      </div>
    );
  };

  const renderItemMetadata = (item: ProjectResource) => {
    return (
      <div className="flex items-center gap-1.5">
        {item.isShared && <span className="inline-flex items-center rounded-full border border-hue-blue/30 bg-hue-blue/10 px-2 py-0.5 type-micro font-medium text-hue-blue">Shared{item.ownerName ? ` by ${item.ownerName}` : ""}</span>}
        {item.tags
          .filter((t) => t !== "archived")
          .map((tag) => {
            return <LabelChip key={tag} label={tag} color={tagColors[tag]} />;
          })}
      </div>
    );
  };

  // Collaborators, in their own column after the labels. Up to four faces, or three and a +n tile: the column is as wide as that.
  const renderItemPeople = (item: ProjectResource) =>
    item.collaborators.length > 0 && !item.isShared ? (
      <AvatarGroup
        label="Collaborators"
        size="sm"
        max={4}
        people={item.collaborators.map((c) => ({ key: c.userId, id: c.userId, name: c.name, email: c.email, avatarUrl: c.avatarUrl, role: c.role === "editor" ? "Editor" : "Viewer" }))}
      />
    ) : null;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge variant="secondary" className="text-[10px]">
            Ready
          </Badge>
        );
      case "processing":
        return (
          <Badge
            variant="secondary"
            className="text-[10px] bg-hue-blue/10 text-hue-blue"
          >
            Compiling
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive" className="text-[10px]">
            Error
          </Badge>
        );
      default:
        return null;
    }
  };

  // Convert archived field to tags-based system for ResourceList compatibility
  const itemsForList: ProjectResource[] = projects.map((p) => ({
    ...p,
    tags: p.archived
      ? [...(p.tags || []).filter((t) => t !== "archived"), "archived"]
      : (p.tags || []).filter((t) => t !== "archived"),
  }));

  return (
    <ResourceList<ProjectResource>
      items={itemsForList}
      isLoading={isLoading}
      isUploading={isCreating}
      title="Projects"
      itemNoun="projects"
      preview="icon"
      description="Your LaTeX projects."
      acceptFileType=".tex,.zip"
      fileTypeLabel=".tex or .zip"
      onUpload={handleUpload}
      onDelete={handleDelete}
      onRename={handleRename}
      onArchive={handleArchive}
      onLabel={handleLabel}
      onClone={handleClone}
      onExport={handleExport}
      tagColors={tagColors}
      onItemClick={handleItemClick}
      renderItemPreview={renderItemPreview}
      renderItemMetadata={renderItemMetadata}
      renderItemPeople={renderItemPeople}
      getStatusBadge={getStatusBadge}
      renderHeaderActions={() => (
        <>
          <Button
            onClick={() => setShowNewProjectDialog(true)}
            disabled={isCreating}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            New project
          </Button>
          <NewProjectDialog
            open={showNewProjectDialog}
            onOpenChange={(open) => {
              setShowNewProjectDialog(open);
              if (!open) setInitialTemplateId(null);
            }}
            onCreate={handleCreateProject}
            templates={LATEX_TEMPLATES.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
            }))}
            defaultTemplateId={initialTemplateId ?? undefined}
          />
        </>
      )}
    />
  );
}

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={<RouteSkeleton pathname="/projects" />}
    >
      <ProjectsContent />
    </Suspense>
  );
}

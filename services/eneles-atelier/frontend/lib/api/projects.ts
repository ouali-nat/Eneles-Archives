import { API_URL, handleResponse, apiFetch } from "./client";
import type {
  Project,
  ProjectFile,
  ProjectReference,
  ProjectCollaborator,
  ProjectCollaboratorUser,
  ProjectInvitation,
  PendingAiDiff,
  ProjectSettings,
  CompileResult,
  AiChatResponse,
  AiChatTurn,
  FileHistoryEntry,
  HistoryPage,
  HistoryFacets,
  HistoryComparison,
  PaginatedResponse,
} from "./types";

// Projects API: all public operations use `uid` (the cuid string)
export const projectsAPI = {
  async getProjects(
    page = 1,
    limit = 50,
  ): Promise<PaginatedResponse<Project>> {
    const response = await apiFetch(
      `${API_URL}/projects?page=${page}&limit=${limit}`,
      {
      },
    );
    return handleResponse(response);
  },

  async getProject(uid: string): Promise<Project> {
    const response = await apiFetch(`${API_URL}/projects/${uid}`);
    return handleResponse(response);
  },

  async createProject(
    title: string,
    templateContent?: string,
    /** Attach the new project to another one as a reference paper. */
    reference?: { referenceOf: string; arxivId?: string },
  ): Promise<Project> {
    const response = await apiFetch(`${API_URL}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, templateContent, ...reference }),
    });
    return handleResponse(response);
  },

  async updateProject(
    uid: string,
    data: {
      title?: string;
      tags?: string[];
      color?: string;
      access?: "private" | "view" | "edit";
      archived?: boolean;
      pendingAiDiff?: PendingAiDiff | null;
    },
  ): Promise<Project> {
    const response = await apiFetch(`${API_URL}/projects/${uid}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return handleResponse(response);
  },

  /** The reference papers attached to a project, with their file lists. */
  async listReferences(uid: string): Promise<ProjectReference[]> {
    const response = await apiFetch(`${API_URL}/projects/${uid}/references`);
    return handleResponse(response);
  },

  async removeReference(uid: string, referenceUid: string): Promise<void> {
    const response = await apiFetch(`${API_URL}/projects/${uid}/references/${referenceUid}`, { method: "DELETE" });
    await handleResponse(response);
  },

  async deleteProject(uid: string) {
    const response = await apiFetch(`${API_URL}/projects/${uid}`, {
      method: "DELETE",
    });
    return handleResponse(response);
  },

  // Export
  async exportProject(
    uid: string,
  ): Promise<{ name: string; files: { path: string; content: string; encoding?: "base64" }[] }> {
    const response = await apiFetch(`${API_URL}/projects/${uid}/export`);
    return handleResponse(response);
  },

  // Collaboration
  async getCollaborators(
    uid: string,
  ): Promise<{
    collaborators: ProjectCollaborator[];
    pendingInvitations: ProjectInvitation[];
    /** The project's owner, and its link-sharing setting. */
    owner: ProjectCollaboratorUser | null;
    access: "private" | "view" | "edit";
  }> {
    const response = await apiFetch(`${API_URL}/projects/${uid}/collaborators`);
    return handleResponse(response);
  },

  async inviteCollaborator(
    uid: string,
    email: string,
    role: "viewer" | "editor",
  ) {
    const response = await apiFetch(`${API_URL}/projects/${uid}/collaborators`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, role }),
    });
    return handleResponse(response);
  },

  async removeCollaborator(
    uid: string,
    collaboratorUserId: number,
  ) {
    const response = await apiFetch(
      `${API_URL}/projects/${uid}/collaborators/${collaboratorUserId}`,
      {
        method: "DELETE",
      },
    );
    return handleResponse(response);
  },

  async updateCollaboratorRole(
    uid: string,
    collaboratorUserId: number,
    role: "viewer" | "editor",
  ) {
    const response = await apiFetch(
      `${API_URL}/projects/${uid}/collaborators/${collaboratorUserId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role }),
      },
    );
    return handleResponse(response);
  },

  async acceptInvitation(inviteToken: string) {
    const response = await apiFetch(
      `${API_URL}/projects/invitations/${inviteToken}/accept`,
      {
        method: "POST",
      },
    );
    return handleResponse(response);
  },

  async declineInvitation(inviteToken: string) {
    const response = await apiFetch(
      `${API_URL}/projects/invitations/${inviteToken}/decline`,
      {
        method: "POST",
      },
    );
    return handleResponse(response);
  },

  async cancelInvitation(uid: string, invitationId: number) {
    const response = await apiFetch(
      `${API_URL}/projects/${uid}/invitations/${invitationId}`,
      {
        method: "DELETE",
      },
    );
    return handleResponse(response);
  },

  // File operations: use project uid in the URL
  async getFiles(projectUid: string): Promise<ProjectFile[]> {
    const response = await apiFetch(`${API_URL}/projects/${projectUid}/files`);
    return handleResponse(response);
  },

  /** An image, PDF, or other binary file, stored as is. */
  async uploadFile(projectUid: string, file: Blob, path: string): Promise<ProjectFile> {
    const form = new FormData();
    form.append("path", path);
    form.append("file", file, path.split("/").pop() || "file");
    const response = await apiFetch(`${API_URL}/projects/${projectUid}/files/upload`, {
      method: "POST",
      body: form,
    });
    return handleResponse(response);
  },

  /** Where a binary file's bytes can be fetched or shown from. */
  rawFileUrl(projectUid: string, fileId: number | string): string {
    return `${API_URL}/projects/${encodeURIComponent(projectUid)}/files/${fileId}/raw`;
  },

  async createFile(
    projectUid: string,
    data: {
      path: string;
      content?: string;
      isMain?: boolean;
      isFolder?: boolean;
    },
  ): Promise<ProjectFile> {
    const response = await apiFetch(`${API_URL}/projects/${projectUid}/files`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return handleResponse(response);
  },

  async updateFile(
    projectUid: string,
    fileId: number,
    data: { path?: string; content?: string; expectedVersion?: number },
  ): Promise<ProjectFile> {
    const response = await apiFetch(
      `${API_URL}/projects/${projectUid}/files/${fileId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      },
    );
    return handleResponse(response);
  },

  async deleteFile(projectUid: string, fileId: number) {
    const response = await apiFetch(
      `${API_URL}/projects/${projectUid}/files/${fileId}`,
      {
        method: "DELETE",
      },
    );
    return handleResponse(response);
  },

  // Project settings
  async getProjectSettings(
    uid: string,
  ): Promise<ProjectSettings> {
    const response = await apiFetch(`${API_URL}/projects/${uid}/settings`);
    return handleResponse(response);
  },

  async updateProjectSettings(
    uid: string,
    data: Partial<ProjectSettings>,
  ): Promise<ProjectSettings> {
    const response = await apiFetch(`${API_URL}/projects/${uid}/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return handleResponse(response);
  },

  // Compilation
  async compile(
    uid: string,
    options?: {
      engine?: string;
      compileMode?: string;
      stopOnFirstError?: boolean;
      mainFile?: string;
    },
  ): Promise<CompileResult> {
    const response = await apiFetch(`${API_URL}/projects/${uid}/compile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options || {}),
    });
    return handleResponse(response);
  },

  // AI Chat: returns message and file edits
  async chat(
    uid: string,
    data: {
      message: string;
      files: Array<{ path: string; content: string }>;
      activeFilePath?: string;
      /** Earlier turns of this conversation, oldest first. */
      history?: AiChatTurn[];
      context?: { compileErrors?: string; selection?: string };
    },
  ): Promise<AiChatResponse> {
    const response = await apiFetch(`${API_URL}/projects/${uid}/ai/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return handleResponse(response);
  },

  // ---- File History ----

  async getFileHistory(
    projectUid: string,
    filePath: string,
  ): Promise<FileHistoryEntry[]> {
    const response = await apiFetch(`${API_URL}/projects/${projectUid}/history`, {
      headers: {
        "x-file-path": filePath,
      },
    });
    return handleResponse(response);
  },

  /** The project's history across all its files, newest first, a page at a time, optionally narrowed to some files and some people. */
  async getHistory(
    projectUid: string,
    options: { paths?: string[]; authors?: number[]; cursor?: number | null; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<HistoryPage> {
    const query = new URLSearchParams();
    for (const p of options.paths ?? []) query.append("path", p);
    for (const a of options.authors ?? []) query.append("author", String(a));
    if (options.cursor) query.set("cursor", String(options.cursor));
    query.set("limit", String(options.limit ?? 50));
    const response = await apiFetch(`${API_URL}/projects/${projectUid}/history?${query}`, { signal });
    return handleResponse(response);
  },

  /** Everyone with history in the project (including people who have left), and every path with history (deleted and renamed files marked). */
  async getHistoryFacets(projectUid: string, signal?: AbortSignal): Promise<HistoryFacets> {
    const response = await apiFetch(`${API_URL}/projects/${projectUid}/history/facets`, { signal });
    return handleResponse(response);
  },

  /** A version and the texts to compare it by: against the version before it, or against the file as it is now. */
  async compareHistory(projectUid: string, historyId: number, against: "previous" | "current", signal?: AbortSignal): Promise<HistoryComparison> {
    const response = await apiFetch(`${API_URL}/projects/${projectUid}/history/${historyId}/compare?against=${against}`, { signal });
    return handleResponse(response);
  },

  /** Restore a version on the server: through the live document, so everyone with the file open sees it, and in the stored file (made again if it was deleted). */
  async applyHistoryRestore(
    projectUid: string,
    historyId: number,
  ): Promise<{ content: string; filePath: string; version: number; fileId: number | null; fileVersion: number | null; created: boolean; live: boolean }> {
    const response = await apiFetch(`${API_URL}/projects/${projectUid}/history/${historyId}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply: true }),
    });
    return handleResponse(response);
  },

  async createHistorySnapshot(
    projectUid: string,
    filePath: string,
    content: string,
    label?: string,
  ): Promise<{ id: number; version: number; skipped?: boolean; reason?: string }> {
    const response = await apiFetch(`${API_URL}/projects/${projectUid}/history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filePath, content, label }),
    });
    return handleResponse(response);
  },

  async restoreHistorySnapshot(
    projectUid: string,
    historyId: number,
  ): Promise<{ content: string; filePath: string; version: number }> {
    const response = await apiFetch(
      `${API_URL}/projects/${projectUid}/history/${historyId}/restore`,
      {
        method: "POST",
      },
    );
    return handleResponse(response);
  },

  async labelHistorySnapshot(
    projectUid: string,
    historyId: number,
    label: string,
  ): Promise<{ id: number; version: number; label: string }> {
    const response = await apiFetch(
      `${API_URL}/projects/${projectUid}/history/${historyId}/label`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ label }),
      },
    );
    return handleResponse(response);
  },
};

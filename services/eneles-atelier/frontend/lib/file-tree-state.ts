const STORAGE_PREFIX = "texer:fileTree:";

export interface FileTreeState {
  expandedFolderIds: string[];
  activeFileId: string | null;
}

export function loadFileTreeState(projectId: string): FileTreeState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FileTreeState;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      expandedFolderIds: Array.isArray(parsed.expandedFolderIds) ? parsed.expandedFolderIds : [],
      activeFileId: typeof parsed.activeFileId === "string" ? parsed.activeFileId : null,
    };
  } catch {
    return null;
  }
}

export function saveFileTreeState(projectId: string, state: FileTreeState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(state));
  } catch {
    // ignore quota errors etc.
  }
}

import type { RemoteUser } from "@/hooks/useCollaboration";

export interface ProjectFileItem {
  id: string;
  path: string;
  isMain?: boolean;
  type: "tex" | "bib" | "sty" | "image" | "other" | "folder";
  /** An image or other binary file: shown, not edited. */
  binary?: boolean;
}

export interface TreeNode {
  file: ProjectFileItem;
  children: TreeNode[];
}

export interface FileTreeProps {
  files: ProjectFileItem[];
  activeFileId: string | null;
  /** The path the compiler starts from. Without it the file's own flag decides. */
  mainPath?: string;
  onFileSelect: (fileId: string) => void;
  onFileCreate: (name: string) => void;
  onFolderCreate?: (name: string) => void;
  onFileRename: (fileId: string, newName: string) => void;
  onFileDelete: (fileId: string) => void;
  onFileMove?: (fileId: string, targetFolderId: string | null) => void;
  /** Make a .tex file the document the compiler starts from. */
  onSetMain?: (fileId: string) => void;
  /** Open the History panel filtered to this file. */
  onShowHistory?: (path: string) => void;
  onImageUpload: (file: File) => void;
  remoteUsers?: RemoteUser[];
  initialExpandedFolderIds?: string[];
  onExpandedFoldersChange?: (ids: string[]) => void;
}

/** What every row of the tree needs from the tree, so a row takes three props and not thirty. */
export interface TreeState {
  activeFileId: string | null;
  mainId: string | null;
  expanded: Set<string>;
  selected: Set<string>;
  /** The row the keyboard is on. */
  cursorId: string | null;
  renamingId: string | null;
  creating: { folderId: string | null; type: "file" | "folder" } | null;
  remoteUsers?: RemoteUser[];
  canSetMain: boolean;
  click: (file: ProjectFileItem, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  open: (file: ProjectFileItem) => void;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
  startRename: (id: string) => void;
  rename: (id: string, name: string) => void;
  cancelRename: () => void;
  startCreating: (type: "file" | "folder", folderId: string | null) => void;
  create: (name: string) => void;
  cancelCreating: () => void;
  requestDelete: (ids: string[]) => void;
  setMain: (id: string) => void;
  /** Open the History panel filtered to a file; absent when there is no History panel to open. */
  showHistory?: (path: string) => void;
  move: (ids: string[], folderId: string | null) => void;
  /** The folder rows are being dragged over (the innermost one under the pointer); null over the root or when nothing is dragged. */
  dropTargetId: string | null;
  setDropTarget: (id: string | null) => void;
  expand: (id: string) => void;
}

import { ReactNode } from "react";

export interface ResourceItem {
  id: string;
  title?: string;
  tags?: string[];
  status?: "pending" | "processing" | "completed" | "error";
  createdAt: string;
  /** Last change; listings show this when present. */
  updatedAt?: string;
  [key: string]: any; // Allow additional fields
}

export type ResourcePreview = "icon" | "thumb" | "page";

export interface ResourceListProps<T extends ResourceItem> {
  // Data
  items: T[];
  isLoading: boolean;
  isUploading: boolean;

  // Configuration
  title: string;
  /** The plural noun for the items as it reads inside a sentence, used exactly as written ("PDFs", "snips", "projects"): "No PDFs yet", "Search PDFs". Never derived from the title, so a name with capitals keeps them. */
  itemNoun: string;
  /** The shape of each row's preview, so the loading rows draw the same box: an icon tile (40px), a square thumbnail (128px), or a page (96 by 128). */
  preview: ResourcePreview;
  description: string;
  acceptFileType: string;
  fileTypeLabel: string;

  // Callbacks
  onUpload: (file: File) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onArchive?: (ids: string[]) => Promise<void>;
  onLabel?: (ids: string[], tag: string, color?: string) => Promise<void>;
  onRename?: (id: string, newTitle: string) => Promise<void>;
  onClone?: (id: string) => Promise<void>;
  onExport?: (id: string) => Promise<void>;
  onItemClick?: (item: T) => void;
  getPreviewUrl?: (item: T) => string | null;
  formatFileSize?: (item: T) => string | null;
  getMetadata?: (
    item: T,
  ) => { pages?: number; size?: string; [key: string]: any } | null;
  tagColors?: Record<string, string>;

  // Render functions
  renderItemPreview: (item: T, previewUrl: string | null) => ReactNode;
  renderItemMetadata: (item: T, metadata: any) => ReactNode;
  /** The people on an item (a project's collaborators), drawn in a column of their own between the labels and the time. A list whose items have no people leaves it out and has no such column. */
  renderItemPeople?: (item: T) => ReactNode;
  getStatusBadge: (status: string) => ReactNode;

  // Optional: Custom header actions
  renderHeaderActions?: () => ReactNode;
  /** Drawn at the start of the toolbar, before the search (a switch between two sources of items). */
  renderToolbarStart?: () => ReactNode;
  /** More actions for an item, after the list's own and before Archive and Delete (the desktop app downloads a cloud project into a folder). */
  itemActions?: (item: T) => { label: string; icon: ReactNode; onSelect: () => void }[];
  /** When set, items are only taken off the list, never deleted (folders on a computer, which stay where they are): the last action of an item, and the bulk action, read this label and run at once, without the confirmation. */
  removeLabel?: string;
  /** Replaces the empty list's title, text, and action (a list that needs an account, before signing in). Search results that match nothing keep their own. */
  empty?: { title: string; text: ReactNode; action?: ReactNode };
}

/**
 * Props passed down to the ResourceListItem component.
 * These are the callbacks/state the item needs from its parent list.
 */
export interface ResourceItemCallbacks<T extends ResourceItem> {
  selectMode: boolean;
  selectedIds: Set<string>;
  showArchived: boolean;
  renamingId: string | null;
  renameValue: string;
  onToggleSelect: (id: string) => void;
  onItemClick: (item: T, e?: React.MouseEvent) => void;
  onItemDelete: (id: string, e: React.MouseEvent) => void;
  onSelectMode: () => void;
  onStartRename: (item: T) => void;
  onSubmitRename: (id: string) => void;
  onRenameValueChange: (value: string) => void;
  onCancelRename: () => void;
  onArchive?: (ids: string[]) => void;
  onLabel?: (ids: string[]) => void;
  onClone?: (id: string) => void;
  onExport?: (id: string) => void;
  onRenameAvailable: boolean;
  itemActions?: (item: T) => { label: string; icon: ReactNode; onSelect: () => void }[];
  /** The list's removeLabel: the last action takes the item off the list instead of deleting it. */
  removeLabel?: string;
  onLabelAvailable: boolean;
  renderItemPreview: (item: T, previewUrl: string | null) => ReactNode;
  renderItemMetadata: (item: T, metadata: any) => ReactNode;
  /** The people on an item (a project's collaborators), drawn in a column of their own between the labels and the time. A list whose items have no people leaves it out and has no such column. */
  renderItemPeople?: (item: T) => ReactNode;
  getStatusBadge: (status: string) => ReactNode;
}

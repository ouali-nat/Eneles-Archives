"use client";

import { ReactNode } from "react";
import { Trash2, Archive, Tag, CheckSquare, Pencil, Copy, Download, X } from "@/components/icons";
import { ResourceItem } from "./types";

export interface ActionItem {
  label: string;
  icon: ReactNode;
  onClick: (e: React.MouseEvent) => void;
  variant?: "destructive";
  separator?: "before" | "after";
  sub?: {
    trigger: { label: string; icon: ReactNode };
    items: ActionItem[];
  };
}

export function buildResourceActions<T extends ResourceItem>({
  item,
  showArchived,
  onSelectMode,
  onStartRename,
  onArchive,
  onLabel,
  onDelete,
  onClone,
  onExport,
  hasRename,
  hasArchive,
  hasLabel,
  removeLabel,
  more = [],
}: {
  item: T;
  showArchived: boolean;
  onSelectMode: () => void;
  onStartRename: (item: T) => void;
  onArchive?: (ids: string[]) => void;
  onLabel?: (ids: string[]) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onClone?: (id: string) => void;
  onExport?: (id: string) => void;
  hasRename: boolean;
  hasArchive: boolean;
  hasLabel: boolean;
  /** Takes the item off the list instead of deleting it, under this label. */
  removeLabel?: string;
  /** The list's own further actions, after Download ZIP. */
  more?: { label: string; icon: ReactNode; onSelect: () => void }[];
}): ActionItem[] {
  const actions: ActionItem[] = [];

  // Select
  actions.push({
    label: "Select",
    icon: <CheckSquare className="me-2 h-4 w-4" />,
    onClick: (e) => {
      e.stopPropagation();
      onSelectMode();
    },
    separator: "after",
  });

  // Rename
  if (hasRename) {
    actions.push({
      label: "Rename",
      icon: <Pencil className="me-2 h-4 w-4" />,
      onClick: (e) => {
        e.stopPropagation();
        onStartRename(item);
      },
    });
  }

  // Label
  if (hasLabel && onLabel) {
    actions.push({
      label: "Label",
      icon: <Tag className="me-2 h-4 w-4" />,
      onClick: (e) => {
        e.stopPropagation();
        onLabel([item.id]);
      },
    });
  }

  // Clone
  if (onClone) {
    actions.push({
      label: "Clone",
      icon: <Copy className="me-2 h-4 w-4" />,
      onClick: (e) => {
        e.stopPropagation();
        onClone(item.id);
      },
    });
  }

  // Export / Download ZIP
  if (onExport) {
    actions.push({
      label: "Download ZIP",
      icon: <Download className="me-2 h-4 w-4" />,
      onClick: (e) => {
        e.stopPropagation();
        onExport(item.id);
      },
    });
  }

  for (const action of more) {
    actions.push({
      label: action.label,
      icon: action.icon,
      onClick: (e) => {
        e.stopPropagation();
        action.onSelect();
      },
    });
  }

  // Archive, right before delete
  if (hasArchive && onArchive) {
    actions.push({
      label: showArchived ? "Unarchive" : "Archive",
      icon: <Archive className="me-2 h-4 w-4" />,
      onClick: (e) => {
        e.stopPropagation();
        onArchive([item.id]);
      },
      separator: "before",
    });
  }

  // Delete, always last, red icon; or, for a list whose items are only taken off it, that action, plainly.
  actions.push(
    removeLabel
      ? { label: removeLabel, icon: <X className="me-2 h-4 w-4" />, onClick: (e) => onDelete(item.id, e), ...(hasArchive ? {} : { separator: "before" as const }) }
      : {
          label: "Delete",
          icon: <Trash2 className="me-2 h-4 w-4 text-danger" />,
          onClick: (e) => onDelete(item.id, e),
          variant: "destructive",
          ...(hasArchive ? {} : { separator: "before" as const }),
        },
  );
  return actions;
}

"use client";

import { useState } from "react";
import { ChevronRight, FilePlus, FolderPlus, History, Pencil, Trash2, CheckSquare, Star, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { FileTypeIcon } from "@/components/editor/FileTypeIcon";
import { NameInput } from "@/components/editor/file-tree/CreationInput";
import type { TreeNode, TreeState } from "@/components/editor/file-tree/FileTreeTypes";

const INSET = 8;
const INDENT = 16;

/** A folder's rows fold away under it. */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div role="group" className="grid transition-[grid-template-rows] duration-200 ease-out motion-still:transition-none" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

/** The row a new file or folder is named in, drawn where it will land, with the icon of the name being typed. */
export function CreationRow({ depth, tree }: { depth: number; tree: TreeState }) {
  const isFolder = tree.creating?.type === "folder";
  const [name, setName] = useState(isFolder ? "" : ".tex");
  return (
    <div className="mx-1 my-px flex min-h-8 items-center gap-1.5 pe-1" style={{ paddingInlineStart: INSET + depth * INDENT }}>
      <span className="size-4 shrink-0" />
      <FileTypeIcon filename={name || (isFolder ? "" : ".tex")} isFolder={isFolder} className="size-4 shrink-0" />
      <NameInput initial={isFolder ? "" : ".tex"} isFolder={isFolder} label={isFolder ? "New folder name" : "New file name"} placeholder={isFolder ? "Folder name" : "name.tex"} onSubmit={tree.create} onCancel={tree.cancelCreating} onValueChange={setName} />
    </div>
  );
}

/** One row of the file tree, and under a folder, its rows. */
export function TreeItem({ node, depth, parentFolderId, tree }: { node: TreeNode; depth: number; parentFolderId: string | null; tree: TreeState }) {
  const { file } = node;
  const isFolder = file.type === "folder";
  const isExpanded = tree.expanded.has(file.id);
  const isSelected = tree.selected.has(file.id);
  const isActive = !isFolder && file.id === tree.activeFileId;
  const isMain = file.id === tree.mainId;
  const isRenaming = tree.renamingId === file.id;
  const name = file.path.split("/").pop() || file.path;
  // New files made from this row's menu go into the folder itself, or beside a file.
  const folderForNew = isFolder ? file.id : parentFolderId;
  // The menu acts on the whole selection when this row is part of one, and on this row alone otherwise.
  const many = isSelected && tree.selected.size > 1;
  const targets = many ? [...tree.selected] : [file.id];
  const here = !isFolder && tree.remoteUsers ? tree.remoteUsers.filter((u) => u.activeFile === file.path) : [];
  const isTex = /\.(tex|ltx)$/i.test(file.path) && !file.binary;

  const row = (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="treeitem"
            aria-selected={isSelected || isActive}
            aria-expanded={isFolder ? isExpanded : undefined}
            aria-current={isActive ? "true" : undefined}
            data-row-id={file.id}
            data-selected={isSelected || undefined}
            data-active={isActive || undefined}
            data-cursor={tree.cursorId === file.id || undefined}
            className={cn(
              // Rows sit 2px apart so neighboring highlights never touch. Hover and the open file are two steps of the same ink, so they read apart in both themes (surface-hover at 60% over the panel matched surface in dark).
              "group/row relative mx-1 my-px flex min-h-8 cursor-default select-none items-center gap-1.5 rounded-[var(--radius-item)] pe-2 type-base text-muted-foreground transition-colors hover:text-foreground not-data-active:not-data-selected:hover:bg-[color-mix(in_oklch,var(--foreground)_5%,transparent)]",
              "data-active:bg-[color-mix(in_oklch,var(--foreground)_10%,transparent)] data-active:font-medium data-active:text-foreground",
              "data-selected:bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] data-selected:text-foreground",
              "[[data-file-tree]:focus-visible_&]:data-cursor:ring-1 [[data-file-tree]:focus-visible_&]:data-cursor:ring-inset [[data-file-tree]:focus-visible_&]:data-cursor:ring-focus",
            )}
            style={{ paddingInlineStart: INSET + depth * INDENT }}
            onClick={(e) => !isRenaming && tree.click(file, e)}
            onDoubleClick={() => !isRenaming && !isFolder && tree.open(file)}
            draggable={!isRenaming}
            onDragEnd={() => tree.setDropTarget(null)}
            onDragStart={(e) => {
              if (many) e.dataTransfer.setData("fileIds", JSON.stringify(targets));
              else {
                e.dataTransfer.setData("fileId", file.id);
                // Browsers lowercase custom keys, so this one is written lowercase.
                if (file.type === "image") e.dataTransfer.setData("treeimagepath", file.path);
              }
              e.stopPropagation();
            }}
          >
            {isActive && <span aria-hidden className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-accent" />}
            {isFolder ? <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-still:transition-none", isExpanded && "rotate-90")} /> : <span className="size-4 shrink-0" />}
            <FileTypeIcon filename={file.path} isFolder={isFolder} isExpanded={isExpanded} className="size-4 shrink-0" />
            {isRenaming ? (
              <NameInput initial={name} isFolder={isFolder} label={`Rename ${name}`} onSubmit={(next) => tree.rename(file.id, next)} onCancel={tree.cancelRename} />
            ) : (
              <span className="min-w-0 flex-1 truncate">{name}</span>
            )}
            {!isRenaming && here.length > 0 && (
              <span className="flex shrink-0 items-center -space-x-0.5" aria-label={`${here.map((u) => u.name).join(", ")} ${here.length === 1 ? "is" : "are"} here`}>
                {here.slice(0, 3).map((u) => (
                  <span key={u.userId} className="size-2 shrink-0 rounded-full bg-[var(--dot)] ring-1 ring-panel" style={{ "--dot": u.color } as React.CSSProperties} title={u.name} />
                ))}
              </span>
            )}
            {!isRenaming && isMain && <span className="shrink-0 rounded-[var(--radius-inset)] border border-line px-1.5 type-small font-normal text-muted-foreground">Main</span>}
          </div>
        </ContextMenuTrigger>
        {/* The menu does not take the focus back to the row when it closes: Rename and New file have just put it in a name field. */}
        <ContextMenuContent className="min-w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
          {many ? (
            <>
              <ContextMenuItem onSelect={() => tree.clearSelection()}>
                <X /> Clear the selection
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => tree.requestDelete(targets)}>
                <Trash2 /> Delete {targets.length} items
                <ContextMenuShortcut>Del</ContextMenuShortcut>
              </ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem onSelect={() => tree.startCreating("file", folderForNew)}>
                <FilePlus /> New file
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => tree.startCreating("folder", folderForNew)}>
                <FolderPlus /> New folder
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => tree.startRename(file.id)}>
                <Pencil /> Rename
                <ContextMenuShortcut>F2</ContextMenuShortcut>
              </ContextMenuItem>
              {isTex && tree.canSetMain && (
                <ContextMenuItem disabled={isMain} onSelect={() => tree.setMain(file.id)}>
                  <Star /> {isMain ? "This is the main document" : "Set as main document"}
                </ContextMenuItem>
              )}
              {!isFolder && !file.binary && tree.showHistory && (
                <ContextMenuItem onSelect={() => tree.showHistory?.(file.path)}>
                  <History /> Show history
                </ContextMenuItem>
              )}
              <ContextMenuItem onSelect={() => tree.toggleSelected(file.id)}>
                <CheckSquare /> {isSelected ? "Deselect" : "Select"}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" disabled={isMain} onSelect={() => tree.requestDelete([file.id])}>
                <Trash2 /> Delete
                {isMain ? <span className="ms-auto ps-4 type-small text-muted-foreground">Main document</span> : <ContextMenuShortcut>Del</ContextMenuShortcut>}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
  );

  if (!isFolder) return row;

  // A folder is its row and everything under it: a drop anywhere in that area (on the row, on a file inside, in the gaps) moves into the folder. The innermost folder under the pointer takes the drop, so a folder inside an open folder is still a target of its own.
  return (
    <div
      data-dropping={tree.dropTargetId === file.id || undefined}
      className="rounded-[var(--radius-item)] transition-colors data-dropping:bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] data-dropping:shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--accent)_45%,transparent)]"
      onDragOver={(e) => {
        // Rows being moved, not files from the computer (those upload, and the whole tree takes them).
        if (e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (tree.dropTargetId !== file.id) tree.setDropTarget(file.id);
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        tree.setDropTarget(null);
        let ids: string[] = [];
        try {
          const several = e.dataTransfer.getData("fileIds");
          ids = several ? JSON.parse(several) : [e.dataTransfer.getData("fileId")];
        } catch {
          ids = [];
        }
        ids = ids.filter((id) => id && id !== file.id);
        if (!ids.length) return;
        tree.move(ids, file.id);
        // A closed folder opens to show what it was given.
        if (!isExpanded) tree.expand(file.id);
      }}
    >
      {row}
      <Collapse open={isExpanded}>
        {tree.creating?.folderId === file.id && <CreationRow key={tree.creating.type} depth={depth + 1} tree={tree} />}
        {node.children.map((child) => (
          <TreeItem key={child.file.id} node={child} depth={depth + 1} parentFolderId={file.id} tree={tree} />
        ))}
      </Collapse>
    </div>
  );
}

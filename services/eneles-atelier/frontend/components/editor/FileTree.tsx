"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FilePlus, FolderPlus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { LongScroll } from "@/components/essential/layout/LongScroll";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { CreationRow, TreeItem } from "@/components/editor/file-tree/TreeItem";
import { buildTree } from "@/components/editor/file-tree/FileTreeLogic";
import type { FileTreeProps, ProjectFileItem, TreeNode, TreeState } from "@/components/editor/file-tree/FileTreeTypes";
import { PanelBar } from "@/components/editor/SidebarSection";
import { formatCount } from "@/lib/utils";

export type { ProjectFileItem };

const nameOf = (path: string) => path.split("/").pop() || path;
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/**
 * The project's files. A click opens a file (or opens and closes a folder) and selects it; Ctrl or Cmd-click adds a row to the selection and Shift-click selects a run of them; the arrow keys move through the rows, Enter opens, F2 renames, Delete deletes what is selected (after a confirmation), and Escape clears the selection. Rows are dragged into folders, and files dropped from the computer are uploaded. The row menu adds New file, New folder, Rename, Set as main document, Select, and Delete.
 */
/** Memoised: it is drawn by the editor screen, which re-renders on every keystroke, and only needs drawing again when its own props change. */
export const FileTree = memo(function FileTree({ files, activeFileId, mainPath, onFileSelect, onFileCreate, onFolderCreate, onFileRename, onFileDelete, onFileMove, onSetMain, onShowHistory, onImageUpload, remoteUsers, initialExpandedFolderIds = [], onExpandedFoldersChange }: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpandedFolderIds));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [creating, setCreating] = useState<TreeState["creating"]>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string[] | null>(null);
  const [uploadOver, setUploadOver] = useState(false);
  const [dropTargetId, setDropTarget] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => buildTree(files), [files]);
  const fileCount = useMemo(() => files.filter((f) => f.type !== "folder").length, [files]);
  const byId = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);
  const mainId = useMemo(() => (mainPath ? files.find((f) => f.path === mainPath)?.id : undefined) ?? files.find((f) => f.isMain)?.id ?? null, [files, mainPath]);

  // The rows as they are on screen, top to bottom: what Shift-click and the arrow keys walk.
  const visible = useMemo(() => {
    const ids: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        ids.push(node.file.id);
        if (node.file.type === "folder" && expanded.has(node.file.id)) walk(node.children);
      }
    };
    walk(tree);
    return ids;
  }, [tree, expanded]);

  useEffect(() => {
    onExpandedFoldersChange?.([...expanded]);
  }, [expanded, onExpandedFoldersChange]);

  // A file that is gone (deleted here or by someone else) leaves the selection with it.
  const live = useMemo(() => new Set([...selected].filter((id) => byId.has(id))), [selected, byId]);

  const toggleFolder = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectRange = useCallback(
    (to: string) => {
      const from = anchor.current && visible.includes(anchor.current) ? anchor.current : (activeFileId ?? to);
      const a = visible.indexOf(from);
      const b = visible.indexOf(to);
      if (a < 0 || b < 0) setSelected(new Set([to]));
      else setSelected(new Set(visible.slice(Math.min(a, b), Math.max(a, b) + 1)));
    },
    [visible, activeFileId],
  );

  const open = useCallback(
    (file: ProjectFileItem) => {
      if (file.type === "folder") toggleFolder(file.id);
      else onFileSelect(file.id);
    },
    [onFileSelect, toggleFolder],
  );

  const click: TreeState["click"] = useCallback(
    (file, event) => {
      setCursorId(file.id);
      if (event.ctrlKey || event.metaKey) {
        anchor.current = file.id;
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(file.id)) next.delete(file.id);
          else next.add(file.id);
          return next;
        });
      } else if (event.shiftKey) selectRange(file.id);
      else {
        anchor.current = file.id;
        setSelected(new Set([file.id]));
        open(file);
      }
    },
    [open, selectRange],
  );

  const startCreating = useCallback(
    (type: "file" | "folder", folderId?: string | null) => {
      // From the bar's buttons, the new row goes into the folder that is selected, or beside the file that is.
      let target = folderId;
      if (target === undefined) {
        const only = live.size === 1 ? byId.get([...live][0]) : undefined;
        target = only?.type === "folder" ? only.id : only ? (files.find((f) => f.type === "folder" && f.path === folderOf(only.path))?.id ?? null) : null;
      }
      setRenamingId(null);
      setCreating({ folderId: target, type });
      if (target) setExpanded((prev) => new Set(prev).add(target));
    },
    [live, byId, files],
  );

  const clash = useCallback((path: string, except?: string) => files.some((f) => f.id !== except && f.path.toLowerCase() === path.toLowerCase()), [files]);

  const create = useCallback(
    (typed: string) => {
      if (!creating) return;
      let name = typed.trim();
      setCreating(null);
      if (/[\\/]/.test(name)) return void toast.error("A name cannot contain a slash.");
      if (creating.type === "file" && !name.includes(".")) name += ".tex";
      const parent = creating.folderId ? (byId.get(creating.folderId)?.path ?? "") : "";
      const path = parent ? `${parent}/${name}` : name;
      if (clash(path)) return void toast.error(`There is already a ${creating.type} named ${name} here.`);
      if (creating.type === "folder") onFolderCreate?.(path);
      else onFileCreate(path);
    },
    [creating, byId, clash, onFileCreate, onFolderCreate],
  );

  const rename = useCallback(
    (id: string, typed: string) => {
      setRenamingId(null);
      root.current?.focus({ preventScroll: true });
      const file = byId.get(id);
      const name = typed.trim();
      if (!file || !name || name === nameOf(file.path)) return;
      if (/[\\/]/.test(name)) return void toast.error("A name cannot contain a slash.");
      const folder = folderOf(file.path);
      if (clash(folder ? `${folder}/${name}` : name, id)) return void toast.error(`There is already something named ${name} here.`);
      onFileRename(id, name);
    },
    [byId, clash, onFileRename],
  );

  const requestDelete = useCallback(
    (ids: string[]) => {
      const deletable = ids.filter((id) => byId.has(id) && id !== mainId);
      if (!deletable.length) {
        if (ids.includes(mainId ?? "")) toast.error("The main document cannot be deleted. Set another file as the main document first.");
        return;
      }
      setToDelete(deletable);
    },
    [byId, mainId],
  );

  const move = useCallback(
    (ids: string[], folderId: string | null) => {
      const target = folderId ? byId.get(folderId)?.path : "";
      for (const id of ids) {
        const file = byId.get(id);
        if (!file || folderOf(file.path) === target) continue;
        // A folder cannot go into itself or into a folder inside it.
        if (file.type === "folder" && target !== undefined && (target === file.path || target.startsWith(file.path + "/"))) continue;
        onFileMove?.(id, folderId);
      }
    },
    [byId, onFileMove],
  );

  const state: TreeState = {
    activeFileId,
    mainId,
    expanded,
    selected: live,
    cursorId,
    renamingId,
    creating,
    remoteUsers,
    canSetMain: !!onSetMain,
    click,
    open,
    toggleSelected: (id) => {
      anchor.current = id;
      setCursorId(id);
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    clearSelection: () => setSelected(new Set()),
    startRename: (id) => {
      setCreating(null);
      setRenamingId(id);
    },
    rename,
    cancelRename: () => {
      setRenamingId(null);
      root.current?.focus({ preventScroll: true });
    },
    startCreating,
    create,
    cancelCreating: () => setCreating(null),
    requestDelete,
    setMain: (id) => onSetMain?.(id),
    showHistory: onShowHistory,
    move,
    dropTargetId,
    setDropTarget,
    expand: (id) => setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id))),
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keys typed into a name field are that field's.
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable='true']")) return;
    const at = cursorId && visible.includes(cursorId) ? cursorId : (activeFileId && visible.includes(activeFileId) ? activeFileId : null);
    const file = at ? byId.get(at) : undefined;
    const go = (id: string | undefined, extend: boolean) => {
      if (!id) return;
      setCursorId(id);
      if (extend) selectRange(id);
      else {
        anchor.current = id;
        setSelected(new Set([id]));
      }
      root.current?.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    };
    const index = at ? visible.indexOf(at) : -1;
    if (e.key === "ArrowDown") go(visible[Math.min(index + 1, visible.length - 1)], e.shiftKey);
    else if (e.key === "ArrowUp") go(visible[Math.max(index - 1, 0)], e.shiftKey);
    else if (e.key === "Home") go(visible[0], e.shiftKey);
    else if (e.key === "End") go(visible[visible.length - 1], e.shiftKey);
    else if (e.key === "ArrowRight" && file?.type === "folder" && !expanded.has(file.id)) toggleFolder(file.id);
    else if (e.key === "ArrowLeft" && file?.type === "folder" && expanded.has(file.id)) toggleFolder(file.id);
    else if (e.key === "Enter" && file) open(file);
    else if (e.key === "F2" && file) state.startRename(file.id);
    else if ((e.key === "Delete" || e.key === "Backspace") && (live.size || file)) requestDelete(live.size ? [...live] : [file!.id]);
    else if (e.key === "Escape" && live.size) setSelected(new Set());
    else if (e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) setSelected(new Set(visible));
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const deleting = (toDelete ?? []).map((id) => byId.get(id)).filter((f): f is ProjectFileItem => !!f);
  const deletingFolder = deleting.some((f) => f.type === "folder");

  return (
    <>
      <div
        ref={root}
        data-file-tree
        role="tree"
        aria-label="Project files"
        aria-multiselectable="true"
        tabIndex={0}
        // The tree takes the focus when it is clicked, so its keys act here and nowhere else. Opening a file then hands the focus to the editor.
        onMouseDownCapture={(e) => {
          if (!(e.target as HTMLElement).closest("input, textarea, button, a, [contenteditable='true']")) e.currentTarget.focus({ preventScroll: true });
        }}
        onKeyDown={onKeyDown}
        className="relative flex h-full flex-col bg-panel outline-none"
        onDragOver={(e) => {
          // The overlay is for files from the computer, not for rows being moved.
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setUploadOver(true);
            return;
          }
          // Rows over the tree but over no folder: the drop goes to the top level. (A folder under the pointer takes the event before it gets here.)
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dropTargetId !== null) setDropTarget(null);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setUploadOver(false);
            setDropTarget(null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setUploadOver(false);
          setDropTarget(null);
          const several = e.dataTransfer.getData("fileIds");
          const one = e.dataTransfer.getData("fileId");
          if (several || one) {
            try {
              move(several ? JSON.parse(several) : [one], null);
            } catch {
              /* Not a list of rows: nothing to move. */
            }
            return;
          }
          for (const file of Array.from(e.dataTransfer.files)) onImageUpload(file);
        }}
      >
        {uploadOver && (
          <div className="pointer-events-none absolute inset-1 z-10 flex flex-col items-center justify-center gap-1 rounded-[var(--radius-card)] border border-dashed border-accent bg-[color-mix(in_oklch,var(--accent)_10%,var(--panel))]">
            <p className="type-base font-medium text-foreground">Drop to upload</p>
            <p className="type-small text-muted-foreground">Any kind of file</p>
          </div>
        )}
        <PanelBar
          actions={
            <>
              <Button variant="ghost" size="icon-sm" onClick={() => startCreating("file")} title="New file" aria-label="New file">
                <FilePlus />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => startCreating("folder")} title="New folder" aria-label="New folder">
                <FolderPlus />
              </Button>
            </>
          }
        >
          <span className="truncate">{live.size > 1 ? `${live.size} selected` : formatCount(fileCount, "file", "files")}</span>
        </PanelBar>

        <ContextMenu>
          <ContextMenuTrigger className="block min-h-0 flex-1">
            <LongScroll fill className="h-full" scrollClassName="py-1">
              {/* A click below the last row lets go of the selection. */}
              <div
                className="min-h-full"
                onClick={(e) => {
                  if (e.target === e.currentTarget) setSelected(new Set());
                }}
              >
                {creating && creating.folderId === null && <CreationRow key={creating.type} depth={0} tree={state} />}
                {tree.map((node) => (
                  <TreeItem key={node.file.id} node={node} depth={0} parentFolderId={null} tree={state} />
                ))}
              </div>
            </LongScroll>
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
            <ContextMenuItem onSelect={() => startCreating("file", null)}>
              <FilePlus /> New file
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => startCreating("folder", null)}>
              <FolderPlus /> New folder
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleting.length === 1 ? `Delete ${nameOf(deleting[0].path)}?` : `Delete ${deleting.length} items?`}</AlertDialogTitle>
            <AlertDialogDescription>{deletingFolder ? "A folder is deleted with everything in it. This cannot be undone." : "This cannot be undone."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                (toDelete ?? []).forEach(onFileDelete);
                setSelected(new Set());
                setToDelete(null);
              }}
              className="bg-danger text-on-danger hover:bg-danger/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

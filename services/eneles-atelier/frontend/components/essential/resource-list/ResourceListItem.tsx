"use client";

import { useState, useRef, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { ContextMenuTrigger } from "@radix-ui/react-context-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MoreVertical } from "@/components/icons";
import { ResourceItem, ResourceItemCallbacks } from "./types";
import { ActionItem, buildResourceActions } from "./ResourceItemActions";
import { RelativeTime } from "@/components/ui/time";

interface ResourceListItemProps<T extends ResourceItem> {
  item: T;
  previewUrl: string | null;
  metadata: any;
  callbacks: ResourceItemCallbacks<T>;
}

/**
 * Renders dropdown menu items from our action definition.
 */

function DropdownMenuItems({ actions }: { actions: ActionItem[] }) {
  return (
    <>
      {actions.map((action, i) => {
        // Separator before
        if (action.separator === "before" && i > 0) {
          return (
            <span key={`sep-b-${i}`}>
              <DropdownMenuSeparator />
              {action.sub ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {action.sub.trigger.icon}
                    {action.sub.trigger.label}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {action.sub.items.map((sub, j) => (
                      <DropdownMenuItem key={j} onClick={sub.onClick}>
                        {sub.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                <DropdownMenuItem
                  onClick={action.onClick}
                  className={
                    action.variant === "destructive" ? "text-danger" : ""
                  }
                >
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              )}
            </span>
          );
        }

        // Sub-menu
        if (action.sub) {
          return (
            <span key={`action-${i}`}>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {action.sub.trigger.icon}
                  {action.sub.trigger.label}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {action.sub.items.map((sub, j) => (
                    <DropdownMenuItem key={j} onClick={sub.onClick}>
                      {sub.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </span>
          );
        }

        // Regular item
        return (
          <DropdownMenuItem
            key={`action-${i}`}
            onClick={action.onClick}
            className={
              action.variant === "destructive" ? "text-danger" : ""
            }
          >
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

/** Renders context menu items from our action definition */
function ContextMenuItems({ actions }: { actions: ActionItem[] }) {
  return (
    <>
      {actions.map((action, i) => {
        if (action.separator === "before" && i > 0) {
          return (
            <span key={`ctx-sep-${i}`}>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={action.onClick as any}
                className={
                  action.variant === "destructive" ? "text-danger" : ""
                }
              >
                {action.icon}
                {action.label}
              </ContextMenuItem>
            </span>
          );
        }
        return (
          <ContextMenuItem
            key={`ctx-${i}`}
            onClick={action.onClick as any}
            className={
              action.variant === "destructive" ? "text-danger" : ""
            }
          >
            {action.icon}
            {action.label}
          </ContextMenuItem>
        );
      })}
    </>
  );
}

// ── Auto-sizing rename input ─────────────────────────────

function AutoSizeRenameInput({
  value,
  originalValue,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  originalValue: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (spanRef.current) setWidth(spanRef.current.offsetWidth + 8);
  }, [value]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  }, []);

  return (
    <span
      className="relative inline-flex items-center"
      onClick={(e) => e.stopPropagation()}
    >
      {/* hidden mirror to measure width */}
      <span
        ref={spanRef}
        aria-hidden
        className="absolute invisible whitespace-pre font-medium text-sm px-2 py-0.5 pointer-events-none"
      >
        {value || " "}
      </span>
      <input
        ref={inputRef}
        className="font-medium bg-background border border-line rounded px-2 py-0.5 text-sm outline-none focus:ring-1 focus:ring-accent min-w-[60px] max-w-[400px]"
        style={{ width: width ?? "auto" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => {
          if (value.trim() && value.trim() !== originalValue.trim()) onSave();
          else onCancel();
        }}
      />
    </span>
  );
}

// ── ResourceListItem ──────────────────────────────────────

export function ResourceListItem<T extends ResourceItem>({
  item,
  previewUrl,
  metadata,
  callbacks,
}: ResourceListItemProps<T>) {
  const {
    selectMode,
    selectedIds,
    showArchived,
    renamingId,
    renameValue,
    onToggleSelect,
    onItemClick,
    onItemDelete,
    onSelectMode,
    onStartRename,
    onSubmitRename,
    onRenameValueChange,
    onCancelRename,
    onArchive,
    onLabel,
    onClone,
    onExport,
    onRenameAvailable,
    onLabelAvailable,
    removeLabel,
    itemActions,
    renderItemPreview,
    renderItemMetadata,
    renderItemPeople,
    getStatusBadge,
  } = callbacks;

  const actions = buildResourceActions({
    item,
    showArchived,
    onSelectMode,
    onStartRename,
    onArchive,
    onLabel,
    onDelete: onItemDelete,
    onClone,
    onExport,
    hasRename: onRenameAvailable,
    hasArchive: !!onArchive,
    hasLabel: onLabelAvailable,
    removeLabel,
    more: itemActions?.(item),
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`group cursor-pointer transition-[border-color,background-color,box-shadow] relative border border-line/60 rounded-lg ${
            selectMode && selectedIds.has(item.id)
              ? "bg-surface/50 border-accent/40"
              : "hover:bg-surface/30 hover:border-line"
          }`}
          onClick={(e) => onItemClick(item, e)}
        >
          <div className="flex items-center gap-4 p-4">
            {/* Checkbox - only show in select mode */}
            {selectMode && (
              <div
                className="flex items-center justify-center shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  checked={selectedIds.has(item.id)}
                  onCheckedChange={() => onToggleSelect(item.id)}
                  className="h-4 w-4 rounded-sm border-muted-foreground/30 data-[state=checked]:border-accent"
                />
              </div>
            )}

            {/* Preview */}
            <div className="shrink-0 flex items-center justify-center">
              {renderItemPreview(item, previewUrl)}
            </div>

            {/* Item Info */}
            <div className="flex items-center justify-between gap-3 flex-1 min-w-0">
              {/* Title */}
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {renamingId === item.id ? (
                  <AutoSizeRenameInput
                    value={renameValue}
                    originalValue={item.title || ""}
                    onChange={onRenameValueChange}
                    onSave={() => onSubmitRename(item.id)}
                    onCancel={onCancelRename}
                  />
                ) : (
                  <h3 className="text-sm font-medium truncate text-foreground/90 leading-tight">
                    {item.title || `Item-${item.id}`}
                  </h3>
                )}
                {item.status && (
                  <div className="flex items-center shrink-0">
                    {getStatusBadge(item.status)}
                  </div>
                )}
              </div>

              {/* The row's trailing columns line up down the list: labels end at one edge, then people, then the time. The people column is as wide as the fullest stack of faces, and the time column as wide as the longest time ("11 mo. ago"), so neither moves the other from row to row. */}
              <div className="flex shrink-0 items-center justify-end gap-1.5">
                {renderItemMetadata(item, metadata)}
              </div>
              {renderItemPeople && <div className="hidden w-[5.25rem] shrink-0 items-center justify-end sm:flex">{renderItemPeople(item)}</div>}
              <RelativeTime
                value={item.updatedAt ?? item.createdAt}
                style="short"
                focusable={false}
                className="w-[5.25rem] shrink-0 text-end type-small text-muted-foreground tabular-nums"
              />

              {/* 3-dot dropdown */}
              <div
                className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      aria-label={`Actions for ${item.title || "this item"}`}
                    >
                      <MoreVertical aria-hidden className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenuItems actions={actions} />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>

      {/* Right-click context menu, opens exactly at cursor */}
      <ContextMenuContent onClick={(e) => e.stopPropagation()}>
        <ContextMenuItems actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

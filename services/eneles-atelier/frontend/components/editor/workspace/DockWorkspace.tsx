"use client";

import "dockview/dist/styles/dockview.css";
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { DockController, layoutStorageKey, type WorkspaceSnapshot } from "./controller";
import { PANELS, PANEL_IDS, type PanelId } from "./panels";

/** What EditorView, the toolbar, and the View menu hold: the current arrangement and the ways to change it. */
export interface Workspace extends WorkspaceSnapshot {
  controller: DockController;
  isOpen: (id: PanelId) => boolean;
  /** Its tab is in front, so its content is on screen. */
  isVisible: (id: PanelId) => boolean;
  show: (id: PanelId) => void;
  hide: (id: PanelId) => void;
  toggle: (id: PanelId) => void;
  applyLayout: (layoutId: string) => void;
  reset: () => void;
}

/** One dock per editor screen. The arrangement is kept per account in this browser, not per project: people set their workspace up once, and two accounts on one browser each keep their own. */
export function useDockWorkspace(accountId: number | null | undefined): Workspace {
  const key = layoutStorageKey(accountId);
  const [controller] = useState(() => new DockController(key));
  useEffect(() => controller.setStorageKey(key), [controller, key]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  return useMemo(
    () => ({
      ...snapshot,
      controller,
      isOpen: (id) => snapshot.open.includes(id),
      isVisible: (id) => snapshot.visible.includes(id),
      show: (id) => controller.show(id),
      hide: (id) => controller.hide(id),
      toggle: (id) => controller.toggle(id),
      applyLayout: (layoutId) => controller.applyLayout(layoutId),
      reset: () => controller.reset(),
    }),
    [controller, snapshot],
  );
}

interface DockWorkspaceProps {
  workspace: Workspace;
  /** What each panel shows. Built by EditorView on every render, so panels always see its current state. */
  panels: Record<PanelId, ReactNode>;
  /** A panel's name when it differs from the default (the PDF panel while it shows the drawing canvas). */
  titles?: Partial<Record<PanelId, string>>;
  /** A small mark after a tab's name: a count, or a dot for something new. */
  badges?: Partial<Record<PanelId, ReactNode>>;
  /** Panels whose content stays mounted while they are closed, because it is shown somewhere else (see PanelSlot). */
  mounted?: readonly PanelId[];
}

/**
 * The editor screen's dock. The dock library arranges plain elements; React draws into them through portals: each open panel's content into that panel's persistent host element, and each tab's label into the tab the dock made for it. Because the hosts outlive every rearrangement, a panel's React tree mounts once and stays mounted while it is open; the editor's stays mounted always.
 */
export function DockWorkspace({ workspace, panels, titles, badges, mounted }: DockWorkspaceProps) {
  const { controller } = workspace;
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    return controller.mount(element);
  }, [controller]);

  useEffect(() => {
    for (const id of workspace.open) controller.setTitle(id, titles?.[id] ?? PANELS[id].title);
  }, [controller, titles, workspace.open]);

  return (
    <>
      <div ref={container} className="dock-root h-full w-full" data-narrow={workspace.narrow || undefined} />
      {workspace.ready &&
        PANEL_IDS.map((id) =>
          // A closed panel is unmounted, as it was when the sidebars were toggled. The editor is never closed, and is drawn even in the instant between two layouts. A panel behind another tab stays mounted but paused (see Paused).
          id === "editor" || workspace.open.includes(id) || mounted?.includes(id)
            ? createPortal(<Paused paused={id !== "editor" && !mounted?.includes(id) && !workspace.visible.includes(id)}>{panels[id]}</Paused>, controller.host(id), id)
            : null,
        )}
      {workspace.tabs.map((tab) =>
        createPortal(
          <DockTab
            id={tab.panel}
            title={titles?.[tab.panel] ?? PANELS[tab.panel].title}
            badge={badges?.[tab.panel]}
            maximized={workspace.maximized === tab.panel}
            canMaximize={workspace.maximized !== null || !workspace.narrow}
            controller={controller}
          />,
          tab.element,
          String(tab.key),
        ),
      )}
      {workspace.menus.map((menu) =>
        menu.panels.length > 0 ? createPortal(<MoreTabs panels={menu.panels} titles={titles} badges={badges} controller={controller} />, menu.element, String(menu.key)) : null,
      )}
    </>
  );
}

/**
 * A panel whose tab is behind another one keeps its state but does not draw again while it cannot be seen: the editor screen re-renders on every keystroke, and a hidden outline or history list redrawn each time is work nobody sees. It catches up, with everything current, the moment its tab comes to the front. Its own state and subscriptions still update it meanwhile.
 */
const Paused = memo(
  function Paused({ children }: { paused: boolean; children: ReactNode }) {
    return children;
  },
  (_, next) => next.paused,
);

/**
 * A place outside the dock for one panel's content, for while that panel is not in the dock. The content is the same mounted tree it is in the dock; only its host element is moved here, so nothing in it starts over.
 */
export function PanelSlot({ workspace, id, className }: { workspace: Workspace; id: PanelId; className?: string }) {
  const { controller } = workspace;
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = slot.current;
    if (!element) return;
    const host = controller.host(id);
    element.appendChild(host);
    return () => {
      if (host.parentElement === element) host.remove();
    };
  }, [controller, id]);
  return <div ref={slot} className={className} />;
}

/** The small count after a tab's name (open comments, unread messages, compile errors). */
export function TabBadge({ children, label, tone = "neutral" }: { children: ReactNode; /** What the number counts, for screen readers. */ label: string; tone?: "neutral" | "danger" }) {
  return (
    <span aria-label={label} className={cn("rounded-full px-1.5 type-micro font-medium tabular-nums", tone === "danger" ? "bg-danger/15 text-danger" : "bg-surface text-muted-foreground")}>
      {children}
    </span>
  );
}

/** At the end of a tab strip whose tabs do not all fit: a menu of the ones not showing. Choosing one brings its tab into the strip, in front. Its width is OVERFLOW_BUTTON_WIDTH (tabs.ts). */
const MoreTabs = memo(function MoreTabs({ panels, titles, badges, controller }: { panels: readonly PanelId[]; titles?: Partial<Record<PanelId, string>>; badges?: Partial<Record<PanelId, ReactNode>>; controller: DockController }) {
  const label = `${panels.length} more ${panels.length === 1 ? "tab" : "tabs"}`;
  return (
    <div className="flex h-full w-9 items-center justify-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="w-8 gap-0.5 px-0 text-muted-foreground" aria-label={label} title={label}>
            <ChevronDown aria-hidden className="size-4" />
            <span aria-hidden className="type-small tabular-nums">
              {panels.length}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {panels.map((id) => (
            <DropdownMenuItem key={id} onSelect={() => controller.show(id)}>
              <span className="flex-1">{titles?.[id] ?? PANELS[id].title}</span>
              {badges?.[id]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

/** Drawn again only when its own name, badge, or state changes, not each time the editor screen does. */
const DockTab = memo(function DockTab({ id, title, badge, maximized, canMaximize, controller }: { id: PanelId; title: string; badge?: ReactNode; maximized: boolean; canMaximize: boolean; controller: DockController }) {
  const closable = PANELS[id].closable;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* No close button on the tab: a small target beside the name is too easy to hit by mistake. Closing is in this menu (right-click) and on the Delete key, and View → Panels brings a panel back. */}
        <div className="dock-tab-label flex h-full items-center gap-1.5 type-base">
          <span className="truncate">{title}</span>
          {badge}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem disabled={!canMaximize} onClick={() => controller.toggleMaximized(id)}>
          {maximized ? "Restore size" : "Maximize"}
        </ContextMenuItem>
        {closable && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => controller.hide(id)}>Close</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});

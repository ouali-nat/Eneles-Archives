import { createDockview, type AddPanelOptions, type DockviewApi, type DockviewTheme, type IContentRenderer, type IHeaderActionsRenderer, type ITabRenderer, type SerializedDockview } from "dockview";
import { createHost, focusInside } from "./host";
import { DEFAULT_LAYOUT_ID, LAYOUTS, PANEL_COMPONENT, SIDEBAR_MIN, TAB_COMPONENT, SIDE, buildLayout, buildSingleGroup, isUsableLayout, matchingLayout, panelsOf, placementOf, withoutPanels, type Placement } from "./layouts";
import { PANELS, PANEL_IDS, isPanelId, type PanelId } from "./panels";
import { measure, stabilize, type Extent } from "./sizing";
import { fitTabStrip, hideCutTabs } from "./tabs";

/** Bumped whenever the stored shape, the set of panels, or the default arrangement changes in a way everyone should start again from; older values are then dropped, not migrated. Version 3 moved Review and Chat in with Axya and keyed the value by account; version 4 moved Review and Chat beside Files and Axya under the editor. */
export const LAYOUT_STORAGE_VERSION = 4;
const STORAGE_BASE = "texer-workspace-layout:v";

/** Where one account's arrangement is kept in this browser. Each account has its own, so two people sharing a browser never see each other's. */
export function layoutStorageKey(accountId: number | string | null | undefined): string {
  return `${STORAGE_BASE}${LAYOUT_STORAGE_VERSION}:${accountId ?? "guest"}`;
}

/** Drops the values older versions left behind (one per browser, not per account). */
function dropOlderVersions(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORAGE_BASE)) continue;
      const version = Number.parseInt(key.slice(STORAGE_BASE.length), 10);
      if (version < LAYOUT_STORAGE_VERSION) localStorage.removeItem(key);
    }
  } catch {
    // Storage refused: nothing was kept to drop.
  }
}

/** Below this width the workspace is one group of tabs: splits would leave every panel too small to use. */
const NARROW_BELOW = 640;

/** The dock reads its colors and sizes from the `.dockview-theme-texer` block in globals.css, which maps them to the app's tokens for both palettes. */
const THEME: DockviewTheme = {
  name: "texer",
  className: "dockview-theme-texer",
  gap: 0,
  dndOverlayMounting: "absolute",
  dndPanelOverlay: "content",
  dndTabIndicator: "line",
};

/** A tab the dock has put on screen, for React to draw the label into. */
export interface TabMount {
  key: number;
  panel: PanelId;
  element: HTMLElement;
}

/** The end of a group's tab strip, for React to draw the "more tabs" button into when some of the group's tabs do not fit. */
export interface MenuMount {
  key: number;
  element: HTMLElement;
  /** The panels whose tabs are not showing, in tab order. */
  panels: readonly PanelId[];
}

export interface WorkspaceSnapshot {
  /** The dock exists; panels can be drawn. */
  ready: boolean;
  /** Panels in the layout, whether or not their tab is in front. */
  open: readonly PanelId[];
  /** Panels whose tab is in front in its group. */
  visible: readonly PanelId[];
  /** The template the arrangement still matches, if any. */
  layoutId: string | null;
  narrow: boolean;
  /** The panel whose group fills the workspace, if one does. */
  maximized: PanelId | null;
  tabs: readonly TabMount[];
  menus: readonly MenuMount[];
}

const EMPTY: WorkspaceSnapshot = { ready: false, open: [], visible: [], layoutId: null, narrow: false, maximized: null, tabs: [], menus: [] };

interface Stored {
  version: number;
  layout: SerializedDockview;
  closed: Partial<Record<PanelId, Placement>>;
}

/**
 * The dock's dividers answer only to a pointer. This makes each one a focusable separator, so the keyboard can reach it.
 */
function labelDividers(container: HTMLElement): void {
  for (const sash of container.querySelectorAll<HTMLElement>(".dv-sash")) {
    const sideBySide = !!sash.closest(".dv-split-view-container")?.classList.contains("dv-horizontal");
    const orientation = sideBySide ? "vertical" : "horizontal";
    if (sash.getAttribute("aria-orientation") === orientation && sash.tabIndex === 0) continue;
    sash.tabIndex = 0;
    sash.setAttribute("role", "separator");
    sash.setAttribute("aria-orientation", orientation);
    sash.setAttribute("aria-label", sideBySide ? "Resize panels: left and right arrow keys" : "Resize panels: up and down arrow keys");
  }
}

/**
 * Arrow keys on a focused divider move it, a step at a time (a larger step with Shift). The move is played to the dock as the pointer drag it understands, so its own limits on how small a group may get still hold.
 */
function resizeWithKeys(event: KeyboardEvent): void {
  const sash = event.target instanceof HTMLElement && event.target.classList.contains("dv-sash") ? event.target : null;
  if (!sash) return;
  const sideBySide = sash.getAttribute("aria-orientation") === "vertical";
  const step = event.shiftKey ? 64 : 16;
  const delta = sideBySide ? (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0) : event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
  if (!delta) return;
  event.preventDefault();
  const box = sash.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const doc = sash.ownerDocument;
  sash.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }));
  doc.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: sideBySide ? x + delta : x, clientY: sideBySide ? y : y + delta }));
  doc.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Owns the dock: creates it, keeps one persistent host element per panel, saves and restores the arrangement, and answers what the toolbar and the View menu ask (is a panel open, show it, hide it, apply a template). React reads it through `useSyncExternalStore`; it holds no React state itself, so the editor's own state stays in EditorView.
 */
export class DockController {
  private api: DockviewApi | null = null;
  private container: HTMLElement | null = null;
  private readonly hosts = new Map<PanelId, HTMLElement>();
  private readonly listeners = new Set<() => void>();
  private snapshot: WorkspaceSnapshot = EMPTY;
  private tabs: TabMount[] = [];
  private tabKey = 0;
  /** The end of each group's tab strip, and which of that group's tabs are not showing. */
  private strips: { key: number; element: HTMLElement }[] = [];
  private readonly hiddenTabs = new Map<Element, PanelId[]>();
  private menus: MenuMount[] = [];
  private menuSignature = "";
  private stripObserver: ResizeObserver | null = null;
  private watched = new WeakSet<Element>();
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Above zero while this class is itself rebuilding the layout, so the dock's own events are not mistaken for the person closing things. */
  private batch = 0;
  private refreshQueued = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The split layout to return to, held while the workspace is too narrow to show it. */
  private wide: SerializedDockview | null = null;
  private narrow = false;
  /** Where each closed panel last sat. */
  private closed: Partial<Record<PanelId, Placement>> = {};
  /** The layout as it was just before the dock removed something, to read the removed panel's place from. */
  private beforeRemoval: SerializedDockview | null = null;
  /** Group sizes from before the change now under way, until they have been used to settle the sizes after it. */
  private sizesBefore: Map<string, Extent> | null = null;
  /** Panels drawn outside the dock for now (the assistant while it floats), which a template being applied leaves out. */
  private readonly outside = new Set<PanelId>();

  constructor(private storageKey: string) {}

  // ── React binding ──

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): WorkspaceSnapshot => this.snapshot;
  getServerSnapshot = (): WorkspaceSnapshot => EMPTY;

  /** Another account's arrangement: the one in use is saved under the old key, and the new account's is put on screen. */
  setStorageKey(key: string): void {
    if (key === this.storageKey) return;
    if (this.api) this.save();
    this.storageKey = key;
    const api = this.api;
    const container = this.container;
    if (!api || !container) return;
    const stored = this.read();
    this.closed = stored?.closed ?? {};
    const layout = stored?.layout ?? this.template(DEFAULT_LAYOUT_ID, container.clientWidth, container.clientHeight);
    this.keepFocus(() => {
      if (this.narrow) {
        this.wide = layout;
        this.load(buildSingleGroup(panelsOf(layout), "editor", container.clientWidth, container.clientHeight));
      } else {
        this.load(layout);
      }
    });
    this.queueRefresh();
  }

  /** Marks a panel as drawn outside the dock (true) or back in it (false). Templates applied meanwhile leave it out. */
  setOutside(id: PanelId, outside: boolean): void {
    if (outside) this.outside.add(id);
    else this.outside.delete(id);
  }

  /** The element a panel's content is portaled into; made on first use and kept for the life of the screen. */
  host(id: PanelId): HTMLElement {
    let host = this.hosts.get(id);
    if (!host) {
      host = createHost(id);
      this.hosts.set(id, host);
    }
    return host;
  }

  // ── Lifecycle ──

  mount(container: HTMLElement): () => void {
    this.container = container;
    const api = createDockview(container, {
      theme: THEME,
      // Pointer events drive every drag. The file tree and the editor use the browser's own drag and drop for files and images; keeping the dock off it means neither can be mistaken for the other.
      dndStrategy: "pointer",
      disableFloatingGroups: true,
      // Which tabs fit a strip, and the menu of those that do not, are this app's own (tabs.ts): the library's would draw a tab cut off at the strip's end.
      disableTabsOverflowList: true,
      createRightHeaderActionComponent: () => this.createStripEnd(),
      defaultTabComponent: TAB_COMPONENT,
      createComponent: ({ id }) => this.createContent(id),
      createTabComponent: ({ id }) => this.createTab(id),
    });
    this.api = api;

    const disposables = [
      api.onDidLayoutChange(() => this.changed()),
      api.onDidActivePanelChange(() => this.queueRefresh()),
      api.onDidMaximizedGroupChange(() => this.queueRefresh()),
      api.onWillMutateLayout((event) => {
        if (this.batch) return;
        if (event.kind === "remove") this.beforeRemoval = api.toJSON();
        // One drag or one click can be several changes in a row (a group leaves one place and enters another). Sizes are taken before the first and settled once, after the last.
        if (this.sizesBefore || event.kind === "load" || event.kind === "clear" || event.kind === "maximize") return;
        this.sizesBefore = measure(api);
        queueMicrotask(() => {
          const before = this.sizesBefore;
          this.sizesBefore = null;
          if (before && this.api === api && !this.batch) stabilize(api, before);
        });
      }),
      api.onDidRemovePanel((panel) => {
        if (this.batch || !isPanelId(panel.id)) return;
        const id = panel.id;
        if (!this.narrow && this.beforeRemoval) {
          const placement = placementOf(this.beforeRemoval, id);
          if (placement) this.closed[id] = placement;
        }
        // The editor is the one panel that must exist; whatever removed it, put it back.
        if (id === "editor") queueMicrotask(() => this.show("editor"));
      }),
      api.onDidMovePanel((event) => {
        // After a drag the tab holds focus; hand it back to where it was inside the panel, so typing continues.
        if (this.batch || !isPanelId(event.panel.id)) return;
        const id = event.panel.id;
        queueMicrotask(() => focusInside(this.hosts.get(id)));
      }),
      api.onWillShowOverlay((event) => {
        // Too narrow to split: a drop may only add a tab or reorder tabs.
        if (this.narrow && (event.kind === "edge" || (event.kind === "content" && event.position !== "center"))) event.preventDefault();
      }),
    ];

    const onDoubleClick = (event: MouseEvent) => {
      const tab = event.target instanceof Element ? event.target.closest<HTMLElement>(".dv-tab") : null;
      const id = tab?.dataset.tabPanelId;
      if (!tab || !isPanelId(id) || (event.target as Element).closest("[data-dock-tab-close]")) return;
      this.toggleMaximized(id);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // The dock closes the focused tab on Delete or Backspace. Route that through hide(), which remembers the panel's place and refuses for the editor.
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const tab = event.target instanceof HTMLElement && event.target.classList.contains("dv-tab") ? event.target : null;
      const id = tab?.dataset.tabPanelId;
      if (!tab || !isPanelId(id)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!PANELS[id].closable) return;
      const neighbour = (tab.nextElementSibling ?? tab.previousElementSibling) as HTMLElement | null;
      this.hide(id);
      if (neighbour?.isConnected) neighbour.focus();
    };
    // A strip scrolled by the wheel settles on a tab's edge once the wheel stops; a tab given keyboard focus is brought into its strip at once.
    const onScroll = (event: Event) => {
      const list = event.target instanceof HTMLElement && event.target.classList.contains("dv-tabs-container") ? event.target : null;
      if (!list) return;
      hideCutTabs(list);
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => this.fitTabs(false), 120);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.classList.contains("dv-tab")) this.fitTabs(false);
    };
    this.stripObserver = new ResizeObserver(() => this.fitTabs(true));
    this.watched = new WeakSet();
    container.addEventListener("dblclick", onDoubleClick);
    container.addEventListener("keydown", onKeyDown, true);
    container.addEventListener("keydown", resizeWithKeys);
    container.addEventListener("scroll", onScroll, true);
    container.addEventListener("focusin", onFocusIn);

    const width = container.clientWidth;
    const height = container.clientHeight;
    dropOlderVersions();
    const stored = this.read();
    this.closed = stored?.closed ?? {};
    const initial = stored?.layout ?? this.template(DEFAULT_LAYOUT_ID, width, height);
    this.narrow = width > 0 && width < NARROW_BELOW;
    if (this.narrow) {
      this.wide = initial;
      this.load(buildSingleGroup(panelsOf(initial), "editor", width, height));
    } else {
      this.load(initial);
    }

    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w <= 0) return;
      this.setNarrow(w < NARROW_BELOW);
    });
    observer.observe(container);

    // Announced after this commit's effects have all run, so that whoever subscribes in one of them hears about the layout that was just restored.
    this.queueRefresh();

    return () => {
      observer.disconnect();
      container.removeEventListener("dblclick", onDoubleClick);
      container.removeEventListener("keydown", onKeyDown, true);
      container.removeEventListener("keydown", resizeWithKeys);
      container.removeEventListener("scroll", onScroll, true);
      container.removeEventListener("focusin", onFocusIn);
      this.stripObserver?.disconnect();
      this.stripObserver = null;
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.save();
      this.batch++;
      for (const d of disposables) d.dispose();
      api.dispose();
      this.batch--;
      this.api = null;
      this.container = null;
      this.tabs = [];
      this.strips = [];
      this.hiddenTabs.clear();
    };
  }

  private createStripEnd(): IHeaderActionsRenderer {
    const element = document.createElement("div");
    element.className = "dock-strip-end";
    const strip = { key: ++this.tabKey, element };
    return {
      element,
      init: () => {
        this.strips = [...this.strips, strip];
        this.queueRefresh();
      },
      dispose: () => {
        this.strips = this.strips.filter((s) => s !== strip);
        this.queueRefresh();
      },
    };
  }

  /** Fits every group's tab strip to its width (see tabs.ts) and notes which tabs are left for the "more tabs" menus. */
  private fitTabs(reveal: boolean): void {
    const container = this.container;
    const observer = this.stripObserver;
    if (!container || !observer) return;
    const now = new Map<Element, PanelId[]>();
    for (const list of container.querySelectorAll<HTMLElement>(".dv-tabs-container")) {
      const header = list.closest(".dv-tabs-and-actions-container");
      for (const element of [header, ...list.children]) {
        if (!element || this.watched.has(element)) continue;
        this.watched.add(element);
        observer.observe(element);
      }
      const group = list.closest(".dv-groupview");
      if (group) now.set(group, fitTabStrip(list, reveal));
    }
    let changed = now.size !== this.hiddenTabs.size;
    for (const [group, hidden] of now) {
      const before = this.hiddenTabs.get(group);
      if (!before || !sameList(before, hidden)) changed = true;
    }
    this.hiddenTabs.clear();
    for (const [group, hidden] of now) this.hiddenTabs.set(group, hidden);
    if (changed) this.queueRefresh();
  }

  private createContent(id: string): IContentRenderer {
    const element = document.createElement("div");
    element.className = "dock-content";
    return {
      element,
      init: () => {
        if (isPanelId(id)) element.appendChild(this.host(id));
      },
      dispose: () => {
        // Only if it is still here: a rebuilt layout has usually claimed the host for its new place already.
        const host = isPanelId(id) ? this.hosts.get(id) : undefined;
        if (host?.parentElement === element) host.remove();
      },
    };
  }

  private createTab(id: string): ITabRenderer {
    const element = document.createElement("div");
    element.className = "dock-tab";
    let mount: TabMount | null = null;
    return {
      element,
      init: () => {
        if (!isPanelId(id)) return;
        mount = { key: ++this.tabKey, panel: id, element };
        this.tabs = [...this.tabs, mount];
        this.queueRefresh();
      },
      dispose: () => {
        this.tabs = this.tabs.filter((tab) => tab !== mount);
        this.queueRefresh();
      },
    };
  }

  // ── What the toolbar and the View menu call ──

  isOpen(id: PanelId): boolean {
    return !!this.api?.getPanel(id);
  }

  /** Opens the panel if it is closed, and brings its tab to the front. Keyboard focus stays where it is. */
  show(id: PanelId): void {
    const api = this.api;
    if (!api) return;
    this.keepFocus(() => {
      const existing = api.getPanel(id);
      if (api.hasMaximizedGroup() && !(existing && existing.api.isMaximized())) api.exitMaximizedGroup();
      if (existing) {
        existing.api.setActive();
        return;
      }
      api.addPanel({ id, component: PANEL_COMPONENT, tabComponent: TAB_COMPONENT, title: PANELS[id].title, ...this.positionFor(id) });
      delete this.closed[id];
    });
  }

  hide(id: PanelId): void {
    const api = this.api;
    const panel = api?.getPanel(id);
    if (!api || !panel || !PANELS[id].closable) return;
    this.keepFocus(() => api.removePanel(panel));
  }

  /** The toolbar buttons: closed opens, behind another tab comes to the front, in front closes. */
  toggle(id: PanelId): void {
    if (this.snapshotNow().visible.includes(id)) this.hide(id);
    else this.show(id);
  }

  toggleMaximized(id: PanelId): void {
    const api = this.api;
    const panel = api?.getPanel(id);
    if (!api || !panel) return;
    if (panel.api.isMaximized()) api.exitMaximizedGroup();
    else if (api.groups.length > 1) panel.api.maximize();
  }

  applyLayout(layoutId: string): void {
    const api = this.api;
    const container = this.container;
    if (!api || !container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const layout = this.template(layoutId, width, height);
    this.closed = {};
    this.keepFocus(() => {
      if (this.narrow) {
        this.wide = layout;
        this.load(buildSingleGroup(panelsOf(layout), "editor", width, height));
      } else {
        this.load(layout);
      }
    });
    this.changed();
  }

  reset(): void {
    this.applyLayout(DEFAULT_LAYOUT_ID);
  }

  /** Tells the dock a panel's current name, which it reads out as the tab's accessible label. */
  setTitle(id: PanelId, title: string): void {
    const panel = this.api?.getPanel(id);
    if (panel && panel.title !== title) panel.api.setTitle(title);
  }

  // ── Internals ──

  private template(layoutId: string, width: number, height: number): SerializedDockview {
    const template = LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0];
    const root = withoutPanels(template.root, this.outside) ?? { tabs: ["editor"] };
    return buildLayout(root, width || 1280, height || 800);
  }

  /** Replaces the whole arrangement. A layout the dock rejects is replaced by the default, so a bad stored value can never leave the screen empty. */
  private load(layout: SerializedDockview): void {
    const api = this.api;
    if (!api) return;
    this.batch++;
    try {
      api.fromJSON(layout);
      if (!api.getPanel("editor")) throw new Error("layout without the editor");
    } catch {
      try {
        api.clear();
      } catch {
        // Nothing more to clear.
      }
      api.fromJSON(this.template(DEFAULT_LAYOUT_ID, this.container?.clientWidth ?? 0, this.container?.clientHeight ?? 0));
    } finally {
      this.batch--;
    }
  }

  private setNarrow(narrow: boolean): void {
    const api = this.api;
    const container = this.container;
    if (!api || !container || narrow === this.narrow) return;
    this.narrow = narrow;
    this.keepFocus(() => {
      if (narrow) {
        const active = api.activePanel?.id;
        this.wide = api.toJSON();
        this.load(buildSingleGroup(panelsOf(this.wide), isPanelId(active) ? active : "editor", container.clientWidth, container.clientHeight));
        return;
      }
      const wide = this.wide;
      this.wide = null;
      if (!wide) return;
      // Panels opened or closed while narrow carry over to the split layout.
      const now = new Set(api.panels.map((panel) => panel.id));
      this.load(wide);
      this.batch++;
      for (const panel of [...api.panels]) if (!now.has(panel.id)) api.removePanel(panel);
      this.batch--;
      for (const id of PANEL_IDS) if (now.has(id) && !api.getPanel(id)) this.show(id);
    });
    this.changed();
  }

  /** Where a panel being opened goes: back where it was closed if that place still exists, otherwise beside the panels it belongs with. */
  private positionFor(id: PanelId): Partial<AddPanelOptions> {
    const api = this.api;
    if (!api) return {};
    const open = (panel: PanelId) => !!api.getPanel(panel);
    const within = (panel: PanelId, index?: number): Partial<AddPanelOptions> => ({ position: { referencePanel: panel, direction: "within", index } });

    if (this.narrow) return within("editor");

    const remembered = this.closed[id];
    const isSide = (SIDE as readonly PanelId[]).includes(id);
    if (remembered) {
      const sibling = remembered.tabsWith.find(open);
      if (sibling) return within(sibling, remembered.index);
      // Files, Review, and Chat find each other before an old place beside something else: the last of them closed must not come back as a group of its own beside the one the others started again.
      const together = isSide ? SIDE.find((panel) => panel !== id && open(panel)) : undefined;
      if (together) return within(together);
      if (remembered.beside && open(remembered.beside.panel)) {
        const { panel, side } = remembered.beside;
        return { position: { referencePanel: panel, direction: side }, ...(side === "left" || side === "right" ? { initialWidth: remembered.width } : { initialHeight: remembered.height }) };
      }
    }

    const width = api.width;
    const height = api.height;
    const sidebar = Math.round(Math.min(Math.max(SIDEBAR_MIN, width * 0.18), Math.max(180, width / 3)));
    const outline = (["contents", "references", "history"] as const).find((panel) => panel !== id && open(panel));
    const side = SIDE.find((panel) => panel !== id && open(panel));
    // Under the editor: where Axya sits in the Default layout, and where the compile log joins it.
    const underEditor = (): Partial<AddPanelOptions> => ({ position: { referencePanel: "editor", direction: "below" }, initialHeight: Math.round(Math.min(360, Math.max(220, height * 0.34))) });
    switch (id) {
      case "files":
      case "review":
      case "chat":
        // With the others of the three, whichever is open; otherwise above the outline, or a sidebar of their own.
        if (side) return within(side);
        if (outline) return { position: { referencePanel: outline, direction: "above" } };
        return { position: { direction: "left" }, initialWidth: sidebar };
      case "contents":
      case "references":
      case "history":
        if (outline) return within(outline);
        if (side) return { position: { referencePanel: side, direction: "below" } };
        return { position: { direction: "left" }, initialWidth: sidebar };
      case "assistant":
        // Under the editor, the way a terminal sits under code.
        return underEditor();
      case "pdf":
        return { position: { direction: "right" }, initialWidth: Math.round(width * 0.4) };
      case "logs":
        // Under the PDF it explains; with no PDF open, under the editor.
        if (open("pdf")) return { position: { referencePanel: "pdf", direction: "below" }, initialHeight: Math.round(Math.min(260, Math.max(140, height * 0.26))) };
        return { ...underEditor(), initialHeight: Math.round(Math.min(260, Math.max(140, height * 0.26))) };
      case "editor":
        return { position: { direction: "left" }, initialWidth: Math.round(width * 0.5) };
    }
  }

  /** Runs a change to the layout and, if it took keyboard focus away from where the person was working, gives it back. Moving a panel takes its element out of the document for a moment, which drops focus. */
  private keepFocus(run: () => void): void {
    const before = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    run();
    if (before && before.isConnected && document.activeElement !== before) before.focus({ preventScroll: true });
  }

  private changed(): void {
    this.queueRefresh();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  private queueRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      this.refresh();
    });
  }

  private snapshotNow(): WorkspaceSnapshot {
    const api = this.api;
    if (!api) return this.snapshot;
    const open = PANEL_IDS.filter((id) => api.getPanel(id));
    // While one group fills the workspace, only what is in that group is on screen.
    const maximized = api.hasMaximizedGroup();
    const visible = open.filter((id) => {
      const panel = api.getPanel(id);
      return !!panel && panel.group.activePanel === panel && (!maximized || panel.api.isMaximized());
    });
    const maximizedPanel = maximized ? api.panels.find((panel) => panel.api.isMaximized() && panel.group.activePanel === panel) : undefined;
    const layout = this.narrow ? this.wide : api.toJSON();
    return {
      ready: true,
      open,
      visible,
      layoutId: layout ? matchingLayout(layout) : null,
      narrow: this.narrow,
      maximized: maximizedPanel && isPanelId(maximizedPanel.id) ? maximizedPanel.id : null,
      tabs: this.tabs,
      menus: this.menusNow(),
    };
  }

  /** The same array until a strip appears, goes, or its hidden tabs change, so React is told only of real changes. */
  private menusNow(): MenuMount[] {
    const menus = this.strips.map(({ key, element }) => ({ key, element, panels: this.hiddenTabs.get(element.closest(".dv-groupview") ?? element) ?? [] }));
    const signature = menus.map((menu) => `${menu.key}:${menu.panels.join(",")}`).join("|");
    if (signature !== this.menuSignature) {
      this.menuSignature = signature;
      this.menus = menus;
    }
    return this.menus;
  }

  private refresh(): void {
    if (this.container) labelDividers(this.container);
    this.fitTabs(true);
    const next = this.snapshotNow();
    const prev = this.snapshot;
    if (prev.ready === next.ready && sameList(prev.open, next.open) && sameList(prev.visible, next.visible) && prev.layoutId === next.layoutId && prev.narrow === next.narrow && prev.maximized === next.maximized && prev.tabs === next.tabs && prev.menus === next.menus) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  private read(): Stored | null {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<Stored> | null;
      if (!value || value.version !== LAYOUT_STORAGE_VERSION || !isUsableLayout(value.layout)) return null;
      const closed: Partial<Record<PanelId, Placement>> = {};
      if (value.closed && typeof value.closed === "object") {
        for (const [id, placement] of Object.entries(value.closed)) {
          if (isPanelId(id) && placement && Array.isArray(placement.tabsWith)) closed[id] = { ...placement, tabsWith: placement.tabsWith.filter(isPanelId) };
        }
      }
      return { version: LAYOUT_STORAGE_VERSION, layout: value.layout, closed };
    } catch {
      return null;
    }
  }

  private save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const api = this.api;
    if (!api) return;
    const layout = this.narrow ? this.wide : api.toJSON();
    if (!layout) return;
    try {
      const stored: Stored = { version: LAYOUT_STORAGE_VERSION, layout, closed: this.closed };
      localStorage.setItem(this.storageKey, JSON.stringify(stored));
    } catch {
      // Private mode or a full quota: the layout simply is not remembered.
    }
  }
}

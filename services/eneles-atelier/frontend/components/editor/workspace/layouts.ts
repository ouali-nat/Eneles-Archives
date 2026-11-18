import type { SerializedDockview } from "dockview";
import { PANELS, isPanelId, type PanelId } from "./panels";

/** The one content renderer every dock panel uses; what it shows is decided by the panel's id. */
export const PANEL_COMPONENT = "panel";
/** The one tab renderer every dock panel uses. */
export const TAB_COMPONENT = "tab";

/** A group of tabbed panels, or a row or column of further nodes. `size` is a weight among its siblings, not pixels; `min` is a width or height in pixels the node gets even when its weight would give it less (a sidebar wide enough for its tabs), up to a third of what there is. */
export type LayoutNode = { tabs: PanelId[]; active?: PanelId; size?: number; min?: number } | { split: "row" | "column"; children: LayoutNode[]; size?: number; min?: number };

/** Wide enough for the Contents, References, and History tabs side by side (326px at the 40px tab height and 14px labels), with room to spare. */
export const SIDEBAR_MIN = 340;

export interface LayoutTemplate {
  id: string;
  /** The name in View → Layouts, in sentence case. */
  name: string;
  root: LayoutNode;
}

export const DEFAULT_LAYOUT_ID = "default";

/** The panels that share the sidebar's upper group: the files, and where people talk about them (comments and suggestions, and the project's chat). Each reopens beside the others. */
export const SIDE = ["files", "review", "chat"] as const satisfies readonly PanelId[];

/** A template with some panels left out (the assistant while it floats over the editor instead of sitting in the dock). A group left with no tabs goes, and a split left with one child is that child. */
export function withoutPanels(node: LayoutNode, leave: ReadonlySet<PanelId>): LayoutNode | null {
  if (leave.size === 0) return node;
  if ("tabs" in node) {
    const tabs = node.tabs.filter((id) => !leave.has(id));
    if (tabs.length === 0) return null;
    return { ...node, tabs, active: node.active && tabs.includes(node.active) ? node.active : tabs[0] };
  }
  const children = node.children.map((child) => withoutPanels(child, leave)).filter((child): child is LayoutNode => child !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return { ...children[0], size: node.size, min: node.min ?? children[0].min };
  return { ...node, children };
}

export const LAYOUTS: LayoutTemplate[] = [
  {
    id: DEFAULT_LAYOUT_ID,
    name: "Default",
    root: {
      split: "row",
      children: [
        // The sidebar: the files, with Review and Chat as tabs beside them; the outline, references, and history under them.
        { split: "column", size: 18, min: SIDEBAR_MIN, children: [{ tabs: [...SIDE], active: "files", size: 64 }, { tabs: ["contents", "references", "history"], size: 36 }] },
        // Axya sits under the editor, the way a terminal sits under code; the PDF keeps its column's full height.
        { split: "column", size: 44, children: [{ tabs: ["editor"], size: 66 }, { tabs: ["assistant"], size: 34 }] },
        { tabs: ["pdf"], size: 38 },
      ],
    },
  },
  {
    id: "writing",
    name: "Writing",
    root: { split: "row", children: [{ tabs: ["editor"], size: 52 }, { tabs: ["pdf"], size: 48 }] },
  },
  {
    id: "review",
    name: "Review",
    root: { split: "row", children: [{ tabs: ["editor"], size: 42 }, { tabs: ["pdf"], size: 36 }, { tabs: ["review", "chat"], size: 22 }] },
  },
  {
    id: "reading",
    name: "Reading",
    root: { split: "row", children: [{ tabs: ["editor"], size: 30 }, { tabs: ["pdf"], size: 70 }] },
  },
  {
    id: "focus",
    name: "Focus",
    root: { tabs: ["editor"] },
  },
  {
    id: "sidebar",
    name: "Everything in one sidebar",
    root: {
      split: "row",
      children: [
        { tabs: ["files", "contents", "references", "history", "review", "chat"], active: "files", size: 24, min: SIDEBAR_MIN },
        { tabs: ["editor"], size: 41 },
        { tabs: ["pdf"], size: 35 },
      ],
    },
  },
];

type GridNode = SerializedDockview["grid"]["root"];
type GridLeaf = { id: string; views: string[]; activeView?: string };

function isBranch(node: GridNode): node is GridNode & { data: GridNode[] } {
  return node.type === "branch" && Array.isArray(node.data);
}

function leafOf(node: GridNode): GridLeaf {
  return node.data as unknown as GridLeaf;
}

const HORIZONTAL = "HORIZONTAL" as SerializedDockview["grid"]["orientation"];
const VERTICAL = "VERTICAL" as SerializedDockview["grid"]["orientation"];

function panelStates(ids: PanelId[]): SerializedDockview["panels"] {
  const panels: SerializedDockview["panels"] = {};
  for (const id of ids) panels[id] = { id, contentComponent: PANEL_COMPONENT, tabComponent: TAB_COMPONENT, title: PANELS[id].title };
  return panels;
}

/** Turns a template into the dock library's own serialized form, sized for a workspace of `width` by `height` pixels. */
export function buildLayout(root: LayoutNode, width: number, height: number): SerializedDockview {
  const ids: PanelId[] = [];
  let groups = 0;
  let activeGroup: string | undefined;

  // A node stores its extent along its parent's axis only, so its box is carried down. Templates alternate rows and columns by depth, as the grid itself does.
  const build = (node: LayoutNode, parentRow: boolean, w: number, h: number): GridNode => {
    const size = Math.round(parentRow ? w : h);
    if ("tabs" in node) {
      const id = `group-${++groups}`;
      ids.push(...node.tabs);
      if (node.tabs.includes("editor")) activeGroup = id;
      return { type: "leaf", size, data: { id, views: [...node.tabs], activeView: node.active ?? node.tabs[0] } as unknown as GridNode["data"] };
    }
    const row = node.split === "row";
    const extent = row ? w : h;
    const total = node.children.reduce((sum, child) => sum + (child.size ?? 1), 0);
    const shares = node.children.map((child) => (extent * (child.size ?? 1)) / total);
    // A child below its minimum is raised to it, and its siblings share what is left in their own proportions.
    const raised = node.children.map((child, i) => (child.min && shares[i] < Math.min(child.min, extent / 3) ? Math.min(child.min, extent / 3) : null));
    const fixed = raised.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const loose = shares.reduce((sum, value, i) => sum + (raised[i] === null ? value : 0), 0) || 1;
    const children = node.children.map((child, i) => {
      const size = raised[i] ?? (shares[i] * (extent - fixed)) / loose;
      return build(child, row, row ? size : w, row ? h : size);
    });
    return { type: "branch", size, data: children };
  };

  const wrapped: LayoutNode = "tabs" in root ? { split: "row", children: [root] } : root;
  const rootRow = !("tabs" in wrapped) && wrapped.split === "row";
  const node = build(wrapped, rootRow, width, height);
  // The root has no parent: its size is its extent across its own axis.
  node.size = rootRow ? height : width;

  return {
    grid: { root: node, width, height, orientation: rootRow ? HORIZONTAL : VERTICAL },
    panels: panelStates(ids),
    activeGroup,
  };
}

/** Every open panel as tabs of one group, for workspaces too narrow to split. */
export function buildSingleGroup(ids: PanelId[], active: PanelId, width: number, height: number): SerializedDockview {
  return buildLayout({ tabs: ids, active: ids.includes(active) ? active : ids[0] }, width, height);
}

/** The panels a serialized layout holds, in grid order. */
export function panelsOf(layout: SerializedDockview): PanelId[] {
  const ids: PanelId[] = [];
  const walk = (node: GridNode) => {
    if (isBranch(node)) node.data.forEach(walk);
    else for (const view of leafOf(node).views) if (isPanelId(view)) ids.push(view);
  };
  walk(layout.grid.root);
  return ids;
}

/**
 * Whether a stored layout can be handed to the dock: it must be a plain grid whose every panel is one this version knows, each exactly once, with the editor among them. Anything else (an older shape, a renamed panel, a hand-edited value) falls back to the default.
 */
export function isUsableLayout(value: unknown): value is SerializedDockview {
  if (!value || typeof value !== "object") return false;
  const layout = value as Partial<SerializedDockview>;
  if (!layout.grid || typeof layout.grid !== "object" || !layout.grid.root || !layout.panels || typeof layout.panels !== "object") return false;
  if (layout.floatingGroups?.length || layout.popoutGroups?.length) return false;
  const seen = new Set<string>();
  let valid = true;
  const walk = (node: GridNode | undefined) => {
    if (!node || typeof node !== "object") {
      valid = false;
    } else if (node.type === "branch") {
      if (!Array.isArray(node.data)) valid = false;
      else node.data.forEach(walk);
    } else if (node.type === "leaf") {
      const views = (node.data as unknown as Partial<GridLeaf> | undefined)?.views;
      if (!Array.isArray(views) || views.length === 0) valid = false;
      else
        for (const view of views) {
          if (!isPanelId(view) || seen.has(view) || !layout.panels?.[view]) valid = false;
          seen.add(view);
        }
    } else {
      valid = false;
    }
  };
  walk(layout.grid.root);
  return valid && seen.has("editor");
}

type Shape = { panels: string[] } | { row: boolean; children: Shape[] };

/**
 * The arrangement of a layout with sizes, tab order, and the active tab left out: which panels share a group, and how the groups are split. Two layouts with the same signature look the same apart from proportions, which is what "still matches the template" means.
 */
export function signatureOf(layout: SerializedDockview, ignore: ReadonlySet<PanelId>): string {
  const shape = (node: GridNode, row: boolean): Shape | null => {
    if (!isBranch(node)) {
      const panels = leafOf(node)
        .views.filter((view) => !ignore.has(view as PanelId))
        .sort();
      return panels.length ? { panels } : null;
    }
    const children: Shape[] = [];
    for (const child of node.data) {
      const s = shape(child, !row);
      if (!s) continue;
      // A branch left with one child is that child; a child split the same way as its parent is part of the parent.
      if ("row" in s && s.row === row) children.push(...s.children);
      else children.push(s);
    }
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { row, children };
  };
  const print = (s: Shape): string => ("panels" in s ? `[${s.panels.join(" ")}]` : `${s.row ? "row" : "column"}(${s.children.map(print).join(" ")})`);
  const root = shape(layout.grid.root, layout.grid.orientation === HORIZONTAL);
  return root ? print(root) : "";
}

/** Logs opens by itself when a compile fails, and the assistant leaves the dock while it floats over the editor, so neither makes a layout stop matching its template. */
const UNCOUNTED: ReadonlySet<PanelId> = new Set<PanelId>(["logs", "assistant"]);

/** Each group's share of the workspace's area, keyed by the panels in it. Tells apart templates that arrange the same groups in different proportions (Writing and Reading). */
function sharesOf(layout: SerializedDockview): Map<string, number> {
  const shares = new Map<string, number>();
  const total = layout.grid.width * layout.grid.height || 1;
  const walk = (node: GridNode, row: boolean, width: number, height: number) => {
    if (isBranch(node)) {
      for (const child of node.data) walk(child, !row, row ? (child.size ?? 0) : width, row ? height : (child.size ?? 0));
      return;
    }
    const key = leafOf(node)
      .views.filter((view) => !UNCOUNTED.has(view as PanelId))
      .sort()
      .join(" ");
    if (key) shares.set(key, (width * height) / total);
  };
  walk(layout.grid.root, layout.grid.orientation === HORIZONTAL, layout.grid.width, layout.grid.height);
  return shares;
}

const TEMPLATES = LAYOUTS.map((template) => {
  const layout = buildLayout(template.root, 1200, 800);
  return { id: template.id, signature: signatureOf(layout, UNCOUNTED), shares: sharesOf(layout) };
});

/** The template the layout still matches, if any: the same groups split the same way. Where two templates differ only in proportions, the nearer one. */
export function matchingLayout(layout: SerializedDockview): string | null {
  const signature = signatureOf(layout, UNCOUNTED);
  const candidates = TEMPLATES.filter((template) => template.signature === signature);
  if (candidates.length <= 1) return candidates[0]?.id ?? null;
  const shares = sharesOf(layout);
  let best = candidates[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    let distance = 0;
    for (const [key, share] of candidate.shares) distance += Math.abs(share - (shares.get(key) ?? 0));
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best.id;
}

export type Side = "left" | "right" | "above" | "below";

/** Where a panel sat when it was closed, so reopening puts it back. */
export interface Placement {
  /** The panels it shared a group with, and its place among their tabs. */
  tabsWith: PanelId[];
  index: number;
  /** When it had a group to itself: the panel it sat beside, and on which side of it. */
  beside?: { panel: PanelId; side: Side };
  width: number;
  height: number;
}

/** Reads a panel's place out of a layout, before the panel is closed. */
export function placementOf(layout: SerializedDockview, id: PanelId): Placement | null {
  let found: Placement | null = null;
  const first = (node: GridNode): PanelId | null => {
    if (isBranch(node)) {
      for (const child of node.data) {
        const hit = first(child);
        if (hit) return hit;
      }
      return null;
    }
    const leaf = leafOf(node);
    const view = leaf.activeView ?? leaf.views[0];
    return isPanelId(view) ? view : null;
  };
  // `width` and `height` are the node's own box, tracked on the way down because a node only stores its extent along its parent's axis.
  const walk = (node: GridNode, row: boolean, width: number, height: number, siblings: GridNode[], at: number, parentRow: boolean) => {
    if (found) return;
    if (isBranch(node)) {
      node.data.forEach((child, i) => walk(child, !row, row ? (child.size ?? 0) : width, row ? height : (child.size ?? 0), node.data, i, row));
      return;
    }
    const leaf = leafOf(node);
    const index = leaf.views.indexOf(id);
    if (index < 0) return;
    const tabsWith = leaf.views.filter((view): view is PanelId => view !== id && isPanelId(view));
    let beside: Placement["beside"];
    if (tabsWith.length === 0) {
      const before = at > 0 ? first(siblings[at - 1]) : null;
      const after = at < siblings.length - 1 ? first(siblings[at + 1]) : null;
      if (before) beside = { panel: before, side: parentRow ? "right" : "below" };
      else if (after) beside = { panel: after, side: parentRow ? "left" : "above" };
    }
    found = { tabsWith, index, beside, width, height };
  };
  const rootRow = layout.grid.orientation === HORIZONTAL;
  walk(layout.grid.root, rootRow, layout.grid.width, layout.grid.height, [], 0, rootRow);
  return found;
}

import type { DockviewApi, SerializedDockview } from "dockview";

type GridNode = SerializedDockview["grid"]["root"];
type Axis = "width" | "height";
export type Extent = Record<Axis, number>;

/** The panels that give up and take up space when others come and go: the two a person is working in, not the sidebars around them. */
const FLEXIBLE = new Set(["editor", "pdf"]);
/** No group is squeezed below this by a rebalance; if it would be, the dock's own result stands. */
const MIN = 120;

function isBranch(node: GridNode): node is GridNode & { data: GridNode[] } {
  return node.type === "branch" && Array.isArray(node.data);
}
function leaf(node: GridNode): { id: string; views: string[] } {
  return node.data as unknown as { id: string; views: string[] };
}

/** Every group's size, to compare against after the dock has changed its structure. */
export function measure(api: DockviewApi): Map<string, Extent> {
  return new Map(api.groups.map((group) => [group.id, { width: group.api.width, height: group.api.height }]));
}

/**
 * Puts group sizes right after a panel was opened, closed, or dragged to a new place.
 *
 * Left alone, the dock evens out a whole row whenever a group leaves it (closing the chat would make the file tree as wide as the editor), and takes a new group's space from whichever group happens to be last. Here every group that was there before keeps the size it had, and the difference is taken from, or given to, the editor and the PDF in proportion (or, in a row or column that holds neither, shared by all). A group freshly split in two keeps the dock's halves.
 */
export function stabilize(api: DockviewApi, before: Map<string, Extent>): void {
  if (api.hasMaximizedGroup()) return;
  const layout = api.toJSON();
  const live = (id: string): Extent | undefined => {
    const group = api.getGroup(id);
    return group ? { width: group.api.width, height: group.api.height } : undefined;
  };

  // A node's extent along an axis, from the sizes of the groups under it. `row` is the node's own direction when it is a branch.
  const extent = (node: GridNode, row: boolean, axis: Axis, sizeOf: (id: string) => Extent | undefined): number | null => {
    if (!isBranch(node)) return sizeOf(leaf(node).id)?.[axis] ?? null;
    if ((axis === "width") === row) {
      let sum = 0;
      for (const child of node.data) {
        const e = extent(child, !row, axis, sizeOf);
        if (e === null) return null;
        sum += e;
      }
      return sum;
    }
    for (const child of node.data) {
      const e = extent(child, !row, axis, sizeOf);
      if (e !== null) return e;
    }
    return null;
  };
  const holdsFlexible = (node: GridNode): boolean => (isBranch(node) ? node.data.some(holdsFlexible) : leaf(node).views.some((view) => FLEXIBLE.has(view)));
  // The group to resize in order to resize `node` within its parent: the node itself, or a group directly inside it (which spans it on the parent's axis).
  const handle = (node: GridNode): string | null => {
    if (!isBranch(node)) return leaf(node).id;
    const direct = node.data.find((child) => !isBranch(child));
    return direct ? leaf(direct).id : null;
  };

  const visit = (node: GridNode, row: boolean): void => {
    if (!isBranch(node)) return;
    const children = node.data;
    const axis: Axis = row ? "width" : "height";
    if (children.length > 1) settle(children, row, axis);
    for (const child of children) visit(child, !row);
  };

  const settle = (children: GridNode[], row: boolean, axis: Axis): void => {
    const now = children.map((child) => extent(child, !row, axis, live));
    if (now.some((value) => value === null)) return;
    const current = now as number[];
    const was = children.map((child) => extent(child, !row, axis, (id) => before.get(id)));
    const old = children.map((_, i) => i).filter((i) => was[i] !== null);
    // One existing group and a new one beside it is a fresh split: the dock's halves stand.
    if (old.length < 2 && old.length < children.length) return;
    const desired = was.map((value, i) => value ?? current[i]);
    const total = current.reduce((sum, value) => sum + value, 0);
    const leftover = total - desired.reduce((sum, value) => sum + value, 0);
    if (Math.abs(leftover) >= 1) {
      const share = (pool: number[]): number[] => {
        const sum = pool.reduce((acc, i) => acc + desired[i], 0) || 1;
        return pool.map((i) => desired[i] + (leftover * desired[i]) / sum);
      };
      const flexible = old.filter((i) => holdsFlexible(children[i]));
      let pool = flexible.length ? flexible : old;
      let next = share(pool);
      if (next.some((value) => value < MIN) && pool !== old) {
        pool = old;
        next = share(pool);
      }
      if (next.some((value) => value < MIN)) return;
      pool.forEach((i, k) => (desired[i] = next[k]));
    }
    if (desired.every((value, i) => Math.abs(value - current[i]) < 1)) return;
    // The dock gives whatever one group gains or loses to the last group in the row, so setting all but the last, in order, leaves the last with exactly its own share.
    for (let i = 0; i < children.length - 1; i++) {
      const id = handle(children[i]);
      const group = id ? api.getGroup(id) : undefined;
      if (group) group.api.setSize({ [axis]: Math.round(desired[i]) });
    }
  };

  visit(layout.grid.root, layout.grid.orientation === ("HORIZONTAL" as SerializedDockview["grid"]["orientation"]));
}

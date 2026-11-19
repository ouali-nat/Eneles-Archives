import type { PanelId } from "./panels";

const TAG = "texer-dock-host";

/**
 * The element a panel's React tree is portaled into. One exists per panel for the life of the editor screen, and the dock only ever moves it: dragging a tab to another group, switching layouts, or hiding a tab behind another re-parents this element instead of rebuilding what is inside. That is why the code editor keeps its text, cursor, undo history, and collaboration binding however the workspace is rearranged.
 *
 * A browser drops the scroll offsets of anything taken out of the document, so the element remembers the offsets of whatever scrolled inside it and puts them back each time it is attached again.
 */
interface DockHost extends HTMLElement {
  /** The last element inside that held keyboard focus, to return focus to after the panel moves. */
  lastFocused: HTMLElement | null;
}

function define(): void {
  if (customElements.get(TAG)) return;

  class DockHostElement extends HTMLElement implements DockHost {
    lastFocused: HTMLElement | null = null;
    private readonly offsets = new Map<Element, { left: number; top: number }>();
    private frame = 0;

    constructor() {
      super();
      // Scroll does not bubble, so it is caught on the way down.
      this.addEventListener(
        "scroll",
        (event) => {
          const target = event.target;
          if (!(target instanceof Element) || !target.isConnected || this.frame) return;
          this.offsets.set(target, { left: target.scrollLeft, top: target.scrollTop });
        },
        { capture: true, passive: true },
      );
      this.addEventListener("focusin", (event) => {
        if (event.target instanceof HTMLElement) this.lastFocused = event.target;
      });
    }

    connectedCallback(): void {
      // Taken as a copy now: the reset the browser applied on detach must not be recorded over the real offsets before they are put back.
      const saved = [...this.offsets].filter(([element]) => this.contains(element));
      this.offsets.clear();
      for (const [element, offset] of saved) this.offsets.set(element, offset);
      if (!saved.length) return;
      const apply = () => {
        for (const [element, { left, top }] of saved) {
          if (element.scrollTop !== top) element.scrollTop = top;
          if (element.scrollLeft !== left) element.scrollLeft = left;
        }
      };
      apply();
      // Once more after the dock has sized the group this landed in; until then there may be nothing to scroll.
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => {
        this.frame = requestAnimationFrame(() => {
          apply();
          this.frame = 0;
        });
      });
    }

    disconnectedCallback(): void {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  customElements.define(TAG, DockHostElement);
}

export function createHost(id: PanelId): HTMLElement {
  define();
  const host = document.createElement(TAG);
  host.dataset.panel = id;
  host.className = "dock-host";
  return host;
}

/** Returns keyboard focus to where it last was inside a panel, if it was ever inside. */
export function focusInside(host: HTMLElement | undefined): boolean {
  const last = (host as DockHost | undefined)?.lastFocused;
  if (!host || !last || !last.isConnected || !host.contains(last)) return false;
  last.focus({ preventScroll: true });
  return document.activeElement === last;
}

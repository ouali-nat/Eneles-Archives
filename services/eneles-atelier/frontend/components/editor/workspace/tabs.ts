import { isPanelId, type PanelId } from "./panels";

/** The width the "more tabs" button takes at the end of a strip whose tabs do not all fit. The button's own width (DockWorkspace) must match. */
export const OVERFLOW_BUTTON_WIDTH = 36;

/** On a tab that is not wholly inside its strip: it is not drawn, so no label is ever cut off mid-word; it is reached from the "more tabs" menu or with the arrow keys. */
const CLIPPED = "dock-tab-clipped";

/**
 * Lays out one group's tab strip and returns the panels whose tabs are not showing.
 *
 * A tab is always as wide as its label. When a group's tabs do not all fit, the strip is a window onto them: it starts exactly at a tab's edge, shows the tabs that fit whole, and leaves the rest out. The window moves to keep one tab in it: the one holding keyboard focus, or, when `reveal` is set, the tab in front. Otherwise it stays where the person scrolled it, moved to the nearest tab's edge.
 */
export function fitTabStrip(list: HTMLElement, reveal: boolean): PanelId[] {
  const header = list.closest<HTMLElement>(".dv-tabs-and-actions-container");
  const tabs = Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("dv-tab"));
  if (!header || tabs.length === 0) return [];

  const widths = tabs.map((tab) => tab.offsetWidth);
  const starts: number[] = [];
  let total = 0;
  for (const width of widths) {
    starts.push(total);
    total += width;
  }
  const end = (i: number) => starts[i] + widths[i];
  // Room at the strip's end, so the window can start at any tab, including the last.
  const pad = (px: number) => {
    const value = px > 0 ? `${Math.ceil(px)}px` : "";
    if (list.style.paddingRight !== value) list.style.paddingRight = value;
  };

  const full = header.clientWidth;
  if (total <= full) {
    pad(0);
    if (list.scrollLeft !== 0) list.scrollLeft = 0;
    for (const tab of tabs) tab.classList.remove(CLIPPED);
    return [];
  }

  const room = Math.max(0, full - OVERFLOW_BUTTON_WIDTH);
  const focused = tabs.findIndex((tab) => tab === document.activeElement);
  const front = tabs.findIndex((tab) => tab.classList.contains("dv-active-tab"));
  const keep = focused >= 0 ? focused : reveal ? front : -1;

  // Start at the tab edge nearest to where the strip is scrolled now.
  let first = 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < starts.length; i++) {
    const distance = Math.abs(starts[i] - list.scrollLeft);
    if (distance < nearest) {
      nearest = distance;
      first = i;
    }
  }
  if (keep >= 0) {
    if (keep < first) first = keep;
    while (first < keep && end(keep) - starts[first] > room) first++;
  }
  // Never leave room unused: bring earlier tabs back while everything from them to the last still fits.
  while (first > 0 && total - starts[first - 1] <= room) first--;

  const origin = starts[first];
  pad(origin - (total - room));
  if (Math.abs(list.scrollLeft - origin) >= 1) list.scrollLeft = origin;

  const hidden: PanelId[] = [];
  tabs.forEach((tab, i) => {
    // The first tab of the window shows even when the group is narrower than that one tab.
    const out = i !== first && (starts[i] < origin || end(i) > origin + room);
    tab.classList.toggle(CLIPPED, out);
    const id = tab.dataset.tabPanelId;
    if (out && isPanelId(id)) hidden.push(id);
  });
  return hidden;
}

/** While a strip is being scrolled, before it settles on a tab's edge: hide whatever is momentarily cut by either end. */
export function hideCutTabs(list: HTMLElement): void {
  const box = list.getBoundingClientRect();
  let shown = 0;
  for (const child of Array.from(list.children)) {
    if (!(child instanceof HTMLElement) || !child.classList.contains("dv-tab")) continue;
    const rect = child.getBoundingClientRect();
    const out = rect.left < box.left - 0.5 || rect.right > box.right + 0.5;
    child.classList.toggle(CLIPPED, out);
    if (!out) shown++;
  }
  // Never an empty strip.
  if (shown === 0) list.querySelector(".dv-tab")?.classList.remove(CLIPPED);
}

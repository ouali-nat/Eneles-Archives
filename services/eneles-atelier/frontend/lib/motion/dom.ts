/* DOM plumbing shared by motion components: reading durations from CSS tokens, and finding the scroller an element lives in. */

/* A duration token such as `--motion-fade-duration: 180ms` read from an element, in milliseconds. */
export function readMs(element: Element, token: string, fallback: number): number {
  const raw = getComputedStyle(element).getPropertyValue(token).trim();
  if (!raw) return fallback;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith("ms") ? value : raw.endsWith("s") ? value * 1000 : value;
}

/* The nearest ancestor that scrolls vertically, or null for the document. */
export function scrollParent(element: Element): HTMLElement | null {
  let node = element.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return node;
    node = node.parentElement;
  }
  return null;
}

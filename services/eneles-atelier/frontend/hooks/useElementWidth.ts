"use client";

import { useCallback, useEffect, useState } from "react";

/** The element's own width, measured as it attaches and kept current with a ResizeObserver. Attach the returned callback ref; it follows the element even when it mounts after the first render. */
export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  // Measured as the element attaches (during the commit, before the browser paints), so the first frame already lays out for the real width; waiting for the observer's first report drew one frame at 0, and a layout keyed on width (the dashboard's sidebar rail) visibly jumped.
  const ref = useCallback((el: T | null) => {
    setElement(el);
    if (el) setWidth(el.getBoundingClientRect().width);
  }, []);
  return [ref, width];
}

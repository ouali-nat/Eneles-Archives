import { useState } from "react";

/**
 * Run `reset` when `key` changes (a dialog opening, another item chosen).
 * It runs during render, which is how React resets state from a prop without
 * an extra render with the stale values.
 */
export function useResetWhen(key: unknown, reset: () => void) {
  const [previous, setPrevious] = useState(key);
  if (previous !== key) {
    setPrevious(key);
    reset();
  }
}

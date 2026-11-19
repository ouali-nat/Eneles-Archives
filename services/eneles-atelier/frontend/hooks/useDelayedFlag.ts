"use client";

import { useEffect, useState } from "react";

/**
 * True once `flag` has stayed true for `delay` ms. Loading skeletons wait for
 * it, so a fast response never flashes a placeholder.
 */
export function useDelayedFlag(flag: boolean, delay = 200): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!flag) return;
    const id = window.setTimeout(() => setShown(true), delay);
    return () => {
      window.clearTimeout(id);
      setShown(false);
    };
  }, [flag, delay]);
  return flag && shown;
}

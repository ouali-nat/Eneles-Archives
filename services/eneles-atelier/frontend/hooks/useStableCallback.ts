"use client";

import { useCallback, useInsertionEffect, useRef } from "react";

/**
 * A function whose identity never changes and that always runs the latest `fn`. For handlers handed to memoised children: a new arrow on every render would make them draw again on every keystroke. Not for calling during render, where it would run the previous render's `fn`.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  useInsertionEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type ResourceStatus = "idle" | "loading" | "error" | "ready";

/**
 * Loads one resource and keeps its status. `reload` refetches while the
 * previous data stays visible (refreshing never flashes back to loading).
 * A response that arrives after a newer request started is dropped.
 */
export function useResource<T>(load: (() => Promise<T>) | null, errorText: string) {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<ResourceStatus>(load ? "loading" : "idle");
  const request = useRef(0);
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(async () => {
    const fn = loadRef.current;
    if (!fn) return;
    const id = ++request.current;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    try {
      const value = await fn();
      if (id !== request.current) return;
      setData(value);
      setStatus("ready");
    } catch (err) {
      if (id !== request.current) return;
      console.error(errorText, err);
      setStatus("error");
    }
  }, [errorText]);

  const enabled = load !== null;
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  return { data, status, error: status === "error" ? errorText : undefined, reload };
}

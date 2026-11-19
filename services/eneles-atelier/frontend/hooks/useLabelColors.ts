"use client";

import { useCallback, useSyncExternalStore } from "react";

/*
 * Label colors, shared by every listing (projects, snips, PDFs). They are kept
 * in this browser under one key, the same key the listings used before, so
 * colors people already chose carry over.
 */
const KEY = "texer:tagColors";
const EMPTY: Record<string, string> = {};
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: Record<string, string> } = { raw: null, value: EMPTY };

function read(): Record<string, string> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cache.raw) return cache.value;
  let value = EMPTY;
  try {
    value = raw ? (JSON.parse(raw) as Record<string, string>) : EMPTY;
  } catch {
    value = EMPTY;
  }
  cache = { raw, value };
  return value;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useLabelColors() {
  const colors = useSyncExternalStore(subscribe, read, () => EMPTY);
  const setColor = useCallback((label: string, color: string) => {
    const next = { ...read(), [label]: color };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Unsaved: the color still shows until reload.
    }
    cache = { raw: JSON.stringify(next), value: next };
    listeners.forEach((l) => l());
  }, []);
  return { colors, setColor };
}

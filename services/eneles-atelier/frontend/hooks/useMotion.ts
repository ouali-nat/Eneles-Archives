"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  MOTION_STORAGE_KEY,
  readMotionPreference,
  resolveMotion,
  type MotionLevel,
  type MotionPreference,
} from "@/lib/appearance";

/*
 * The motion level as one tiny store: <html data-motion> is the source of
 * truth (the boot script sets it before paint), so every hook instance reads
 * the same value and re-renders when it changes.
 */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getLevel = (): MotionLevel =>
  (document.documentElement.getAttribute("data-motion") as MotionLevel | null) ?? "full";
const getServerLevel = (): MotionLevel => "full";

function apply(preference: MotionPreference) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.setAttribute("data-motion", resolveMotion(preference, reduced));
  notify();
}

/** The resolved motion level, and the stored preference with its setter. */
export function useMotion() {
  const level = useSyncExternalStore(subscribe, getLevel, getServerLevel);
  const preference = useSyncExternalStore(subscribe, readMotionPreference, () => "system" as MotionPreference);

  // A "system" preference follows the OS setting while the page is open.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      if (readMotionPreference() === "system") apply("system");
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const setPreference = useCallback((next: MotionPreference) => {
    try {
      window.localStorage.setItem(MOTION_STORAGE_KEY, next);
    } catch {
      // Unsaved preferences still apply for this page.
    }
    apply(next);
  }, []);

  return { level, preference, setPreference, animates: level === "full" };
}

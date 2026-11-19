/**
 * Appearance preferences that apply before React renders: the motion level.
 * (The color mode is next-themes' job; it writes data-mode on the root.)
 *
 * The motion level is stored per browser. "system" follows the operating
 * system's reduced-motion setting; the resolved level (full | reduced | off)
 * is written to <html data-motion>, which the stylesheet and the motion-*
 * variants read.
 */

export type MotionPreference = "system" | "full" | "reduced" | "off";
export type MotionLevel = Exclude<MotionPreference, "system">;

export const MOTION_STORAGE_KEY = "texer-motion";
export const MOTION_PREFERENCES: MotionPreference[] = ["system", "full", "reduced", "off"];

export function resolveMotion(preference: MotionPreference, systemReduced: boolean): MotionLevel {
  if (preference === "system") return systemReduced ? "reduced" : "full";
  return preference;
}

export function readMotionPreference(): MotionPreference {
  try {
    const stored = window.localStorage.getItem(MOTION_STORAGE_KEY);
    if (stored && (MOTION_PREFERENCES as string[]).includes(stored)) return stored as MotionPreference;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies): fall back to the system.
  }
  return "system";
}

/**
 * Inline script for <head>: applies the stored level before first paint so a
 * reload never flashes animation the reader turned off. Kept dependency-free.
 */
export const motionBootScript = `(function(){try{var k=${JSON.stringify(MOTION_STORAGE_KEY)};var p=localStorage.getItem(k)||"system";var r=window.matchMedia("(prefers-reduced-motion: reduce)").matches;var l=p==="system"?(r?"reduced":"full"):p;if(["full","reduced","off"].indexOf(l)<0)l="full";document.documentElement.setAttribute("data-motion",l);}catch(e){document.documentElement.setAttribute("data-motion","full");}})();`;

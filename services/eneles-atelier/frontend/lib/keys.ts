"use client";

import { useSyncExternalStore } from "react";

/*
 * Keyboard shortcuts are written once in a neutral notation ("Mod+K", "Mod+Shift+P") and shown for the platform in use: "⌘K" on Apple devices, "Ctrl K" on Windows, Linux, and everything else.
 */

export type Platform = "apple" | "other";

function detect(): Platform {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const source = `${data?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /mac|iphone|ipad|ipod/i.test(source) ? "apple" : "other";
}

const noSubscription = () => () => {};

/**
 * The platform, or null while it is not known yet (on the server, and in the first render in the browser, which must match the server's). A hint drawn from it stays hidden while it is null, so an Apple device never shows "Ctrl K" for a frame and the page never hydrates with different text.
 */
export function usePlatform(): Platform | null {
  return useSyncExternalStore(noSubscription, detect, () => null);
}

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Mod"] as const;
type Modifier = (typeof MODIFIERS)[number];
const APPLE_ORDER: Modifier[] = ["Ctrl", "Alt", "Shift", "Mod"];
const OTHER_ORDER: Modifier[] = ["Mod", "Ctrl", "Alt", "Shift"];
const APPLE_MOD: Record<Modifier, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Mod: "⌘" };
const OTHER_MOD: Record<Modifier, string> = { Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Mod: "Ctrl" };
const isModifier = (part: string): part is Modifier => (MODIFIERS as readonly string[]).includes(part);

/** The labels to show for a shortcut: "Mod+Shift+P" is ["⇧", "⌘", "P"] on Apple devices and ["Ctrl", "Shift", "P"] elsewhere. */
export function shortcutKeys(shortcut: string, platform: Platform): string[] {
  const parts = shortcut.split("+").map((part) => part.trim()).filter(Boolean);
  const present = parts.filter(isModifier);
  const order = platform === "apple" ? APPLE_ORDER : OTHER_ORDER;
  const names = platform === "apple" ? APPLE_MOD : OTHER_MOD;
  return [...order.filter((m) => present.includes(m)).map((m) => names[m]), ...parts.filter((part) => !isModifier(part))];
}

/** One string for a hint or a tooltip: "⌘K" on Apple devices, "Ctrl K" elsewhere. */
export function formatShortcut(shortcut: string, platform: Platform): string {
  return shortcutKeys(shortcut, platform).join(platform === "apple" ? "" : " ");
}

/** The shortcut as `aria-keyshortcuts` takes it: "Meta+K" on Apple devices, "Control+K" elsewhere. */
export function ariaShortcut(shortcut: string, platform: Platform | null): string {
  return shortcut
    .split("+")
    .map((part) => part.trim())
    .map((part) => (part === "Mod" ? (platform === "apple" ? "Meta" : "Control") : part === "Ctrl" ? "Control" : part))
    .join("+");
}

/** True for the key event of a shortcut such as "Mod+K" (Mod is ⌘ on Apple devices and Ctrl elsewhere; either is accepted, so a keyboard of the other kind still works). */
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+").map((part) => part.trim());
  const key = parts.filter((part) => !isModifier(part))[0]?.toLowerCase();
  if (!key || event.key.toLowerCase() !== key) return false;
  const wantsMod = parts.includes("Mod");
  if (wantsMod !== (event.metaKey || event.ctrlKey)) return false;
  return parts.includes("Shift") === event.shiftKey && parts.includes("Alt") === event.altKey;
}

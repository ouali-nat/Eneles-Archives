// Saved snippets and box presets, kept in localStorage next to history.

import { BoxPreset, SavedSnippet, Workspace } from "./types";

const STORAGE_KEY = "texer-ppt.library.v1";
const MAX_SNIPPETS = 100;

interface Library {
  snippets: SavedSnippet[];
  boxPresets: BoxPreset[];
}

function load(): Library {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      snippets: Array.isArray(raw.snippets)
        ? raw.snippets.filter((s: SavedSnippet) => s && typeof s.source === "string" && typeof s.label === "string")
        : [],
      boxPresets: Array.isArray(raw.boxPresets)
        ? raw.boxPresets.filter((p: BoxPreset) => p && typeof p.name === "string")
        : [],
    };
  } catch {
    return { snippets: [], boxPresets: [] };
  }
}

function save(lib: Library): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
  } catch {
    /* best-effort */
  }
}

export function loadSnippets(): SavedSnippet[] {
  return load().snippets;
}

/** Adds a snippet, or overwrites the one with the same label. */
export function saveSnippet(label: string, workspace: Workspace, source: string): SavedSnippet[] {
  const lib = load();
  lib.snippets = [
    { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label, workspace, source },
    ...lib.snippets.filter((s) => s.label !== label),
  ].slice(0, MAX_SNIPPETS);
  save(lib);
  return lib.snippets;
}

export function removeSnippet(id: string): SavedSnippet[] {
  const lib = load();
  lib.snippets = lib.snippets.filter((s) => s.id !== id);
  save(lib);
  return lib.snippets;
}

export function loadBoxPresets(): BoxPreset[] {
  return load().boxPresets;
}

/** Same name overwrites. */
export function saveBoxPreset(preset: BoxPreset): BoxPreset[] {
  const lib = load();
  lib.boxPresets = [...lib.boxPresets.filter((p) => p.name !== preset.name), preset];
  save(lib);
  return lib.boxPresets;
}

export function removeBoxPreset(name: string): BoxPreset[] {
  const lib = load();
  lib.boxPresets = lib.boxPresets.filter((p) => p.name !== name);
  save(lib);
  return lib.boxPresets;
}

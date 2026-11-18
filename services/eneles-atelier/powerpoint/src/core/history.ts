import { HistoryEntry, RenderMode } from "./types";

const STORAGE_KEY = "texer-ppt.history.v1";
const MAX_ENTRIES = 30;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/**
 * Records a render. De-dupes on exact source+mode match (bumps it to the
 * top instead of creating a second entry). Returns the updated list;
 * the new/bumped entry is always at index 0, so callers that need its id
 * (e.g. to save the rendered file alongside it) can just read result[0].
 */
export function recordHistory(source: string, mode: RenderMode): HistoryEntry[] {
  const entries = loadHistory();
  const existingIndex = entries.findIndex((e) => e.source === source && e.mode === mode);

  let entry: HistoryEntry;
  if (existingIndex >= 0) {
    [entry] = entries.splice(existingIndex, 1);
    entry.createdAt = Date.now();
  } else {
    entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source,
      mode,
      createdAt: Date.now(),
    };
  }

  entries.unshift(entry);
  const trimmed = entries.slice(0, MAX_ENTRIES);
  saveHistory(trimmed);
  return trimmed;
}

export function removeHistoryEntry(id: string): HistoryEntry[] {
  const entries = loadHistory().filter((e) => e.id !== id);
  saveHistory(entries);
  return entries;
}

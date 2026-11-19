"use client";

import { useSyncExternalStore } from "react";

/**
 * The lines selected in the code editor, for the assistant's context row. A tiny store fed by the editor's cursor events, so the composer can show "Lines 12 to 18" without the whole editor screen re-rendering on every cursor move. The selected text itself is read from the editor when a prompt is sent.
 */
export interface EditorSelection {
  fromLine: number;
  toLine: number;
}

let current: EditorSelection | null = null;
const listeners = new Set<() => void>();

export function noteEditorSelection(selection: { fromLine: number; toLine: number; fromCh?: number; toCh?: number } | null | undefined) {
  // A selection that ends at the very start of a line does not take that line.
  const next = selection ? { fromLine: selection.fromLine, toLine: selection.toCh === 0 && selection.toLine > selection.fromLine ? selection.toLine - 1 : selection.toLine } : null;
  if (next === current || (next && current && next.fromLine === current.fromLine && next.toLine === current.toLine)) return;
  current = next;
  listeners.forEach((l) => l());
}

export function useEditorSelection(): EditorSelection | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}

export const selectionLabel = (s: EditorSelection) => (s.fromLine === s.toLine ? `Line ${s.fromLine}` : `Lines ${s.fromLine} to ${s.toLine}`);

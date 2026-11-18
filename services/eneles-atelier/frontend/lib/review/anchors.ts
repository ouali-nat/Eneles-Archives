/**
 * Positions that follow the text. A Yjs relative position names a character
 * rather than an offset, so it stays put as people type before it. They are
 * stored as base64 so the server can keep them as plain strings.
 */
import * as Y from "yjs";

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * An anchor at `index`. `assoc` 0 sticks to the character after the index
 * (a range's start); -1 to the one before it (a range's end), so text typed
 * right at either edge falls outside the range.
 */
export function anchorAt(ytext: Y.Text, index: number, assoc: 0 | -1): string {
  return toBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, index, assoc)));
}

/** Where an anchor is now, or null when it belongs to another text or cannot be read. */
export function resolveAnchor(ytext: Y.Text, anchor: string | null | undefined): number | null {
  if (!anchor || !ytext.doc) return null;
  try {
    const abs = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromBase64(anchor)), ytext.doc);
    if (!abs || abs.type !== ytext) return null;
    return abs.index;
  } catch {
    return null;
  }
}

/** The name a top-level Y.Text was created under: the file's path here. */
export function nameOf(ytext: Y.Text): string | null {
  const doc = ytext.doc;
  if (!doc) return null;
  for (const [name, type] of doc.share) if ((type as unknown) === ytext) return name;
  return null;
}

/** The map that holds a file's suggested changes, next to its text in the same document. */
export function suggestionsMap(doc: Y.Doc, path: string): Y.Map<unknown> {
  return doc.getMap(`tc:${path}`);
}

/**
 * A commented range found again: by its anchors when the live document is
 * there, otherwise by looking for the quoted text nearest where it was.
 */
export function findRange(
  text: string,
  ytext: Y.Text | null,
  anchor: { anchorStart?: string | null; anchorEnd?: string | null; quote: string; offset: number },
): { from: number; to: number } | null {
  if (ytext) {
    const from = resolveAnchor(ytext, anchor.anchorStart);
    const to = resolveAnchor(ytext, anchor.anchorEnd);
    if (from !== null && to !== null && to > from && to <= text.length) return { from, to };
  }
  if (!anchor.quote) return null;
  let best = -1;
  let at = text.indexOf(anchor.quote);
  while (at !== -1) {
    if (best === -1 || Math.abs(at - anchor.offset) < Math.abs(best - anchor.offset)) best = at;
    at = text.indexOf(anchor.quote, at + 1);
  }
  return best === -1 ? null : { from: best, to: best + anchor.quote.length };
}

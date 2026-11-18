/**
 * The few things line jumping needs to pass between the editor and the PDF preview without going through the component tree.
 *
 * The two are siblings several components apart, and the editor is torn down and rebuilt whenever another file is opened. Three things have to survive that: where the cursor is (so the preview's button and the editor's shortcut can ask for it), the exact place a click in the PDF resolved to (so the editor that mounts for the target file can select it, however long mounting takes), and the text the last compile was run on. Each is a small module-level slot, because there is one editor and one preview on a page.
 *
 * The layout can wire the same things explicitly: see `LatexEditorHandle.revealSourcePosition`, `LatexEditorHandle.getCursorPosition`, and `PdfPreviewHandle.showSourcePosition`.
 */
import type { SourceJump } from "./synctex";

export interface EditorCursor {
  /** Project path of the file in the editor. */
  path: string;
  /** 1-based line and 0-based column of the cursor. */
  line: number;
  column: number;
  /** The whole file as it is in the editor right now. */
  text: string;
}

type CursorReader = () => EditorCursor | null;
let cursorReader: CursorReader | null = null;

/** The mounted editor says how to read its cursor. Returns the function that withdraws it. */
export function provideEditorCursor(reader: CursorReader): () => void {
  cursorReader = reader;
  return () => {
    if (cursorReader === reader) cursorReader = null;
  };
}

/** Where the cursor is now, or null when no editor is open (an image is showing, say). */
export function readEditorCursor(): EditorCursor | null {
  try {
    return cursorReader ? cursorReader() : null;
  } catch {
    return null;
  }
}

type ShowInPdfListener = (cursor: EditorCursor) => void;
const showInPdfListeners = new Set<ShowInPdfListener>();

/** The PDF preview listens for "show this source position". */
export function onShowInPdf(listener: ShowInPdfListener): () => void {
  showInPdfListeners.add(listener);
  return () => {
    showInPdfListeners.delete(listener);
  };
}

/** Ask the preview to show a source position (the cursor's by default). False when there is no preview or no cursor to show. */
export function showInPdf(cursor: EditorCursor | null = readEditorCursor()): boolean {
  if (!cursor || showInPdfListeners.size === 0) return false;
  for (const listener of showInPdfListeners) listener(cursor);
  return true;
}

let pendingJump: { jump: SourceJump; at: number } | null = null;

/** The preview resolved a click: whichever editor ends up showing that file should select this exact place. */
export function announceSourceJump(jump: SourceJump): void {
  pendingJump = { jump, at: Date.now() };
}

/** The jump waiting for `path`, if it is recent. It stays until it expires, so the editor that mounts for the file and the layout's own call can both act on it and agree. */
export function pendingSourceJump(path: string | null, maxAgeMs = 5000): SourceJump | null {
  if (!pendingJump || path === null) return null;
  if (Date.now() - pendingJump.at > maxAgeMs) {
    pendingJump = null;
    return null;
  }
  return pendingJump.jump.path === path ? pendingJump.jump : null;
}

let compiled: { synctex: string; sources: Record<string, string> } | null = null;

/** The text of each file as the compile that produced `synctex` read it. */
export function rememberCompiledSources(synctex: string, sources: Record<string, string> | null | undefined): void {
  compiled = sources ? { synctex, sources } : null;
}

export function compiledSourcesOf(synctex: string | null | undefined): Record<string, string> | null {
  return compiled && compiled.synctex === synctex ? compiled.sources : null;
}

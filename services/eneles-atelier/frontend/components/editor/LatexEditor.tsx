"use client";

/**
 * CodeMirror 6 LaTeX editor with real-time collaboration support:
 *   1. Create EditorView once on mount
 *   2. Remote cursors rendered as decorations (colored cursor lines + name labels)
 *   3. Cursor/selection changes emitted via callback for WebSocket broadcast
 *   4. Theme swappable at runtime via Compartment
 *   5. Inline diff highlighting (Cursor-style: green added lines, red removed ghost blocks)
 */

import {
  memo,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  EditorState,
  EditorSelection,
  Annotation,
  Compartment,
  StateField,
  StateEffect,
  RangeSetBuilder,
  Transaction,
  type Text,
} from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  Decoration,
  DecorationSet,
  WidgetType,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  insertNewlineAndIndent,
  redo,
} from "@codemirror/commands";
import {
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
  getIndentUnit,
  indentUnit,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { forceLinting, lintKeymap, linter, type Diagnostic } from "@codemirror/lint";
import { autocompletion, acceptCompletion } from "@codemirror/autocomplete";
import { latexCompletionSource } from "@/lib/latex/autocomplete";
import { loadThemeExtension } from "@/lib/editor/themes";
import { thry } from "@/lib/editor/thry-theme";
import { latex, latexLinter } from "codemirror-lang-latex";
import { spellCheck } from "@/lib/spell/extension";
import type * as Y from "yjs";
import { trackChanges, settleSuggestions, suggestEdit, type Suggestion } from "@/lib/review/track-changes";
import { commentHighlights, commentRange, isUserSelection, rangeGeometry, setCommentMarks, setDraftComment, type RangeGeometry } from "@/lib/review/comment-highlights";
import { anchorAt, findRange } from "@/lib/review/anchors";
import { referenceCompletions, type ProjectIndexSource } from "@/lib/latex/references";
import { keepPlace, visualMode } from "@/lib/editor/visual";
import { pendingSourceJump, provideEditorCursor, showInPdf, type EditorCursor } from "@/lib/synctex-bridge";
import "katex/dist/katex.min.css";
import type { CursorUpdate } from "@/hooks/useCollaboration";
import {
  getLatexIndentForNewLine,
  rescaleIndent,
  applyIndentToInsertedText,
} from "@/lib/latex/indent";

// ─── Inline review of the assistant's proposed changes ───

/** The assistant's proposed changes placed on the text in the editor (lib/ai-diff.ts): each replaces `removeCount` lines from line index `start` (0-based) with `added`, or conflicts with an edit made since it was proposed. */
export interface DiffHighlights {
  hunks: Array<{ id: string; start: number; removeCount: number; added: string[]; state: "clean" | "conflict" }>;
}

// ─── External sync annotation (marks dispatches from remote collaboration) ───
const isExternalSync = Annotation.define<boolean>();

/**
 * Compute the minimal single-range change between two strings.
 * Finds the common prefix and suffix so CodeMirror can map cursors/selections
 * through the change instead of resetting them to position 0.
 */
function computeMinimalChange(
  oldStr: string,
  newStr: string,
): { from: number; to: number; insert: string } | null {
  if (oldStr === newStr) return null;

  // Common prefix
  let prefixLen = 0;
  const minLen = Math.min(oldStr.length, newStr.length);
  while (
    prefixLen < minLen &&
    oldStr.charCodeAt(prefixLen) === newStr.charCodeAt(prefixLen)
  ) {
    prefixLen++;
  }

  // Common suffix (don't overlap with prefix)
  let suffixLen = 0;
  const maxSuffix = Math.min(
    oldStr.length - prefixLen,
    newStr.length - prefixLen,
  );
  while (
    suffixLen < maxSuffix &&
    oldStr.charCodeAt(oldStr.length - 1 - suffixLen) ===
      newStr.charCodeAt(newStr.length - 1 - suffixLen)
  ) {
    suffixLen++;
  }

  return {
    from: prefixLen,
    to: oldStr.length - suffixLen,
    insert: newStr.slice(prefixLen, newStr.length - suffixLen),
  };
}

// ─── Indent-aware line wrapping ─────────────────────────────────────────────
// For each visible line, measure its leading whitespace and apply matching
// padding-left + negative text-indent so that soft-wrapped continuation text
// aligns with the content start rather than flush against the gutter.

function computeIndentWraps(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      let chars = 0;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === " ") chars++;
        else if (text[i] === "\t") chars += view.state.tabSize;
        else break;
      }
      if (chars > 0) {
        builder.add(
          line.from,
          line.from,
          Decoration.line({
            attributes: {
              style: `padding-left: ${chars}ch; text-indent: -${chars}ch;`,
            },
          }),
        );
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const indentWrappingPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = computeIndentWraps(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = computeIndentWraps(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ─── Proposed lines and their Accept and Reject, under the lines they replace ───
let _hunkActionCallback: ((hunkId: string, action: "accept" | "reject") => void) | null = null;

function reviewButton(label: string, kind: "accept" | "reject", hunkId: string, title: string, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `cm-diff-action cm-diff-${kind}`;
  button.textContent = label;
  button.title = title;
  button.disabled = disabled;
  button.setAttribute("aria-label", title);
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) _hunkActionCallback?.(hunkId, kind);
  });
  return button;
}

class ProposedBlockWidget extends WidgetType {
  constructor(
    readonly hunkId: string,
    readonly lines: string[],
    readonly removeCount: number,
    readonly conflict: boolean,
  ) {
    super();
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = this.conflict ? "cm-diff-proposed cm-diff-proposed-conflict" : "cm-diff-proposed";
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("aria-label", this.conflict ? "A proposed change that conflicts with a newer edit" : `Proposed: ${this.lines.length} line${this.lines.length === 1 ? "" : "s"} in place of ${this.removeCount}`);
    for (const line of this.lines) {
      const el = document.createElement("div");
      el.className = "cm-diff-added-line";
      // Tabs and spaces kept as typed; an empty line still takes its height.
      el.textContent = line.replace(/\r?\n$/, "") || "\u200b";
      wrapper.appendChild(el);
    }
    const bar = document.createElement("div");
    bar.className = "cm-diff-bar";
    const note = document.createElement("span");
    note.className = "cm-diff-note";
    note.textContent = this.conflict ? "Edited since Axya proposed this: accepting would write over the newer text" : this.lines.length && this.removeCount ? "Axya proposes this in place of the lines above" : this.lines.length ? "Axya proposes adding this" : `Axya proposes removing ${this.removeCount === 1 ? "the line" : "the lines"} above`;
    bar.appendChild(note);
    bar.appendChild(reviewButton("Reject", "reject", this.hunkId, "Reject this change"));
    bar.appendChild(reviewButton("Accept", "accept", this.hunkId, this.conflict ? "This change conflicts with a newer edit; ask Axya again" : "Accept this change", this.conflict));
    wrapper.appendChild(bar);
    return wrapper;
  }

  eq(other: ProposedBlockWidget) {
    return this.hunkId === other.hunkId && this.conflict === other.conflict && this.removeCount === other.removeCount && this.lines.join("\n") === other.lines.join("\n");
  }

  ignoreEvent() {
    return false;
  }
}

/** Builds the review's decorations: the lines a change would remove are struck through in red, and its new lines follow them in green with Accept and Reject. */
function reviewDecorations(doc: Text, highlights: DiffHighlights): DecorationSet {
  const decorations: { from: number; to: number; dec: Decoration }[] = [];
  const lineCount = doc.lines;
  for (const hunk of highlights.hunks) {
    const first = hunk.start + 1;
    const last = hunk.start + hunk.removeCount;
    for (let n = first; n <= last && n <= lineCount; n++) {
      const line = doc.line(n);
      decorations.push({ from: line.from, to: line.from, dec: Decoration.line({ class: hunk.state === "conflict" ? "cm-diff-removed cm-diff-conflict" : "cm-diff-removed" }) });
    }
    const widget = new ProposedBlockWidget(hunk.id, hunk.added, hunk.removeCount, hunk.state === "conflict");
    if (hunk.removeCount > 0 && last <= lineCount) {
      const pos = doc.line(last).to;
      decorations.push({ from: pos, to: pos, dec: Decoration.widget({ widget, block: true, side: 1 }) });
    } else if (hunk.start === 0 || lineCount === 0) {
      decorations.push({ from: 0, to: 0, dec: Decoration.widget({ widget, block: true, side: -1 }) });
    } else {
      const pos = doc.line(Math.min(hunk.start, lineCount)).to;
      decorations.push({ from: pos, to: pos, dec: Decoration.widget({ widget, block: true, side: 1 }) });
    }
  }
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const d of decorations) builder.add(d.from, d.to, d.dec);
  return builder.finish();
}

const setDiffHighlights = StateEffect.define<DiffHighlights | null>();
const diffHighlightsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, tr) => {
    for (const e of tr.effects) {
      if (e.is(setDiffHighlights)) return e.value ? reviewDecorations(tr.state.doc, e.value) : Decoration.none;
    }
    // Typing moves the marks with the text until the review is placed again.
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function latexInsertNewlineSmart(
  view: EditorView,
  tabSize: number = 4,
): boolean {
  const { state } = view;
  const pos = state.selection.main.head;
  const doc = state.doc.toString();
  const insertAfterNewline = getLatexIndentForNewLine(doc, pos, tabSize);
  view.dispatch({
    changes: { from: pos, to: pos, insert: "\n" + insertAfterNewline },
    selection: { anchor: pos + insertAfterNewline.length + 1 },
  });
  return true;
}

// ─── Remote Cursor Types ───

interface RemoteCursor {
  userId: number;
  name: string;
  color: string;
  line: number;
  ch: number;
  selection?: {
    fromLine: number;
    fromCh: number;
    toLine: number;
    toCh: number;
  } | null;
}

// ─── Cursor Widget ───

class CursorWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly color: string,
  ) {
    super();
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-remote-cursor";
    wrapper.setAttribute("aria-hidden", "true");

    // Cursor line
    const line = document.createElement("span");
    line.className = "cm-remote-cursor-line";
    line.style.borderLeft = `2px solid ${this.color}`;
    line.style.marginLeft = "-1px";
    line.style.display = "inline-block";
    line.style.width = "0";
    line.style.height = "1.2em";
    line.style.verticalAlign = "text-bottom";
    line.style.position = "relative";

    // Name label
    const label = document.createElement("span");
    label.className = "cm-remote-cursor-label";
    label.textContent = this.name;
    label.style.position = "absolute";
    label.style.bottom = "100%";
    label.style.left = "-1px";
    label.style.padding = "1px 4px";
    label.style.borderRadius = "3px 3px 3px 0";
    label.style.fontSize = "10px";
    label.style.fontFamily = "system-ui, sans-serif";
    label.style.fontWeight = "600";
    label.style.lineHeight = "1.4";
    label.style.color = "#fff";
    label.style.backgroundColor = this.color;
    label.style.whiteSpace = "nowrap";
    label.style.pointerEvents = "none";
    label.style.zIndex = "10";
    label.style.opacity = "0.9";

    line.appendChild(label);
    wrapper.appendChild(line);
    return wrapper;
  }

  eq(other: CursorWidget) {
    return this.name === other.name && this.color === other.color;
  }

  ignoreEvent() {
    return true;
  }
}

// ─── StateEffect for updating remote cursors ───

const setRemoteCursors = StateEffect.define<RemoteCursor[]>();

const remoteCursorsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    // If there's a remote cursor update effect, rebuild decorations
    for (const effect of tr.effects) {
      if (effect.is(setRemoteCursors)) {
        const cursors = effect.value;
        const builder = new RangeSetBuilder<Decoration>();
        const doc = tr.state.doc;
        const decorationsArr: { from: number; to: number; dec: Decoration }[] =
          [];

        for (const cursor of cursors) {
          // Clamp to doc bounds
          const lineCount = doc.lines;
          const line = Math.min(Math.max(cursor.line, 1), lineCount);
          const lineObj = doc.line(line);
          const ch = Math.min(
            Math.max(cursor.ch, 0),
            lineObj.to - lineObj.from,
          );
          const pos = lineObj.from + ch;

          // Cursor widget decoration
          decorationsArr.push({
            from: pos,
            to: pos,
            dec: Decoration.widget({
              widget: new CursorWidget(cursor.name, cursor.color),
              side: 1,
            }),
          });

          // Selection highlight decoration
          if (cursor.selection) {
            const fromLine = Math.min(
              Math.max(cursor.selection.fromLine, 1),
              lineCount,
            );
            const toLine = Math.min(
              Math.max(cursor.selection.toLine, 1),
              lineCount,
            );
            const fromLineObj = doc.line(fromLine);
            const toLineObj = doc.line(toLine);
            const fromCh = Math.min(
              Math.max(cursor.selection.fromCh, 0),
              fromLineObj.to - fromLineObj.from,
            );
            const toCh = Math.min(
              Math.max(cursor.selection.toCh, 0),
              toLineObj.to - toLineObj.from,
            );
            const fromPos = fromLineObj.from + fromCh;
            const toPos = toLineObj.from + toCh;

            if (fromPos < toPos) {
              decorationsArr.push({
                from: fromPos,
                to: toPos,
                dec: Decoration.mark({
                  class: "cm-remote-selection",
                  attributes: {
                    style: `background-color: ${cursor.color}20; border-bottom: 2px solid ${cursor.color}30;`,
                  },
                }),
              });
            }
          }
        }

        // Sort by from position (required by RangeSetBuilder)
        decorationsArr.sort((a, b) => a.from - b.from || a.to - b.to);
        for (const d of decorationsArr) {
          builder.add(d.from, d.to, d.dec);
        }
        return builder.finish();
      }
    }

    // Map through document changes
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ─── Editor Props ───

interface LatexEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  onCompile?: () => void;
  themeId?: string;
  className?: string;
  readOnly?: boolean;
  /** Called when cursor/selection changes, for WebSocket emission */
  onCursorActivity?: (
    line: number,
    ch: number,
    selection?: {
      fromLine: number;
      fromCh: number;
      toLine: number;
      toCh: number;
    },
  ) => void;
  /** Subscribe to remote cursor updates */
  onCursorUpdateSubscribe?: (
    callback: (update: CursorUpdate) => void,
  ) => () => void;
  /** Current remote users in the same file */
  remoteCursors?: RemoteCursor[];
  /** When true, Enter respects \begin...\end nesting and adds \item in list envs */
  autoIndent?: boolean;
  /** When provided, editor initializes with `from` then applies `to` as an undoable step (e.g. after AI Accept) */
  initialUndoStep?: { from: string; to: string };
  /** Called after initialUndoStep has been applied (so parent can clear it) */
  onInitialUndoStepApplied?: () => void;
  /** Cursor-style diff highlights: green added lines + red removed ghost blocks */
  diffHighlights?: DiffHighlights | null;
  /** Called when Accept or Reject is pressed on one proposed change. */
  onHunkAction?: (hunkId: string, action: "accept" | "reject") => void;
  /** Font size in pixels */
  fontSize?: number;
  /** The code font from Settings ("JetBrains Mono", "Fira Code", …); the visual mode keeps its own. */
  fontFamily?: string;
  /** Line height multiplier or keyword ("compact" | "normal" | "wide") */
  lineHeight?: string;
  /** Spaces per indent / tab (2 or 4, default 4) */
  tabSize?: number;
  /** Whether this file is the project's main document (suppresses "Missing document environment" lint for non-main files) */
  isMainFile?: boolean;
  /**
   * Yjs CodeMirror extension (from y-codemirror.next).
   * When provided, Yjs handles ALL content sync: the value-based useEffect
   * is skipped, onChange is not fired for Yjs-managed edits, and remote
   * cursors are rendered by yCollab instead of the manual remoteCursors system.
   */
  yjsExtension?: import("@codemirror/state").Extension | null;
  /**
   * The Y.Text bound to the active file. Needed so that, when yCollab binds,
   * the editor document can be reset to match the Y.Text's current content
   * (preventing the doubling that occurs when the Y.Text observer inserts its
   * content on top of the editor's existing `doc`).
   */
  yjsText?: { toString(): string } | null;
  /**
   * Per-file editor view state to restore on mount (selection + scroll). The
   * parent caches this per file so switching files and back keeps the cursor
   * and scroll position.
   */
  initialViewState?: { selection: unknown; scrollTop: number } | null;
  /** Called on unmount with the current view state so the parent can cache it. */
  onSaveViewState?: (state: { selection: unknown; scrollTop: number }) => void;
  /** Suggest completions while typing. Off: Ctrl+Space still asks for them. */
  autoComplete?: boolean;
  /** Close brackets, braces, and quotes as they are typed. */
  autoCloseBrackets?: boolean;
  /** Underline LaTeX syntax problems. */
  codeCheck?: boolean;
  /** Dictionary folder for spell checking ("en", "fr"…), or null for none. */
  spellLang?: string | null;
  /** The person's own dictionary. */
  personalWords?: string[];
  /** Saves a word to the person's dictionary. */
  onAddWord?: (word: string) => void;
  /** Suggested changes and comments. Needs the live document. */
  review?: ReviewProps | null;
  /** The project's other files, for \cite and \ref completion. */
  projectIndex?: ProjectIndexSource | null;
  /** Draw the markup (headings, emphasis, math, images) instead of showing it. */
  visual?: boolean;
  /** Where an included image can be shown from, or null. */
  imageUrl?: (path: string) => string | null;
  /** Opens a project file by path (an \input or \bibliography row in visual mode). */
  onOpenFile?: (path: string) => void;
  /** Project path of the file being edited, for jumping between the source and the PDF. Falls back to `projectIndex.activePath()`. */
  filePath?: string | null;
  /** What the last compile found in this file, marked at its lines (the desktop app, which compiles a folder on the computer). Left out, nothing is marked. */
  problems?: CompileProblem[] | null;
}

/** A compile's complaint about one line of the file being edited. */
export interface CompileProblem {
  line: number;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface ReviewProps {
  suggesting: boolean;
  user: { id: number; name: string };
  onSuggestionsChange?: (suggestions: Suggestion[]) => void;
  comments?: {
    id: number;
    anchorStart: string | null;
    anchorEnd: string | null;
    quote: string;
    offset: number;
    /** The highlight's hue (lib/review/hues.ts). */
    hue?: string | null;
  }[];
  activeCommentId?: number | null;
  onCommentClick?: (id: number) => void;
  /** Mod+Alt+M in the editor: comment on the selection. */
  onCommentShortcut?: () => void;
  /** The selection or the editor's focus changed, so a "Comment" button beside the selection can follow it. */
  onSelectionChange?: () => void;
}

/** What a new comment is attached to. */
export interface CommentTarget {
  from: number;
  to: number;
  quote: string;
  anchorStart: string | null;
  anchorEnd: string | null;
}

export interface LatexEditorHandle {
  insertAtCursor: (text: string, applyIndent?: boolean) => void;
  /** Insert a snippet (block text) at cursor without indentation */
  insertSnippet: (text: string) => void;
  /** Get viewport coordinates for the cursor (for positioning dropdowns) */
  getCursorCoords: () => { left: number; top: number; bottom: number } | null;
  /** Focus the editor */
  focus: () => void;
  /** Focus editor and scroll to line (1-based) */
  gotoLine: (line: number) => void;
  /**
   * Focus editor, scroll to a 1-based line, and place the cursor on `word`.
   * Searches the target line first, then a small window around it, which also
   * corrects ±1 line drift from SyncTeX. Falls back to the line start.
   */
  gotoLineWord: (line: number, word?: string) => void;
  /** Replace the entire document content (e.g. history restore) */
  setValue: (content: string) => void;
  /** Get the current document content directly from CodeMirror */
  getContent: () => string;
  /** The selected text and its anchors, for a new comment; null without a selection. */
  getCommentTarget: () => CommentTarget | null;
  /** Accept or reject suggestions; returns how many. */
  settleSuggestions: (ids: string[] | "all", action: "accept" | "reject") => number;
  /** The text under the draft highlight (the passage a comment or a suggestion is being written on); null without one. */
  getDraftText: () => string | null;
  /** Replace the passage under the draft highlight with `text`, as a suggestion the others accept or reject. Only the part that differs is changed. False when there is nothing to change or the file is not live. */
  suggestReplacement: (text: string) => boolean;
  /** Select and scroll to a range. */
  revealRange: (from: number, to: number) => void;
  /** Select and scroll to a comment's text; false when it cannot be found. */
  revealComment: (id: number) => boolean;
  /** Where a comment's highlight, the draft comment's, or the selection is on screen; null when it is not drawn, or for the selection when it is empty or the editor is not focused. */
  commentGeometry: (target: number | "draft" | "selection") => RangeGeometry | null;
  /** Highlight the range a comment is being written on, in its hue; null drops the highlight. */
  setDraftComment: (draft: { from: number; to: number; hue?: string | null } | null) => void;
  /** Where the cursor is: 1-based line and 0-based column. Null before the editor exists. */
  getCursorPosition: () => { line: number; column: number } | null;
  /** Select an exact place (a word the PDF was double-clicked on), scroll it to the middle, and flash it. */
  revealSourcePosition: (position: SourcePosition) => void;
  /** Scroll the PDF preview to where the cursor's line was typeset and flash it there: what Ctrl+Shift+Enter does. False when there is no preview to show it in. */
  showCursorInPdf: () => boolean;
}

// ─── Flash for a jump from the PDF ───
// A jump lands somewhere the eye is not, so the line is tinted and the word marked for a moment.
const setSyncFlash = StateEffect.define<{ from: number; to: number } | null>();
const syncFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    marks = marks.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setSyncFlash)) continue;
      if (!effect.value) {
        marks = Decoration.none;
        continue;
      }
      const { from, to } = effect.value;
      const line = tr.state.doc.lineAt(from);
      const builder = new RangeSetBuilder<Decoration>();
      builder.add(line.from, line.from, Decoration.line({ class: "cm-sync-flash-line" }));
      if (to > from) builder.add(from, to, Decoration.mark({ class: "cm-sync-flash" }));
      marks = builder.finish();
    }
    return marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const syncFlashTheme = EditorView.baseTheme({
  ".cm-sync-flash-line": { backgroundColor: "color-mix(in oklch, var(--hue-amber) 16%, transparent)" },
  ".cm-sync-flash": { backgroundColor: "color-mix(in oklch, var(--hue-amber) 50%, transparent)", borderRadius: "2px" },
});
const SYNC_FLASH_MS = 1400;

/** The code font's stack: the chosen face first, then the usual monospaced ones in case this computer lacks it. */
function codeFont(face?: string): string {
  const fallback = "'JetBrains Mono', 'Fira Code', Consolas, monospace";
  const name = face?.replace(/['"\\]/g, "").trim();
  return name ? `'${name}', ${fallback}` : fallback;
}

/** An exact place in the open file: 1-based line, 0-based column, and how many characters to select. */
export interface SourcePosition {
  line: number;
  column: number;
  length: number;
  /** The text expected there. When the document has moved on since the position was worked out (a collaborator typed), it is looked for again on the lines around. */
  word?: string;
}

// ─── Editor Component ───

const LatexEditorInner = memo(
  forwardRef<LatexEditorHandle, LatexEditorProps>((props, ref) => {
    const {
      value,
      onChange,
      onSave,
      onCompile,
      themeId = "thry",
      className = "",
      readOnly = false,
      onCursorActivity,
      remoteCursors,
      autoIndent = true,
      tabSize = 4,
      isMainFile = false,
      yjsExtension = null,
      yjsText = null,
      initialViewState = null,
      onSaveViewState,
      initialUndoStep,
      onInitialUndoStepApplied,
      diffHighlights,
      onHunkAction,
      fontSize = 14,
      fontFamily,
      lineHeight = "normal",
      autoComplete = true,
      autoCloseBrackets = true,
      codeCheck = true,
      spellLang = null,
      personalWords,
      onAddWord,
      review = null,
      projectIndex = null,
      visual = false,
      imageUrl,
      onOpenFile,
      filePath = null,
      problems,
    } = props;

    // Keep the save callback in a ref so the (mount-only) cleanup can call the
    // latest version without re-running the editor init effect.
    const onSaveViewStateRef = useRef(onSaveViewState);
    onSaveViewStateRef.current = onSaveViewState;

    // Wire up hunk action callback for widget DOM events
    const onHunkActionRef = useRef(onHunkAction);
    onHunkActionRef.current = onHunkAction;
    useEffect(() => {
      _hunkActionCallback = (hunkId, action) => {
        onHunkActionRef.current?.(hunkId, action);
      };
      return () => {
        _hunkActionCallback = null;
      };
    }, []);

    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    // ── Jumping between the source and the PDF ──
    const filePathRef = useRef(filePath);
    filePathRef.current = filePath;
    const currentPath = () => filePathRef.current ?? projectIndexRef.current?.activePath() ?? null;
    const readCursor = (): EditorCursor | null => {
      const view = viewRef.current;
      const path = currentPath();
      if (!view || !path) return null;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return { path, line: line.number, column: head - line.from, text: view.state.doc.toString() };
    };
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const revealSourcePosition = (position: SourcePosition) => {
      const view = viewRef.current;
      if (!view) return;
      const doc = view.state.doc;
      let lineObj = doc.line(Math.max(1, Math.min(position.line, doc.lines)));
      let from = lineObj.from + Math.max(0, Math.min(position.column, lineObj.length));
      let to = Math.min(lineObj.to, from + Math.max(0, position.length));
      if (position.word && doc.sliceString(from, to) !== position.word) {
        // Not where it was expected: the nearest line that has it, this one first, then outward.
        search: for (let d = 0; d <= 6; d++) {
          for (const n of d === 0 ? [lineObj.number] : [lineObj.number - d, lineObj.number + d]) {
            if (n < 1 || n > doc.lines) continue;
            const candidate = doc.line(n);
            const at = candidate.text.indexOf(position.word);
            if (at < 0) continue;
            lineObj = candidate;
            from = candidate.from + at;
            to = from + position.word.length;
            break search;
          }
        }
      }
      view.dispatch({
        selection: EditorSelection.range(from, to),
        effects: [EditorView.scrollIntoView(from, { y: "center" }), setSyncFlash.of({ from, to })],
      });
      view.focus();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => viewRef.current?.dispatch({ effects: setSyncFlash.of(null) }), SYNC_FLASH_MS);
    };
    useEffect(() => {
      const withdraw = provideEditorCursor(readCursor);
      // A double-click in the PDF may have opened this file: the place it resolved to is waiting. The document can arrive a moment after the editor (a shared file syncing), so look a few times, and only until it has been shown once.
      let shown = false;
      const timers = [50, 200, 600, 1500].map((delay) =>
        setTimeout(() => {
          const view = viewRef.current;
          const jump = pendingSourceJump(currentPath());
          if (shown || !view || !jump || view.state.doc.lines < jump.line) return;
          shown = true;
          revealSourcePosition(jump);
        }, delay),
      );
      return () => {
        withdraw();
        timers.forEach(clearTimeout);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
      insertAtCursor(text: string, applyIndent = false) {
        const view = viewRef.current;
        if (!view) return;
        // A formatting wrapper from the ribbon (\textbf{}, \emph{}, $$) wraps the selection, or leaves the cursor between its braces.
        const wrapper = /^(\\[a-zA-Z]+\{)\}$|^\$\$$/.exec(text);
        if (wrapper) {
          const open = wrapper[1] ?? "$";
          const close = wrapper[1] ? "}" : "$";
          const { from, to } = view.state.selection.main;
          const inner = view.state.sliceDoc(from, to);
          view.dispatch({
            changes: { from, to, insert: open + inner + close },
            selection: { anchor: from + open.length, head: from + open.length + inner.length },
          });
          view.focus();
          return;
        }
        const pos = view.state.selection.main.head;
        const doc = view.state.doc.toString();
        // Snippets come with their own indent step; they go in with the project's.
        const scaled = rescaleIndent(text, getIndentUnit(view.state));
        const toInsert = applyIndent
          ? applyIndentToInsertedText(doc, pos, scaled)
          : scaled;
        const endPos = pos + toInsert.length;
        view.dispatch({
          changes: { from: pos, to: pos, insert: toInsert },
          selection: { anchor: endPos, head: endPos },
        });
        view.focus();
      },
      insertSnippet(raw: string) {
        if (!viewRef.current) return;
        const { state } = viewRef.current;
        const text = rescaleIndent(raw, getIndentUnit(state));
        const pos = state.selection.main.head;
        viewRef.current.dispatch({
          changes: { from: pos, to: pos, insert: text },
          selection: { anchor: pos + text.length },
        });
        viewRef.current.focus();
      },
      focus() {
        viewRef.current?.focus();
      },
      getCursorCoords() {
        const view = viewRef.current;
        if (!view) return null;
        const pos = view.state.selection.main.head;
        const coords = view.coordsAtPos(pos);
        if (!coords) return null;
        return { left: coords.left, top: coords.top, bottom: coords.bottom };
      },
      gotoLine(line: number) {
        const view = viewRef.current;
        if (!view) return;
        const n = Math.max(1, Math.min(line, view.state.doc.lines));
        const lineObj = view.state.doc.line(n);
        const pos = lineObj.from;
        view.dispatch({
          selection: EditorSelection.cursor(pos),
          effects: EditorView.scrollIntoView(pos, { y: "center" }),
        });
        view.focus();
      },
      gotoLineWord(line: number, word?: string) {
        const view = viewRef.current;
        if (!view) return;
        // A jump from the PDF knows the exact column, which a word alone does not when it occurs twice on the line.
        const exact = pendingSourceJump(currentPath());
        if (exact && exact.line === line) {
          revealSourcePosition(exact);
          return;
        }
        const doc = view.state.doc;
        const total = doc.lines;
        const target = Math.max(1, Math.min(line, total));

        let from = doc.line(target).from;
        let to = from;

        const needle = (word ?? "").trim();
        if (needle) {
          // Prefer the SyncTeX line, then widen by ±2 lines to absorb drift.
          // Among ties, the nearest line to the target wins (ordering below).
          const order = [
            target,
            target - 1,
            target + 1,
            target - 2,
            target + 2,
          ];
          for (const ln of order) {
            if (ln < 1 || ln > total) continue;
            const lineObj = doc.line(ln);
            const idx = lineObj.text.indexOf(needle);
            if (idx >= 0) {
              from = lineObj.from + idx;
              to = from + needle.length;
              break;
            }
          }
        }

        view.dispatch({
          selection: EditorSelection.range(from, to),
          effects: EditorView.scrollIntoView(from, { y: "center" }),
        });
        view.focus();
      },
      setValue(content: string) {
        const view = viewRef.current;
        if (!view) return;
        const docLen = view.state.doc.length;
        view.dispatch({
          changes: { from: 0, to: docLen, insert: content },
          selection: EditorSelection.cursor(0),
        });
        view.focus();
      },
      getContent(): string {
        const view = viewRef.current;
        if (!view) return value;
        return view.state.doc.toString();
      },
      getCommentTarget() {
        const view = viewRef.current;
        if (!view) return null;
        const { from, to } = view.state.selection.main;
        if (from === to) return null;
        const live = liveText();
        return {
          from,
          to,
          quote: view.state.sliceDoc(from, Math.min(to, from + 1000)),
          anchorStart: live ? anchorAt(live, from, 0) : null,
          anchorEnd: live ? anchorAt(live, to, -1) : null,
        };
      },
      settleSuggestions(ids, action) {
        const view = viewRef.current;
        return view ? settleSuggestions(view, ids, action) : 0;
      },
      getDraftText() {
        const view = viewRef.current;
        const range = view ? commentRange(view, "draft") : null;
        return view && range ? view.state.sliceDoc(range.from, range.to) : null;
      },
      suggestReplacement(text) {
        const view = viewRef.current;
        const range = view ? commentRange(view, "draft") : null;
        if (!view || !range || !liveText()) return false;
        const before = view.state.sliceDoc(range.from, range.to);
        if (before === text) return false;
        // Only the part that differs is suggested, so a changed word reads as that word and not as the whole passage struck out and written again.
        let head = 0;
        while (head < before.length && head < text.length && before[head] === text[head]) head++;
        let tail = 0;
        while (tail < before.length - head && tail < text.length - head && before[before.length - 1 - tail] === text[text.length - 1 - tail]) tail++;
        // Whole words, though: "Methods" to "Techniques" is one word for another, not "Method" for "Technique" with the s left standing.
        const wordy = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
        while (head > 0 && wordy(before[head - 1]) && (wordy(before[head]) || wordy(text[head]))) head--;
        while (tail > 0 && wordy(before[before.length - tail]) && (wordy(before[before.length - tail - 1]) || wordy(text[text.length - tail - 1]))) tail--;
        const from = range.from + head;
        const to = range.to - tail;
        const insert = text.slice(head, text.length - tail);
        view.dispatch({ changes: { from, to, insert }, selection: EditorSelection.cursor(from + insert.length), annotations: suggestEdit.of(true), userEvent: "input.suggest", scrollIntoView: true });
        return true;
      },
      revealRange(from: number, to: number) {
        const view = viewRef.current;
        if (!view) return;
        const len = view.state.doc.length;
        view.dispatch({
          selection: EditorSelection.range(Math.min(from, len), Math.min(to, len)),
          effects: EditorView.scrollIntoView(Math.min(from, len), { y: "center" }),
        });
        view.focus();
      },
      revealComment(id: number) {
        const view = viewRef.current;
        if (!view) return false;
        const range = commentRange(view, id);
        if (!range) return false;
        view.dispatch({
          selection: EditorSelection.range(range.from, range.to),
          effects: EditorView.scrollIntoView(range.from, { y: "center" }),
        });
        return true;
      },
      commentGeometry(target) {
        const view = viewRef.current;
        if (!view) return null;
        if (target === "selection") {
          const sel = view.state.selection.main;
          // Only a selection the person made: never one the editor made by a jump, a search, or a suggestion.
          if (sel.empty || !view.hasFocus || !isUserSelection(view.state)) return null;
          return rangeGeometry(view, sel);
        }
        const range = commentRange(view, target);
        return range ? rangeGeometry(view, range) : null;
      },
      setDraftComment(draft) {
        viewRef.current?.dispatch({ effects: setDraftComment.of(draft) });
      },
      getCursorPosition() {
        const cursor = readCursor();
        return cursor ? { line: cursor.line, column: cursor.column } : null;
      },
      revealSourcePosition,
      showCursorInPdf() {
        return showInPdf(readCursor());
      },
    }));

    // Stable refs for callbacks
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    const onCompileRef = useRef(onCompile);
    onCompileRef.current = onCompile;
    const onCursorActivityRef = useRef(onCursorActivity);
    onCursorActivityRef.current = onCursorActivity;
    const autoIndentRef = useRef(autoIndent);
    autoIndentRef.current = autoIndent;
    const autoCloseRef = useRef(autoCloseBrackets);
    autoCloseRef.current = autoCloseBrackets;
    const onAddWordRef = useRef(onAddWord);
    onAddWordRef.current = onAddWord;
    const reviewRef = useRef(review);
    reviewRef.current = review;
    /** The live Y.Text, when this file is bound to the shared document. */
    const liveText = () =>
      yjsExtension && yjsText && (yjsText as unknown as Y.Text).doc
        ? (yjsText as unknown as Y.Text)
        : null;
    const reviewExtension = () =>
      review
        ? [
            trackChanges({
              suggesting: review.suggesting,
              user: review.user,
              onChange: (list) => reviewRef.current?.onSuggestionsChange?.(list),
            }),
            commentHighlights({
              onClick: (id) => reviewRef.current?.onCommentClick?.(id),
              onShortcut: () => reviewRef.current?.onCommentShortcut?.(),
              onSelection: () => reviewRef.current?.onSelectionChange?.(),
            }),
          ]
        : [];
    const personalKey = (personalWords ?? []).join("\n");
    const spellExtension = () =>
      spellLang
        ? spellCheck({
            lang: spellLang,
            personalWords: personalKey ? personalKey.split("\n") : [],
            onAddWord: (word) => onAddWordRef.current?.(word),
          })
        : [];
    const imageUrlRef = useRef(imageUrl);
    imageUrlRef.current = imageUrl;
    const onOpenFileRef = useRef(onOpenFile);
    onOpenFileRef.current = onOpenFile;
    const visualExtension = (on: boolean) =>
      on
        ? visualMode({
            imageUrl: (path) => imageUrlRef.current?.(path) ?? null,
            openFile: (path) => onOpenFileRef.current?.(path),
            context: () => ({ path: currentPath(), files: projectIndexRef.current?.otherFiles() ?? [] }),
          })
        : [];
    const projectIndexRef = useRef(projectIndex);
    projectIndexRef.current = projectIndex;
    const references = referenceCompletions({
      otherFiles: () => projectIndexRef.current?.otherFiles() ?? [],
      activePath: () => projectIndexRef.current?.activePath() ?? null,
    });
    const completionExtension = (asYouType: boolean) =>
      autocompletion({
        override: [references, latexCompletionSource],
        defaultKeymap: true,
        activateOnTyping: asYouType,
        icons: true,
      });
    const lintExtension = (on: boolean) =>
      on ? linter(latexLinter({ checkMissingDocumentEnv: isMainFile })) : [];
    // The compile's problems, as a second lint source beside the syntax check: @codemirror/lint shows both together.
    const problemsRef = useRef(problems);
    problemsRef.current = problems;
    const problemsExtension = () =>
      problems === undefined
        ? []
        : linter(
            (view): Diagnostic[] =>
              (problemsRef.current ?? [])
                .filter((p) => p.line >= 1 && p.line <= view.state.doc.lines)
                .map((p) => {
                  const line = view.state.doc.line(p.line);
                  return { from: line.from, to: line.to, severity: p.severity, message: p.message, source: "Compile" };
                }),
            { delay: 0 },
          );

    // Compartments for dynamic reconfiguration
    const themeCompartment = useRef(new Compartment());
    const readOnlyCompartment = useRef(new Compartment());
    const typographyCompartment = useRef(new Compartment());
    const indentCompartment = useRef(new Compartment());
    const yjsCompartment = useRef(new Compartment());
    const historyCompartment = useRef(new Compartment());
    const spellCompartment = useRef(new Compartment());
    const completionCompartment = useRef(new Compartment());
    const lintCompartment = useRef(new Compartment());
    const reviewCompartment = useRef(new Compartment());
    const visualCompartment = useRef(new Compartment());

    // Debounce timer for cursor emission
    const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Initialize editor on mount
    useEffect(() => {
      if (!containerRef.current) return;

      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }

      // Initial document content. When Yjs is already bound at mount (the file
      // has synced), the Y.Text is the source of truth. Initialise from it so
      // yCollab binds to an identical doc and never doubles/wipes. Otherwise
      // use the `value` prop (on-disk content).
      const initialDoc = initialUndoStep
        ? initialUndoStep.from
        : yjsExtension && yjsText
          ? yjsText.toString()
          : value;
      const state = EditorState.create({
        doc: initialDoc,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          // The project's tab size: what Tab, Enter, and inserted snippets indent by, and how wide a tab character is drawn.
          indentCompartment.current.of([indentUnit.of(" ".repeat(tabSize)), EditorState.tabSize.of(tabSize)]),
          // Local history: dynamically removed when Yjs activates (yCollab has shared undo).
          historyCompartment.current.of(yjsExtension ? [] : [history()]),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          completionCompartment.current.of(completionExtension(autoComplete)),
          spellCompartment.current.of(spellExtension()),
          // Yjs collaboration extension: dynamically reconfigured via Compartment.
          // When yjsExtension is provided, it handles content sync, remote cursors,
          // and shared undo/redo automatically.
          yjsCompartment.current.of(
            yjsExtension
              ? Array.isArray(yjsExtension)
                ? yjsExtension
                : [yjsExtension]
              : [],
          ),
          // After the Yjs binding, so suggestions are recorded once the
          // shared text already holds the edit.
          reviewCompartment.current.of(reviewExtension()),
          visualCompartment.current.of(visualExtension(visual)),
          syncFlashField,
          syncFlashTheme,
          keymap.of([
            {
              // Next to Mod-Enter, which compiles: show where the cursor is in the PDF.
              key: "Mod-Shift-Enter",
              preventDefault: true,
              run: () => {
                showInPdf(readCursor());
                return true;
              },
            },
            {
              key: "Mod-s",
              run: () => {
                onSaveRef.current?.();
                return true;
              },
            },
            {
              key: "Mod-Enter",
              run: () => {
                onCompileRef.current?.();
                return true;
              },
            },
            {
              key: "Mod-b",
              run: (v) => {
                if (isInMathMode(v)) {
                  toggleWrap(v, "\\mathbf{", "}");
                } else {
                  toggleWrap(v, "\\textbf{", "}");
                }
                return true;
              },
            },
            {
              key: "Mod-i",
              run: (v) => {
                if (isInMathMode(v)) {
                  toggleWrap(v, "\\mathit{", "}");
                } else {
                  toggleWrap(v, "\\textit{", "}");
                }
                return true;
              },
            },
            {
              key: "Enter",
              run: (view) => {
                if (acceptCompletion(view)) return true;
                if (autoIndentRef.current) {
                  // The tab size as it is now (the keymap is built once, with the editor).
                  return latexInsertNewlineSmart(view, getIndentUnit(view.state));
                }
                // Fallback: at least preserve indentation
                return insertNewlineAndIndent(view);
              },
            },
            ...defaultKeymap.filter((b) => b.key !== "Enter"),
            ...searchKeymap,
            // Ctrl+Shift+Z = redo (mirrors Ctrl+Y from historyKeymap)
            { key: "Mod-Shift-z", run: redo, preventDefault: true },
            ...historyKeymap,
            ...foldKeymap,
            ...lintKeymap,
            { key: "Tab", run: acceptCompletion },
            indentWithTab,
          ]),
          // Document change listener
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const isExternal = update.transactions.some((tr) =>
                tr.annotation(isExternalSync),
              );
              if (!isExternal) {
                // Fire onChange with full content (for React state / auto-save).
                // Real-time peer sync is handled separately by Yjs (yCollab).
                onChangeRef.current?.(update.state.doc.toString());
              }
            }
            // Cursor/selection change listener (debounced)
            if (update.selectionSet || update.docChanged) {
              if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
              cursorTimerRef.current = setTimeout(() => {
                const sel = update.state.selection.main;
                const headLine = update.state.doc.lineAt(sel.head);
                const line = headLine.number;
                const ch = sel.head - headLine.from;

                let selection:
                  | {
                      fromLine: number;
                      fromCh: number;
                      toLine: number;
                      toCh: number;
                    }
                  | undefined;

                if (sel.from !== sel.to) {
                  const fromLineObj = update.state.doc.lineAt(sel.from);
                  const toLineObj = update.state.doc.lineAt(sel.to);
                  selection = {
                    fromLine: fromLineObj.number,
                    fromCh: sel.from - fromLineObj.from,
                    toLine: toLineObj.number,
                    toCh: sel.to - toLineObj.from,
                  };
                }

                onCursorActivityRef.current?.(line, ch, selection);
              }, 50); // 50ms debounce
            }
          }),
          // Base theme
          EditorView.theme({
            "&": { height: "100%", flex: "1", minHeight: "0" },
            ".cm-scroller": {
              overflow: "auto",
              scrollbarWidth: "thin",
              fontFamily:
                "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            },
            ".cm-content": { padding: "8px 0" },
            ".cm-gutters": { borderRight: "1px solid var(--line)" },
            // Remote cursor styles
            ".cm-remote-cursor": {
              position: "relative",
              zIndex: "5",
            },
            // The assistant's proposed changes, reviewed in place: lines it would remove struck through on red, its new lines on green under them, and a bar with Accept and Reject. Colors come from the theme's tokens, so both modes hold.
            ".cm-diff-removed": {
              backgroundColor: "color-mix(in oklch, var(--danger) 14%, transparent)",
              textDecoration: "line-through",
              textDecorationColor: "color-mix(in oklch, var(--danger) 55%, transparent)",
            },
            ".cm-diff-conflict": {
              backgroundColor: "color-mix(in oklch, var(--warning) 14%, transparent)",
              textDecoration: "none",
            },
            ".cm-diff-proposed": {
              borderInlineStart: "3px solid color-mix(in oklch, var(--success) 70%, transparent)",
              backgroundColor: "color-mix(in oklch, var(--success) 12%, transparent)",
              margin: "0",
            },
            ".cm-diff-proposed-conflict": {
              borderInlineStartColor: "color-mix(in oklch, var(--warning) 70%, transparent)",
              backgroundColor: "color-mix(in oklch, var(--warning) 10%, transparent)",
            },
            ".cm-diff-proposed-conflict .cm-diff-bar": {
              borderTopColor: "color-mix(in oklch, var(--warning) 25%, transparent)",
            },
            ".cm-diff-added-line": {
              fontFamily: "inherit",
              padding: "0 6px 0 4px",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              color: "var(--foreground)",
              userSelect: "text",
            },
            ".cm-diff-bar": {
              display: "flex",
              alignItems: "center",
              gap: "6px",
              minHeight: "40px",
              padding: "4px 6px 4px 8px",
              borderTop: "1px solid color-mix(in oklch, var(--success) 25%, transparent)",
              fontFamily: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
              fontSize: "13px",
              lineHeight: "18px",
            },
            ".cm-diff-note": {
              flex: "1",
              minWidth: "0",
              color: "var(--muted-foreground)",
            },
            ".cm-diff-action": {
              fontFamily: "inherit",
              height: "32px",
              padding: "0 12px",
              borderRadius: "var(--radius)",
              border: "1px solid var(--line)",
              background: "var(--surface)",
              color: "var(--foreground)",
              fontSize: "13px",
              fontWeight: "500",
              cursor: "pointer",
            },
            ".cm-diff-action:hover": {
              background: "var(--surface-hover)",
            },
            ".cm-diff-accept": {
              background: "var(--accent)",
              color: "var(--on-accent)",
              borderColor: "transparent",
            },
            ".cm-diff-accept:hover": {
              background: "color-mix(in oklch, var(--accent) 90%, transparent)",
            },
            ".cm-diff-action:disabled": {
              opacity: "0.5",
              cursor: "not-allowed",
            },
            ".cm-diff-action:focus-visible": {
              outline: "2px solid var(--focus, var(--accent))",
              outlineOffset: "1px",
            },
          }),
          // Auto-close brackets, parens, quotes, $: wrap selection, skip-over,
          // cyclic $→$$→unwrap, and smart symmetric-pair handling.
          EditorView.inputHandler.of((view, from, to, text) => {
            if (!autoCloseRef.current) return false;
            const pairs: Record<string, string> = {
              "(": ")",
              "[": "]",
              "{": "}",
              "`": "`",
              "'": "'",
              '"': '"',
              $: "$",
            };
            // Symmetric pairs: opener === closer, need count-based logic
            const symmetricPairs = new Set(["`", "'", '"', "$"]);
            const closers = new Set([")", "]", "}", "`", "'", '"', "$"]);

            // Skip-over: typing a closing char when it's already right after
            // the cursor, just move past it instead of inserting a duplicate.
            if (closers.has(text)) {
              const charAfter = view.state.sliceDoc(from, from + 1);
              if (charAfter === text) {
                // For symmetric pairs, only skip-over if this would be a
                // closer (odd count on the line before cursor).
                if (symmetricPairs.has(text)) {
                  const line = view.state.doc.lineAt(from);
                  const textBeforeCursor = view.state.sliceDoc(line.from, from);
                  let count = 0;
                  for (const ch of textBeforeCursor) {
                    if (ch === text) count++;
                  }
                  // Odd count = this is a closer → skip over
                  if (count % 2 === 1) {
                    view.dispatch({
                      selection: { anchor: from + 1 },
                    });
                    return true;
                  }
                  // Even count = this would be an opener → don't skip
                } else {
                  // Asymmetric closer → always skip over
                  view.dispatch({
                    selection: { anchor: from + 1 },
                  });
                  return true;
                }
              }
            }

            const close = pairs[text];
            if (!close) return false;

            const sel = view.state.selection.main;
            const doc = view.state.doc.toString();

            // ── Selection active: wrap / cycle / unwrap ──
            if (sel.from !== sel.to) {
              const selected = doc.slice(sel.from, sel.to);
              const charBefore = sel.from > 0 ? doc[sel.from - 1] : "";
              const charAfterSel = doc[sel.to] || "";

              // ── $ cycling: $ → $$ → unwrap ──
              if (text === "$") {
                if (charBefore === "$" && charAfterSel === "$") {
                  // Already $selection$. Check for $$selection$$
                  const charBefore2 = sel.from > 1 ? doc[sel.from - 2] : "";
                  const charAfter2 = doc[sel.to + 1] || "";
                  if (charBefore2 === "$" && charAfter2 === "$") {
                    // $$selection$$ → unwrap entirely
                    view.dispatch({
                      changes: {
                        from: sel.from - 2,
                        to: sel.to + 2,
                        insert: selected,
                      },
                      selection: {
                        anchor: sel.from - 2,
                        head: sel.from - 2 + selected.length,
                      },
                    });
                  } else {
                    // $selection$ → $$selection$$
                    view.dispatch({
                      changes: [
                        { from: sel.from, to: sel.from, insert: "$" },
                        { from: sel.to, to: sel.to, insert: "$" },
                      ],
                      selection: {
                        anchor: sel.from + 1,
                        head: sel.to + 1,
                      },
                    });
                  }
                  return true;
                }
                // Not yet wrapped in $. Wrap with $selection$
                view.dispatch({
                  changes: {
                    from: sel.from,
                    to: sel.to,
                    insert: `$${selected}$`,
                  },
                  selection: {
                    anchor: sel.from + 1,
                    head: sel.from + 1 + selected.length,
                  },
                });
                return true;
              }

              // ── Non-$ pairs: wrap, but don't double-wrap ──
              if (charBefore === text && charAfterSel === close) {
                return false;
              }
              view.dispatch({
                changes: {
                  from: sel.from,
                  to: sel.to,
                  insert: `${text}${selected}${close}`,
                },
                selection: {
                  anchor: sel.from + 1,
                  head: sel.from + 1 + selected.length,
                },
              });
              return true;
            }

            // ── No selection: auto-close only when BOTH sides are whitespace/empty ──
            const charBefore =
              from > 0 ? view.state.sliceDoc(from - 1, from) : "";
            const charAfter = view.state.sliceDoc(from, from + 1);
            const beforeOk = charBefore === "" || /\s/.test(charBefore);
            const afterOk = charAfter === "" || /\s/.test(charAfter);

            if (!beforeOk || !afterOk) {
              // Characters adjacent to cursor: don't auto-close.
              return false;
            }

            // For symmetric pairs ($, `, ', "), only auto-close when the
            // count on the current line is EVEN (this keystroke is an opener).
            // If ODD, this is a closer: just insert the single char.
            if (symmetricPairs.has(text)) {
              const line = view.state.doc.lineAt(from);
              const textBeforeCursor = view.state.sliceDoc(line.from, from);
              let count = 0;
              for (const ch of textBeforeCursor) {
                if (ch === text) count++;
              }
              if (count % 2 === 1) {
                // Odd = closer: just insert normally, no auto-close
                return false;
              }
            }

            view.dispatch({
              changes: { from, to, insert: `${text}${close}` },
              selection: { anchor: from + 1 },
            });
            return true;
          }),
          // The default theme is ours and small, so it is there from the first paint; any other is loaded on demand and swapped in.
          themeCompartment.current.of(thry),
          latex({
            autoCloseBrackets: false,
            enableAutocomplete: false,
            enableLinting: false,
          }),
          lintCompartment.current.of(lintExtension(codeCheck)),
          problemsExtension(),
          readOnlyCompartment.current.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly || !!diffHighlights),
          ]),
          diffHighlightsField,
          EditorView.lineWrapping,
          indentWrappingPlugin,
          // Remote cursors field: only when NOT using Yjs (yCollab renders its own)
          ...(yjsExtension ? [] : [remoteCursorsField]),
          typographyCompartment.current.of(
            EditorView.theme({
              "&": { fontSize: `${fontSize}px` },
              ".cm-content, .cm-gutters": {
                lineHeight:
                  lineHeight === "compact"
                    ? "1.4"
                    : lineHeight === "wide"
                      ? "2.0"
                      : "1.6",
              },
              "&:not(.cm-visual) .cm-scroller": { fontFamily: codeFont(fontFamily) },
            }),
          ),
        ],
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;

      // Restore per-file view state (selection + scroll) captured before the
      // last unmount, so switching files and back keeps the cursor/scroll.
      if (initialViewState) {
        try {
          const sel = EditorSelection.fromJSON(initialViewState.selection);
          view.dispatch({ selection: sel, scrollIntoView: false });
        } catch {
          // Saved selection no longer fits the document: ignore.
        }
        const { scrollTop } = initialViewState;
        requestAnimationFrame(() => {
          if (viewRef.current) viewRef.current.scrollDOM.scrollTop = scrollTop;
        });
      }

      return () => {
        if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
        // Persist this file's view state for the parent's per-file cache.
        try {
          onSaveViewStateRef.current?.({
            selection: view.state.selection.toJSON(),
            scrollTop: view.scrollDOM.scrollTop,
          });
        } catch {
          // best-effort
        }
        view.destroy();
        viewRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Apply initialUndoStep as an undoable change (e.g. after AI Accept → Undo reverts)
    useEffect(() => {
      const view = viewRef.current;
      if (!view || !initialUndoStep) return;
      const currentDoc = view.state.doc.toString();
      if (currentDoc !== initialUndoStep.to) {
        view.dispatch({
          changes: {
            from: 0,
            to: currentDoc.length,
            insert: initialUndoStep.to,
          },
        });
      }
      onInitialUndoStepApplied?.();
    }, [initialUndoStep, onInitialUndoStepApplied]);

    // Sync value changes from prop (skip when we have initialUndoStep; we handle that above)
    // Use a minimal diff so CodeMirror can map cursors/selections through the change
    // instead of resetting them to position 0 (which causes cursor-jump-to-top on collab edits).
    // The isExternalSync annotation suppresses the onChange callback to prevent echo loops.
    // SKIP entirely when Yjs is active: Yjs owns the document content.
    useEffect(() => {
      if (yjsExtension) return; // Yjs manages content sync
      const view = viewRef.current;
      if (!view || initialUndoStep) return;
      const currentDoc = view.state.doc.toString();
      const change = computeMinimalChange(currentDoc, value);
      if (change) {
        view.dispatch({
          changes: change,
          annotations: [
            Transaction.addToHistory.of(false),
            isExternalSync.of(true),
          ],
        });
      }
    }, [value, initialUndoStep, yjsExtension]);

    // A new compile's problems are marked at once, without waiting for an edit.
    useEffect(() => {
      const view = viewRef.current;
      if (view && problems !== undefined) forceLinting(view);
    }, [problems]);

    // Sync tabSize changes
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: indentCompartment.current.reconfigure([
          indentUnit.of(" ".repeat(tabSize)),
          EditorState.tabSize.of(tabSize),
        ]),
      });
    }, [tabSize]);

    // Sync yjsExtension changes (e.g. null → extension when socket connects,
    // or a new file's yCollab on file switch).
    //
    // CRITICAL: when binding yCollab, reset the editor document to match the
    // file's Y.Text content in the SAME transaction. yCollab/y-codemirror does
    // NOT reconcile a mismatched doc on bind: if the editor already holds text
    // (from `doc: value` or a previous file) and the Y.Text then receives that
    // same content from the server, its observer INSERTS it on top, doubling
    // the document. Resetting to `yjsText.toString()` keeps editor and Y.Text
    // consistent so deltas apply cleanly.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      const yjsActive = !!yjsExtension;
      const effects = [
        yjsCompartment.current.reconfigure(
          yjsActive
            ? Array.isArray(yjsExtension)
              ? yjsExtension
              : [yjsExtension]
            : [],
        ),
        // Toggle local history: remove when Yjs is active (it provides shared undo)
        historyCompartment.current.reconfigure(yjsActive ? [] : [history()]),
      ];

      let changes: { from: number; to: number; insert: string } | undefined;
      if (yjsActive && yjsText) {
        const current = view.state.doc.toString();
        const target = yjsText.toString();
        // Adopt the Y.Text ONLY when it actually has content and differs from
        // the editor. Never reset to an empty Y.Text: that would wipe the
        // file's content. (yjsExtension is now gated on sync, so by the time we
        // get here the Y.Text is already populated, but this guard makes the
        // wipe impossible even under unexpected races.)
        if (target.length > 0 && target !== current) {
          changes = { from: 0, to: current.length, insert: target };
        }
      }

      view.dispatch({
        changes,
        effects,
        annotations: [
          Transaction.addToHistory.of(false),
          isExternalSync.of(true),
        ],
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [yjsExtension, yjsText]);

    // Sync the Editing settings and the spell checker
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: [
          completionCompartment.current.reconfigure(completionExtension(autoComplete)),
          lintCompartment.current.reconfigure(lintExtension(codeCheck)),
        ],
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoComplete, codeCheck, isMainFile]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: spellCompartment.current.reconfigure(spellExtension()) });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spellLang, personalKey]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      // Keep the reader's place: the layout changes completely between the two modes.
      view.dispatch({ effects: [...keepPlace(view), visualCompartment.current.reconfigure(visualExtension(visual))] });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visual]);

    // Suggesting on or off, or someone else signed in: rebuild the review
    // extension. Its callbacks read the latest props through reviewRef.
    const reviewKey = review ? `${review.suggesting}:${review.user.id}:${review.user.name}` : "";
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: reviewCompartment.current.reconfigure(reviewExtension()) });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reviewKey]);

    // Highlight the comments on this file, found by their anchors in the live
    // document or by their quoted text.
    const comments = review?.comments;
    const activeCommentId = review?.activeCommentId ?? null;
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const text = view.state.doc.toString();
      const live = liveText();
      const marks = (comments ?? []).flatMap((c) => {
        const r = findRange(text, live, c);
        return r ? [{ id: c.id, hue: c.hue, ...r }] : [];
      });
      view.dispatch({ effects: setCommentMarks.of({ marks, active: activeCommentId }) });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [comments, activeCommentId, yjsExtension, yjsText, reviewKey]);

    // Sync readOnly changes
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: readOnlyCompartment.current.reconfigure([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly || !!diffHighlights),
        ]),
      });
    }, [readOnly, diffHighlights]);

    // Sync fontSize / lineHeight changes
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const lh =
        lineHeight === "compact"
          ? "1.4"
          : lineHeight === "wide"
            ? "2.0"
            : "1.6";
      view.dispatch({
        effects: typographyCompartment.current.reconfigure(
          EditorView.theme({
            "&": { fontSize: `${fontSize}px` },
            ".cm-content, .cm-gutters": { lineHeight: lh },
            "&:not(.cm-visual) .cm-scroller": { fontFamily: codeFont(fontFamily) },
          }),
        ),
      });
    }, [fontSize, fontFamily, lineHeight]);

    // Sync theme changes
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      loadThemeExtension(themeId)
        .then((ext) => {
          if (!viewRef.current) return;
          viewRef.current.dispatch({
            effects: themeCompartment.current.reconfigure(ext),
          });
        })
        .catch((err) => {
          console.warn(`Failed to load editor theme "${themeId}":`, err);
        });
    }, [themeId]);

    // Sync remote cursors into the editor (skip when Yjs handles cursors via awareness)
    useEffect(() => {
      if (yjsExtension) return; // yCollab renders remote cursors
      const view = viewRef.current;
      if (!view || !remoteCursors) return;

      view.dispatch({
        effects: setRemoteCursors.of(remoteCursors),
      });
    }, [remoteCursors, yjsExtension]);

    // Sync inline diff highlights (Cursor-style green added lines + red removed blocks)
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      view.dispatch({
        effects: setDiffHighlights.of(diffHighlights ?? null),
      });
    }, [diffHighlights]);

    return (
      <div
        ref={containerRef}
        className={`flex-1 min-h-0 w-full overflow-hidden ${className}`}
      />
    );
  }),
);

LatexEditorInner.displayName = "LatexEditor";

export const LatexEditor = LatexEditorInner;

/** Wrap the current selection with prefix/suffix text */
/**
 * Detect if the cursor is inside a math context:
 * - Inline math: $...$
 * - Display math: $$...$$
 * - Math environments: equation, align, gather, multline, eqnarray, math, displaymath, cases, etc.
 */
function isInMathMode(view: EditorView): boolean {
  // Use the START of the selection (or cursor pos if no selection) so that
  // selecting text in normal prose and pressing Ctrl+B doesn't accidentally
  // detect math mode because the selection head overshoots into a $ region.
  const sel = view.state.selection.main;
  const pos = Math.min(sel.from, sel.to);
  const doc = view.state.doc.toString();
  const before = doc.slice(0, pos);

  // Check for math environments: count open vs closed.
  // Use escaped literal names (escape the * so it matches literally).
  const MATH_ENVS = [
    "equation",
    "equation\\*",
    "align",
    "align\\*",
    "gather",
    "gather\\*",
    "multline",
    "multline\\*",
    "eqnarray",
    "eqnarray\\*",
    "flalign",
    "flalign\\*",
    "math",
    "displaymath",
    "cases",
    "split",
    "array",
    "bmatrix",
    "pmatrix",
    "vmatrix",
    "Bmatrix",
    "Vmatrix",
    "matrix",
  ];
  for (const env of MATH_ENVS) {
    // Escape the env name for regex: turn literal \* into \\* for the regex engine
    const escaped = env.replace(/\\\*/g, "\\*");
    const openRe = new RegExp(`\\\\begin\\{${escaped}\\}`, "g");
    const closeRe = new RegExp(`\\\\end\\{${escaped}\\}`, "g");
    const opens = (before.match(openRe) || []).length;
    const closes = (before.match(closeRe) || []).length;
    if (opens > closes) return true;
  }

  // Check for inline/display math delimiters ($...$ and $$...$$).
  // Scan for unescaped $ signs. Track $$ as a single toggle so that
  // $$...$$ (display math) is detected correctly.
  let mathDepth = 0; // 0 = outside, 1 = inside $ or $$
  let i = 0;
  while (i < before.length) {
    if (before[i] === "$" && (i === 0 || before[i - 1] !== "\\")) {
      // Check for $$ (display math delimiter)
      if (i + 1 < before.length && before[i + 1] === "$") {
        mathDepth = mathDepth === 0 ? 1 : 0;
        i += 2; // skip both $
        continue;
      }
      // Single $
      mathDepth = mathDepth === 0 ? 1 : 0;
    }
    i++;
  }
  if (mathDepth > 0) return true;

  // Check for \( ... \) and \[ ... \]
  const openParen = (before.match(/\\\(/g) || []).length;
  const closeParen = (before.match(/\\\)/g) || []).length;
  if (openParen > closeParen) return true;

  const openBracket = (before.match(/\\\[/g) || []).length;
  const closeBracket = (before.match(/\\\]/g) || []).length;
  if (openBracket > closeBracket) return true;

  return false;
}

/**
 * Toggle wrap/unwrap. If the selection (or the text around the cursor) is
 * already wrapped with `prefix`…`suffix`, remove them. Otherwise add them.
 *
 * Works for:
 *  - \textbf{...} / \mathbf{...} / \textit{...} / \mathit{...}  (Ctrl+B / Ctrl+I)
 *  - Any paired delimiter when called explicitly
 */
function toggleWrap(view: EditorView, prefix: string, suffix: string) {
  const sel = view.state.selection.main;
  const doc = view.state.doc.toString();

  // ── Case 1: text is selected. Check if selection is already wrapped ──
  if (sel.from !== sel.to) {
    const before = doc.slice(Math.max(0, sel.from - prefix.length), sel.from);
    const after = doc.slice(sel.to, sel.to + suffix.length);

    if (before === prefix && after === suffix) {
      // Unwrap: remove prefix before selection and suffix after selection
      const inner = doc.slice(sel.from, sel.to);
      view.dispatch({
        changes: {
          from: sel.from - prefix.length,
          to: sel.to + suffix.length,
          insert: inner,
        },
        selection: {
          anchor: sel.from - prefix.length,
          head: sel.from - prefix.length + inner.length,
        },
      });
    } else {
      // Wrap
      wrapSelection(view, prefix, suffix);
    }
    return;
  }

  // ── Case 2: no selection. Check if cursor is inside prefix{…}suffix ──
  // Walk outward from cursor to find matching prefix...suffix
  const pos = sel.head;

  // For LaTeX commands like \textbf{...}, find the enclosing command
  // Look backward for the prefix ending at or before the cursor
  const searchStart = Math.max(0, pos - 200); // reasonable lookback
  const region = doc.slice(searchStart, Math.min(doc.length, pos + 200));
  const relPos = pos - searchStart;

  // Try to find prefix before cursor and matching suffix after
  const prefixIdx = region.lastIndexOf(prefix, relPos);
  if (prefixIdx >= 0) {
    const contentStart = prefixIdx + prefix.length;
    const suffixIdx = region.indexOf(suffix, relPos);
    if (suffixIdx >= 0 && contentStart <= relPos && relPos <= suffixIdx) {
      // Cursor is inside prefix{...}suffix: unwrap
      const absPrefix = searchStart + prefixIdx;
      const absSuffix = searchStart + suffixIdx;
      const inner = doc.slice(absPrefix + prefix.length, absSuffix);
      view.dispatch({
        changes: {
          from: absPrefix,
          to: absSuffix + suffix.length,
          insert: inner,
        },
        selection: {
          anchor: absPrefix + (pos - absPrefix - prefix.length),
        },
      });
      return;
    }
  }

  // Not inside a wrap: add prefix+suffix at cursor
  wrapSelection(view, prefix, suffix);
}

function wrapSelection(view: EditorView, prefix: string, suffix: string) {
  const sel = view.state.selection.main;
  const selected = view.state.sliceDoc(sel.from, sel.to);
  view.dispatch({
    changes: {
      from: sel.from,
      to: sel.to,
      insert: `${prefix}${selected}${suffix}`,
    },
    selection: selected
      ? {
          anchor: sel.from + prefix.length,
          head: sel.from + prefix.length + selected.length,
        }
      : { anchor: sel.from + prefix.length },
  });
}

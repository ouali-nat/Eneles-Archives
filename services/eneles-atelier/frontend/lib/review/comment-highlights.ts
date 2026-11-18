/**
 * Commented ranges, highlighted in the editor. The parent finds the ranges (by their anchors, see anchors.ts) and sends them in; the highlights then follow edits until the next set arrives. Each highlight takes its thread's hue (hues.ts) through the `--comment-hue` property. A comment being written has its own highlight, the draft, which follows edits the same way until it is posted or dropped. Clicking a highlight names its comment; Mod+Alt+M asks for a comment on the selection.
 */
import { Prec, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { hueVar } from "./hues";

export interface CommentMark {
  id: number;
  from: number;
  to: number;
  /** A hue name; null or unknown draws the default. */
  hue?: string | null;
}

export const setCommentMarks = StateEffect.define<{ marks: CommentMark[]; active: number | null }>();

/** The highlight of a comment being written, or null to drop it. */
export const setDraftComment = StateEffect.define<{ from: number; to: number; hue?: string | null } | null>();

interface Marks {
  comments: DecorationSet;
  draft: DecorationSet;
}

const commentField = StateField.define<Marks>({
  create: () => ({ comments: Decoration.none, draft: Decoration.none }),
  update(value, tr) {
    let { comments, draft } = value;
    comments = comments.map(tr.changes);
    draft = draft.map(tr.changes);
    const length = tr.state.doc.length;
    for (const e of tr.effects) {
      if (e.is(setCommentMarks)) {
        comments = Decoration.set(
          e.value.marks
            .filter((m) => m.from < m.to && m.to <= length)
            .map((m) =>
              Decoration.mark({
                class: m.id === e.value.active ? "cm-comment cm-comment-active" : "cm-comment",
                attributes: { "data-comment": String(m.id), style: `--comment-hue: ${hueVar(m.hue)}` },
              }).range(m.from, m.to),
            ),
          true,
        );
      } else if (e.is(setDraftComment)) {
        const d = e.value;
        draft =
          d && d.from < d.to && d.to <= length
            ? Decoration.set([Decoration.mark({ class: "cm-comment cm-comment-draft", attributes: { "data-comment-draft": "", style: `--comment-hue: ${hueVar(d.hue)}` } }).range(d.from, d.to)])
            : Decoration.none;
      }
    }
    return { comments, draft };
  },
  provide: (f) => [EditorView.decorations.from(f, (v) => v.comments), EditorView.decorations.from(f, (v) => v.draft)],
});

/** Where a comment's highlight is now; "draft" for the comment being written. */
export function commentRange(view: EditorView, id: number | "draft"): { from: number; to: number } | null {
  const marks = view.state.field(commentField, false);
  if (!marks) return null;
  let found: { from: number; to: number } | null = null;
  if (id === "draft") {
    marks.draft.between(0, view.state.doc.length, (from, to) => {
      found = { from, to };
      return false;
    });
    return found;
  }
  marks.comments.between(0, view.state.doc.length, (from, to, deco) => {
    if (deco.spec.attributes?.["data-comment"] === String(id)) {
      found = { from, to };
      return false;
    }
  });
  return found;
}

/** Comments around a position, innermost last. */
export function commentsAt(view: EditorView, pos: number): number[] {
  const ids: number[] = [];
  view.state.field(commentField, false)?.comments.between(pos, pos, (from, to, deco) => {
    if (from <= pos && pos <= to) ids.push(Number(deco.spec.attributes?.["data-comment"]));
  });
  return ids;
}

/** A range's ends on screen, in client coordinates, with the editor's visible box; null when the range is not drawn (folded away, or the editor is not on screen). */
export interface RangeGeometry {
  start: { left: number; top: number; bottom: number };
  end: { left: number; top: number; bottom: number };
  bounds: { left: number; top: number; right: number; bottom: number };
}

export function rangeGeometry(view: EditorView, range: { from: number; to: number }): RangeGeometry | null {
  const box = view.scrollDOM.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return null;
  const len = view.state.doc.length;
  const from = Math.min(range.from, len);
  const to = Math.min(range.to, len);
  // A range that ends at a line's start is drawn up to the previous line's end.
  const endPos = to > from && view.state.doc.lineAt(to).from === to ? to - 1 : to;
  const start = view.coordsAtPos(from, 1);
  const end = view.coordsAtPos(endPos, -1) ?? view.coordsAtPos(endPos, 1);
  if (!start || !end) return null;
  return {
    start: { left: start.left, top: start.top, bottom: start.bottom },
    end: { left: end.right, top: end.top, bottom: end.bottom },
    bounds: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
  };
}

/** Whether the current selection is one the person made (a drag, a double-click, Shift with the arrows, select all), rather than one the editor made (a jump from the PDF, find and replace, an accepted suggestion). Only the person's own selection is offered a "Comment" button. */
const userSelectionField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    if (!tr.selection) return value;
    // Find and replace selects its matches as "select.search": that selection is the editor's.
    if (tr.isUserEvent("select.search")) return false;
    return tr.isUserEvent("select") || tr.isUserEvent("input") || tr.isUserEvent("delete");
  },
});

/** True when the selection was made by the person; an editor without the review extensions counts every selection as theirs. */
export function isUserSelection(state: EditorState): boolean {
  return state.field(userSelectionField, false) ?? true;
}

export interface CommentHighlightOptions {
  /** A highlight was clicked. */
  onClick: (id: number) => void;
  /** Mod+Alt+M: comment on the selection. */
  onShortcut?: () => void;
  /** The selection or the editor's focus changed. */
  onSelection?: () => void;
}

export function commentHighlights(options: CommentHighlightOptions): Extension {
  return [
    commentField,
    userSelectionField,
    Prec.high(
      keymap.of([
        {
          key: "Mod-Alt-m",
          run: () => {
            if (!options.onShortcut) return false;
            options.onShortcut();
            return true;
          },
        },
      ]),
    ),
    EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.focusChanged) options.onSelection?.();
    }),
    EditorView.domEventHandlers({
      click(event, view) {
        // The end of a drag that began on a highlight is a selection, not a click on it.
        if (!view.state.selection.main.empty) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const ids = commentsAt(view, pos);
        if (ids.length) options.onClick(ids[ids.length - 1]);
        return false;
      },
    }),
    EditorView.baseTheme({
      ".cm-comment": {
        backgroundColor: "color-mix(in oklch, var(--comment-hue) 18%, transparent)",
        borderBottom: "2px solid color-mix(in oklch, var(--comment-hue) 60%, transparent)",
        cursor: "pointer",
        transition: "background-color var(--motion-control-duration, 120ms) var(--motion-ease, ease)",
      },
      ".cm-comment:hover": {
        backgroundColor: "color-mix(in oklch, var(--comment-hue) 26%, transparent)",
      },
      ".cm-comment-active, .cm-comment-active:hover": {
        backgroundColor: "color-mix(in oklch, var(--comment-hue) 34%, transparent)",
        borderBottomColor: "var(--comment-hue)",
      },
      ".cm-comment-draft": {
        backgroundColor: "color-mix(in oklch, var(--comment-hue) 30%, transparent)",
        borderBottom: "2px dashed var(--comment-hue)",
        cursor: "text",
      },
    }),
  ];
}

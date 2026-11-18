/**
 * Visual mode: the same document and editor, with the LaTeX drawn as what it means. Headings are headings, lists have bullets, math is typeset, tables are grids, citations are chips, and the preamble folds away. Wherever the cursor or selection is, that element's source comes back so it can be edited; leaving it draws it again. The document text is never changed by this mode, so undo, collaboration, comments, suggestions, and spell checking work as in code mode.
 *
 * The whole file is read on each change (scan.ts, one quick pass), but only the stretch around the viewport is drawn (build.ts), so long files stay fast.
 */
import { Prec, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { scan, type Scan } from "./scan";
import { numberFile, projectContext, type ProjectContext } from "./project";
import { build, type VisualOptions } from "./build";
import { visualTheme } from "./theme";
import type { RenderContext } from "./render";

export type { VisualOptions } from "./build";

/** How far beyond the viewport, in characters, the drawing reaches. */
const MARGIN = 12000;

const setRange = StateEffect.define<{ from: number; to: number }>();
const setPreamble = StateEffect.define<boolean>();
const setFocus = StateEffect.define<boolean>();

interface VisualState {
  scan: Scan;
  from: number;
  to: number;
  preambleOpen: boolean;
  /** Source is only revealed under the cursor while the editor has focus; a file just opened reads as a document. */
  focused: boolean;
  decorations: DecorationSet;
  atomic: DecorationSet;
}

export function visualMode(options: VisualOptions = {}): Extension {
  const togglePreamble = (view: EditorView) => {
    const current = view.state.field(field, false);
    if (!current) return;
    const open = current.preambleOpen;
    const doc = current.scan.document;
    // Folding the preamble while the cursor is in it would leave the cursor hidden: move it to the first line of the body.
    const end = doc ? view.state.doc.lineAt(doc.headEnd).to : 0;
    const inside = view.state.selection.ranges.some((r) => r.to > 0 && r.from <= end);
    view.dispatch({
      effects: setPreamble.of(!open && !inside),
      selection: open || inside ? { anchor: Math.min(view.state.doc.length, end + 1) } : undefined,
    });
    view.focus();
  };

  let renderCache: { ctx: ProjectContext; labels: Map<string, { num: string }>; value: RenderContext; key: string } | null = null;

  const draw = (state: EditorState, s: Omit<VisualState, "decorations" | "atomic">): VisualState => {
    const project = options.context?.() ?? { path: null, files: [] };
    const ctx = projectContext(project.path, project.files, s.scan);
    const { numbering, labels } = numberFile(s.scan, ctx);
    if (!renderCache || renderCache.ctx !== ctx || !sameLabels(renderCache.labels, labels)) {
      const key = `${Object.keys(ctx.defs.katex).length}:${Object.entries(ctx.defs.katex).join("|").length}:${[...labels.values()].map((t) => t.num).join(",")}`;
      renderCache = { ctx, labels, key, value: { macros: ctx.defs.macros, katex: ctx.defs.katex, katexKey: key, labels } };
    }
    const out = build({
      state,
      scan: s.scan,
      ctx,
      numbering,
      labels,
      render: renderCache.value,
      renderKey: renderCache.key,
      from: s.from,
      to: s.to,
      preambleOpen: s.preambleOpen,
      focused: s.focused,
      togglePreamble,
      options,
      path: project.path,
      filePaths: [...project.files.map((f) => f.path), ...(project.path ? [project.path] : [])],
    });
    return { ...s, decorations: out.decorations, atomic: out.atomic };
  };

  const field = StateField.define<VisualState>({
    create(state) {
      const head = state.selection.main.head;
      const len = state.doc.length;
      const from = Math.max(0, head - MARGIN * 2);
      return safe(state, () => draw(state, { scan: scan(state.doc.toString()), from, to: Math.min(len, Math.max(head, from) + MARGIN * 4), preambleOpen: false, focused: false }));
    },
    update(value, tr) {
      let { scan: scanned, from, to, preambleOpen, focused } = value;
      let redraw = false;
      if (tr.docChanged) {
        scanned = scan(tr.newDoc.toString());
        from = tr.changes.mapPos(from, -1);
        to = Math.min(tr.newDoc.length, tr.changes.mapPos(to, 1));
        redraw = true;
      }
      for (const e of tr.effects) {
        if (e.is(setRange)) {
          from = e.value.from;
          to = e.value.to;
          redraw = true;
        } else if (e.is(setPreamble)) {
          preambleOpen = e.value;
          redraw = true;
        } else if (e.is(setFocus) && e.value !== focused) {
          focused = e.value;
          redraw = true;
        }
      }
      if (tr.selection && focused) redraw = true;
      if (!redraw) return value;
      const len = tr.state.doc.length;
      from = Math.max(0, Math.min(from, len));
      to = Math.max(from, Math.min(to, len));
      const next = { scan: scanned, from, to, preambleOpen, focused };
      return safe(tr.state, () => draw(tr.state, next), value);
    },
    provide: (f) => [EditorView.decorations.from(f, (v) => v.decorations), EditorView.atomicRanges.of((view) => view.state.field(f).atomic)],
  });

  // Keeps the drawn stretch around the viewport as the reader scrolls.
  const follow = ViewPlugin.fromClass(
    class {
      pending = false;
      constructor(readonly view: EditorView) {
        this.check();
      }
      update(u: ViewUpdate) {
        if (u.viewportChanged || u.docChanged) this.check();
      }
      check() {
        const { from, to } = this.view.viewport;
        const v = this.view.state.field(field);
        const len = this.view.state.doc.length;
        const slack = MARGIN / 4;
        const coveredFrom = v.from === 0 || from - v.from >= slack;
        const coveredTo = v.to >= len || v.to - to >= slack;
        if ((coveredFrom && coveredTo) || this.pending) return;
        this.pending = true;
        requestAnimationFrame(() => {
          this.pending = false;
          const view = this.view;
          if (!view.dom.isConnected) return;
          const vp = view.viewport;
          const n = view.state.doc.length;
          view.dispatch({ effects: setRange.of({ from: Math.max(0, vp.from - MARGIN), to: Math.min(n, vp.to + MARGIN) }) });
        });
      }
    },
  );

  return [
    field,
    follow,
    EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing)),
    Prec.highest(visualTheme),
    EditorView.editorAttributes.of({ class: "cm-visual" }),
  ];
}

function sameLabels(a: Map<string, { num: string }>, b: Map<string, { num: string }>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of b) {
    const o = a.get(k);
    if (!o || o.num !== v.num) return false;
  }
  return true;
}

/** Drawing must never break the editor: if it throws, keep what was drawn before (or nothing) and show the source. */
function safe(state: EditorState, fn: () => VisualState, fallback?: VisualState): VisualState {
  try {
    return fn();
  } catch (err) {
    if (process.env.NODE_ENV !== "production") console.error("Visual mode could not draw this document", err);
    const base = fallback ?? { scan: scan(state.doc.toString()), from: 0, to: 0, preambleOpen: false, focused: false };
    return { scan: base.scan, from: base.from, to: base.to, preambleOpen: base.preambleOpen, focused: base.focused, decorations: Decoration.none, atomic: Decoration.none };
  }
}

/**
 * Effects that keep the reader's place when visual mode is switched on or off: the line at the top of the editor (or the cursor's line, when the cursor is on screen) stays where it was on screen. Compute them before reconfiguring and dispatch them with the reconfiguration.
 */
export function keepPlace(view: EditorView): StateEffect<unknown>[] {
  const scroller = view.scrollDOM.getBoundingClientRect();
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head);
  if (coords && coords.top >= scroller.top && coords.bottom <= scroller.bottom) {
    return [EditorView.scrollIntoView(head, { y: "start", yMargin: Math.max(0, coords.top - scroller.top) })];
  }
  const block = view.lineBlockAtHeight(scroller.top - view.documentTop);
  return [EditorView.scrollIntoView(block.from, { y: "start", yMargin: 0 })];
}

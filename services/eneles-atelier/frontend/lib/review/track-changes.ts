/**
 * Suggested changes (track changes) for the live editor.
 *
 * While someone is suggesting, their edits still happen; each one is also
 * recorded in the file's suggestions map, which lives in the same Yjs
 * document as the text, so suggestions reach everyone with the edit and are
 * saved with it. An insertion stays in the text and is highlighted. A
 * deletion leaves the text and is kept in the map, shown struck through
 * where it was. The file therefore always reads as if every suggestion were
 * accepted, which is what compiles, word counts, and the assistant see.
 *
 * Accepting an insertion or a deletion only forgets the record. Rejecting an
 * insertion removes its text; rejecting a deletion puts the text back. The
 * records are written with the editor's own sync origin, so undo takes back
 * an edit and its record together.
 */
import {
  Annotation,
  StateEffect,
  StateField,
  Transaction,
  type ChangeDesc,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { ySyncAnnotation, ySyncFacet } from "y-codemirror.next";
import * as Y from "yjs";
import { anchorAt, nameOf, resolveAnchor, suggestionsMap } from "./anchors";

export interface StoredSuggestion {
  kind: "insert" | "delete";
  /** Insertions: the range's two ends. */
  start?: string;
  end?: string;
  /** Deletions: where the text was, and the text. */
  at?: string;
  text?: string;
  authorId: number;
  authorName: string;
  time: number;
}

/** A suggestion where it is now. For a deletion, from === to. */
export interface Suggestion {
  id: string;
  kind: "insert" | "delete";
  from: number;
  to: number;
  text: string;
  authorId: number;
  authorName: string;
  time: number;
}

export interface TrackOptions {
  suggesting: boolean;
  user: { id: number; name: string };
  onChange?: (suggestions: Suggestion[]) => void;
}

/** Marks edits made by accepting or rejecting, which are not suggestions themselves. */
export const reviewEdit = Annotation.define<boolean>();

/** Marks one edit as a suggestion, whether or not the person is in the suggesting mode: "Suggest" on a selection replaces it this way. */
export const suggestEdit = Annotation.define<boolean>();

/** Origin for tidying records nobody needs to undo. */
const TIDY = { tidy: true };
const MAX_DELETED = 100_000;
const HUES = ["blue", "purple", "teal", "orange", "pink", "green", "indigo", "amber"];

export function authorHue(authorId: number): string {
  return `var(--hue-${HUES[Math.abs(authorId) % HUES.length]})`;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

interface Binding {
  ytext: Y.Text;
  map: Y.Map<unknown>;
  origin: unknown;
}

function bindingFor(state: EditorView["state"]): Binding | null {
  const conf = state.facet(ySyncFacet) as { ytext: Y.Text } | undefined;
  const ytext = conf?.ytext;
  const path = ytext ? nameOf(ytext) : null;
  if (!ytext || !ytext.doc || !path) return null;
  return { ytext, map: suggestionsMap(ytext.doc, path), origin: conf };
}

/** Every suggestion that still points somewhere, and the ids of the ones that do not. */
function readAll(b: Binding, docText: string): { list: Suggestion[]; gone: string[] } {
  const list: Suggestion[] = [];
  const gone: string[] = [];
  for (const [id, raw] of b.map.entries()) {
    const s = raw as StoredSuggestion;
    if (s?.kind === "insert") {
      const from = resolveAnchor(b.ytext, s.start);
      const to = resolveAnchor(b.ytext, s.end);
      if (from === null || to === null || to <= from || to > docText.length) {
        gone.push(id);
        continue;
      }
      list.push({ id, kind: "insert", from, to, text: docText.slice(from, to), authorId: s.authorId, authorName: s.authorName, time: s.time });
    } else if (s?.kind === "delete") {
      const at = resolveAnchor(b.ytext, s.at);
      if (at === null || at > docText.length || !s.text) {
        gone.push(id);
        continue;
      }
      list.push({ id, kind: "delete", from: at, to: at, text: s.text, authorId: s.authorId, authorName: s.authorName, time: s.time });
    }
  }
  list.sort((a, b) => a.from - b.from || (a.kind === "delete" ? -1 : 1));
  return { list, gone };
}

class DeletedText extends WidgetType {
  constructor(
    readonly id: string,
    readonly text: string,
    readonly author: string,
    readonly hue: string,
  ) {
    super();
  }
  eq(other: DeletedText) {
    return other.id === this.id && other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-tc-delete";
    span.dataset.suggestion = this.id;
    span.style.setProperty("--tc-hue", this.hue);
    const shown = this.text.length > 300 ? `${this.text.slice(0, 300)}…` : this.text;
    span.textContent = shown.replace(/\n/g, "↵ ");
    span.title = `${this.author} suggested deleting this`;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

function decorationsFor(list: Suggestion[]): DecorationSet {
  return Decoration.set(
    list.map((s) =>
      s.kind === "insert"
        ? Decoration.mark({
            class: "cm-tc-insert",
            attributes: {
              style: `--tc-hue: ${authorHue(s.authorId)}`,
              title: `${s.authorName} suggested adding this`,
              "data-suggestion": s.id,
            },
          }).range(s.from, s.to)
        : Decoration.widget({
            widget: new DeletedText(s.id, s.text, s.authorName, authorHue(s.authorId)),
            side: -1,
          }).range(s.from),
    ),
    true,
  );
}

type Op =
  | { type: "insert"; from: number; to: number; skip?: boolean; extend?: { id: string; edge: "start" | "end" } }
  | { type: "delete"; pos: number; text: string; mergeWith?: string; prepend?: boolean };

function mapOp(op: Op, changes: ChangeDesc) {
  if (op.type === "insert") {
    op.from = changes.mapPos(op.from, 1);
    op.to = changes.mapPos(op.to, -1);
  } else {
    op.pos = changes.mapPos(op.pos, -1);
  }
}

function mapList(list: Suggestion[], changes: ChangeDesc): Suggestion[] {
  return list.map((s) =>
    s.kind === "insert"
      ? { ...s, from: changes.mapPos(s.from, 1), to: changes.mapPos(s.to, -1) }
      : { ...s, from: changes.mapPos(s.from, -1), to: changes.mapPos(s.from, -1) },
  );
}

/** Parts of [a, b) outside every insertion: deleting a suggestion's own text is not a deletion. */
function outside(a: number, b: number, inserts: Suggestion[]): [number, number][] {
  let parts: [number, number][] = [[a, b]];
  for (const s of inserts) {
    parts = parts.flatMap(([x, y]): [number, number][] => {
      if (s.to <= x || s.from >= y) return [[x, y]];
      const out: [number, number][] = [];
      if (s.from > x) out.push([x, s.from]);
      if (s.to < y) out.push([s.to, y]);
      return out;
    });
  }
  return parts;
}

export function trackChanges(options: TrackOptions): Extension {
  const setDecorations = StateEffect.define<DecorationSet>();

  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(setDecorations)) return e.value;
      return value.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const plugin = ViewPlugin.fromClass(
    class {
      binding: Binding | null = null;
      list: Suggestion[] = [];
      private queued = false;
      private destroyed = false;
      private lastReport = "";
      private readonly observer = () => this.refresh();
      /**
       * Undo brings text back as new characters. Positions find them through
       * Yjs's local "redone" links, which are not saved, so after an undo or
       * redo every suggestion is anchored again to the characters now there;
       * otherwise a reload would find them collapsed.
       */
      private readonly afterTransaction = (tr: Y.Transaction) => {
        const b = this.binding;
        if (!b || !(tr.origin instanceof Y.UndoManager)) return;
        const changed = tr.changed as Map<unknown, unknown>;
        if (!changed.has(b.ytext) && !changed.has(b.map)) return;
        queueMicrotask(() => this.reanchor());
      };

      constructor(readonly view: EditorView) {
        this.bind(view.state);
        this.refresh();
      }

      /** Follows the file's live text and its suggestions map; true when they are not the ones it had. */
      bind(state: EditorView["state"]): boolean {
        const next = bindingFor(state);
        if (next?.map === this.binding?.map && next?.ytext === this.binding?.ytext) return false;
        this.binding?.map.unobserve(this.observer);
        this.binding?.ytext.doc?.off("afterTransaction", this.afterTransaction);
        this.binding = next;
        this.binding?.map.observe(this.observer);
        this.binding?.ytext.doc?.on("afterTransaction", this.afterTransaction);
        this.list = [];
        return true;
      }

      reanchor() {
        const b = this.binding;
        if (this.destroyed || !b) return;
        const updates: [string, StoredSuggestion][] = [];
        for (const [id, raw] of b.map.entries()) {
          const s = raw as StoredSuggestion;
          if (s.kind === "insert") {
            const from = resolveAnchor(b.ytext, s.start);
            const to = resolveAnchor(b.ytext, s.end);
            if (from === null || to === null || to <= from) continue;
            const start = anchorAt(b.ytext, from, 0);
            const end = anchorAt(b.ytext, to, -1);
            if (start !== s.start || end !== s.end) updates.push([id, { ...s, start, end }]);
          } else if (s.kind === "delete") {
            const at = resolveAnchor(b.ytext, s.at);
            if (at === null) continue;
            const fresh = anchorAt(b.ytext, at, -1);
            if (fresh !== s.at) updates.push([id, { ...s, at: fresh }]);
          }
        }
        if (updates.length) {
          b.ytext.doc!.transact(() => updates.forEach(([id, s]) => b.map.set(id, s)), TIDY);
        }
      }

      update(u: ViewUpdate) {
        const rebound = this.bind(u.state);
        if (!this.binding) {
          if (this.list.length) {
            this.list = [];
            this.refresh();
          }
          return;
        }
        if (!u.docChanged) {
          // The file has just become live (the editor is made before its shared text arrives): the suggestions saved with it are read now. Without this they stayed hidden until the next edit.
          if (rebound) this.refresh();
          return;
        }
        const ops: Op[] = [];
        for (const tr of u.transactions) {
          if (!tr.docChanged) continue;
          for (const op of ops) mapOp(op, tr.changes);
          const mine =
            (options.suggesting || tr.annotation(suggestEdit) === true) &&
            !tr.annotation(ySyncAnnotation) &&
            !tr.annotation(reviewEdit) &&
            tr.annotation(Transaction.addToHistory) !== false;
          if (mine) ops.push(...this.opsFor(tr));
          this.list = mapList(this.list, tr.changes);
        }
        if (ops.length) this.record(ops);
        // Nothing to redraw in a file without suggestions.
        if (ops.length || this.list.length || this.binding.map.size) this.refresh();
      }

      opsFor(tr: Transaction): Op[] {
        const user = options.user;
        const inserts = this.list.filter((s) => s.kind === "insert");
        const out: Op[] = [];
        tr.changes.iterChanges((fromA, toA, fromB, toB) => {
          if (toA > fromA) {
            for (const [a, b] of outside(fromA, toA, inserts)) {
              const own = this.list.find(
                (s) => s.kind === "delete" && s.authorId === user.id && (s.from === b || s.from === a),
              );
              out.push({
                type: "delete",
                pos: tr.changes.mapPos(a, -1),
                text: tr.startState.doc.sliceString(a, b),
                mergeWith: own?.id,
                prepend: own ? own.from === b : false,
              });
            }
          }
          if (toB > fromB) {
            const inside = inserts.some((s) => s.from < fromA && fromA < s.to);
            const atEnd = inserts.find((s) => s.authorId === user.id && s.to === fromA);
            const atStart = inserts.find((s) => s.authorId === user.id && s.from === toA);
            out.push({
              type: "insert",
              from: fromB,
              to: toB,
              skip: inside,
              extend: atEnd ? { id: atEnd.id, edge: "end" } : atStart ? { id: atStart.id, edge: "start" } : undefined,
            });
          }
        });
        return out;
      }

      record(ops: Op[]) {
        const b = this.binding;
        if (!b) return;
        // The sync plugin runs first and has already written the edit to the
        // shared text; if it has not, wait for it.
        if (b.ytext.length !== this.view.state.doc.length) {
          queueMicrotask(() => {
            if (!this.destroyed && this.binding === b && b.ytext.length === this.view.state.doc.length) this.record(ops);
          });
          return;
        }
        const { id: authorId, name: authorName } = options.user;
        const now = Date.now();
        b.ytext.doc!.transact(() => {
          for (const op of ops) {
            if (op.type === "insert") {
              if (op.skip || op.to <= op.from) continue;
              const cur = op.extend ? (b.map.get(op.extend.id) as StoredSuggestion | undefined) : undefined;
              if (op.extend && cur) {
                b.map.set(
                  op.extend.id,
                  op.extend.edge === "end"
                    ? { ...cur, end: anchorAt(b.ytext, op.to, -1), time: now }
                    : { ...cur, start: anchorAt(b.ytext, op.from, 0), time: now },
                );
                continue;
              }
              const s: StoredSuggestion = {
                kind: "insert",
                start: anchorAt(b.ytext, op.from, 0),
                end: anchorAt(b.ytext, op.to, -1),
                authorId,
                authorName,
                time: now,
              };
              b.map.set(newId(), s);
            } else {
              if (!op.text) continue;
              const cur = op.mergeWith ? (b.map.get(op.mergeWith) as StoredSuggestion | undefined) : undefined;
              if (op.mergeWith && cur?.text !== undefined) {
                const text = op.prepend ? op.text + cur.text : cur.text + op.text;
                b.map.set(op.mergeWith, { ...cur, at: anchorAt(b.ytext, op.pos, -1), text: text.slice(0, MAX_DELETED), time: now });
                continue;
              }
              const s: StoredSuggestion = {
                kind: "delete",
                at: anchorAt(b.ytext, op.pos, -1),
                text: op.text.slice(0, MAX_DELETED),
                authorId,
                authorName,
                time: now,
              };
              b.map.set(newId(), s);
            }
          }
        }, b.origin);
      }

      /** Re-read every suggestion after this update, redraw, and report. */
      refresh() {
        if (this.queued) return;
        this.queued = true;
        queueMicrotask(() => {
          this.queued = false;
          if (this.destroyed) return;
          const b = this.binding;
          const docText = this.view.state.doc.toString();
          const { list, gone } = b ? readAll(b, docText) : { list: [], gone: [] };
          this.list = list;
          // Records that point nowhere are forgotten, but only when the editor shows the shared text as it is: read against a text that is a step behind, a good record can look lost.
          if (b && gone.length && docText === b.ytext.toString()) {
            b.ytext.doc!.transact(() => gone.forEach((id) => b.map.delete(id)), TIDY);
          }
          this.view.dispatch({ effects: setDecorations.of(decorationsFor(list)) });
          const report = JSON.stringify(list);
          if (report !== this.lastReport) {
            this.lastReport = report;
            options.onChange?.(list);
          }
        });
      }

      destroy() {
        this.destroyed = true;
        this.binding?.map.unobserve(this.observer);
        this.binding?.ytext.doc?.off("afterTransaction", this.afterTransaction);
      }
    },
  );

  const theme = EditorView.baseTheme({
    ".cm-tc-insert": {
      backgroundColor: "color-mix(in oklch, var(--tc-hue) 20%, transparent)",
      textDecoration: "underline",
      textDecorationColor: "var(--tc-hue)",
      textUnderlineOffset: "3px",
    },
    ".cm-tc-delete": {
      color: "var(--danger)",
      textDecoration: "line-through",
      textDecorationColor: "var(--danger)",
      backgroundColor: "color-mix(in oklch, var(--danger) 10%, transparent)",
      borderRadius: "2px",
      padding: "0 1px",
      cursor: "default",
    },
  });

  return [field, plugin, theme];
}

/**
 * Accept or reject suggestions by id, or all of them. Returns how many were
 * settled. Needs the live document; without it there are no suggestions.
 */
export function settleSuggestions(view: EditorView, ids: string[] | "all", action: "accept" | "reject"): number {
  const b = bindingFor(view.state);
  if (!b) return 0;
  const chosen = [...b.map.entries()].filter(([id]) => ids === "all" || ids.includes(id)) as [string, StoredSuggestion][];
  if (!chosen.length) return 0;

  if (action === "reject") {
    const docLength = view.state.doc.length;
    const removals: { from: number; to: number }[] = [];
    const restores: { at: number; text: string }[] = [];
    for (const [, s] of chosen) {
      if (s.kind === "insert") {
        const from = resolveAnchor(b.ytext, s.start);
        const to = resolveAnchor(b.ytext, s.end);
        if (from !== null && to !== null && to > from && to <= docLength) removals.push({ from, to });
      } else if (s.text) {
        const at = resolveAnchor(b.ytext, s.at);
        if (at !== null && at <= docLength) restores.push({ at, text: s.text });
      }
    }
    // One change per spot: putting text back where an insertion is being
    // removed (a rejected replacement) becomes a single replace.
    const changes: { from: number; to: number; insert: string }[] = removals
      .sort((x, y) => x.from - y.from)
      .reduce<{ from: number; to: number; insert: string }[]>((acc, r) => {
        const last = acc[acc.length - 1];
        if (last && r.from < last.to) last.to = Math.max(last.to, r.to);
        else acc.push({ ...r, insert: "" });
        return acc;
      }, []);
    for (const r of restores) {
      const hit = changes.find((c) => c.from === r.at || (c.from < r.at && r.at <= c.to));
      if (hit) hit.insert = hit.from === r.at ? r.text + hit.insert : hit.insert + r.text;
      else changes.push({ from: r.at, to: r.at, insert: r.text });
    }
    changes.sort((x, y) => x.from - y.from);
    if (changes.length) {
      view.dispatch({ changes, annotations: [reviewEdit.of(true)], userEvent: "review" });
    }
  }

  b.ytext.doc!.transact(() => {
    for (const [id] of chosen) b.map.delete(id);
  }, b.origin);
  return chosen.length;
}

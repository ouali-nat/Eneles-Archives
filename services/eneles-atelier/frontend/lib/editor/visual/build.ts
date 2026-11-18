/**
 * Draws one stretch of the document: the blocks first (the preamble, display math, tables, verbatim, environments), then the prose between them, then one decoration per line for headings, frames, and lists. Whatever the selection touches is left as source, styled quietly, so it can be edited; everything else is drawn. Nothing here changes the document.
 */
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { EditorState, Range, SelectionRange } from "@codemirror/state";
import type { Env, Scan } from "./scan";
import type { Numbering, ProjectContext, Target } from "./project";
import { fileScan, resolveInclude } from "./project";
import { displaySource } from "./math";
import { plainTex, today, type RenderContext } from "./render";
import {
  ACCENTS,
  DECLARATIONS,
  ESCAPES,
  FLOATS,
  LIST_ENVS,
  MATH_ENVS,
  QUIET,
  SYMBOLS,
  TABULAR_ENVS,
  TEXT_STYLES,
  accent,
  alpha,
  envTitle,
  groupEnd,
  isLetter,
  optEnd,
  readArgs,
  readName,
  roman,
  skipSpace,
} from "./tex";
import {
  BreakWidget,
  BulletWidget,
  CaptionLeadWidget,
  ChipWidget,
  EnvLabelWidget,
  FoldedWidget,
  FootnoteWidget,
  GlyphWidget,
  ImageWidget,
  LogoWidget,
  MarkerWidget,
  MathPreviewWidget,
  MathWidget,
  NumberWidget,
  PreambleWidget,
  QedWidget,
  TableWidget,
  TexWidget,
  TitleWidget,
} from "./widgets";
import type { WidgetType } from "@codemirror/view";

export interface VisualOptions {
  /** A URL for an image the document includes, or null if it is not in the project. */
  imageUrl?: (path: string) => string | null;
  /** Opens a project file by its path; false when there is no such file. */
  openFile?: (path: string) => boolean | void;
  /** The file being edited and the project's other files. */
  context?: () => { path: string | null; files: { path: string; text: string }[] };
}

export interface BuildInput {
  state: EditorState;
  scan: Scan;
  ctx: ProjectContext;
  numbering: Numbering;
  labels: Map<string, Target>;
  render: RenderContext;
  renderKey: string;
  from: number;
  to: number;
  preambleOpen: boolean;
  focused: boolean;
  togglePreamble: (view: EditorView) => void;
  options: VisualOptions;
  path: string | null;
  filePaths: string[];
}

export interface BuildOutput {
  decorations: DecorationSet;
  atomic: DecorationSet;
}

/** Environments that only arrange their content: no label, no frame. */
const LAYOUT_ENVS = /^(document|minipage|columns|column|multicols\*?|center|flushleft|flushright|adjustbox|landscape|spacing|singlespace|onehalfspace|doublespace|small|footnotesize|scriptsize|large|Large|samepage|frame|block|alertblock|exampleblock|onlyenv|overprint|subfigure|subtable|figure\*?|table\*?|wrapfigure|wraptable|sidewaysfigure|sidewaystable|algorithm|listing|tcolorbox|mdframed|framed|titlepage)$/;
const QUOTE_ENVS = /^(quote|quotation|verse|displayquote)$/;
const CODE_ENVS = /^(verbatim\*?|Verbatim\*?|BVerbatim|lstlisting|minted|alltt)$/;
const PICTURE_ENVS = /^(tikzpicture|tikzcd|forest|pgfpicture|asy|circuitikz)$/;

interface LineInfo {
  cls: Set<string>;
  envs: Env[];
  item: boolean;
}

interface Repl {
  from: number;
  to: number;
  widget?: WidgetType;
  atomic: boolean;
  /** Replaced with nothing at all (for working out which lines are left empty). */
  hidden: boolean;
}

export function build(input: BuildInput): BuildOutput {
  return new Builder(input).run();
}

class Builder {
  readonly text: string;
  readonly sel: readonly SelectionRange[];
  readonly repl: Repl[] = [];
  readonly marks: Range<Decoration>[] = [];
  readonly points: Range<Decoration>[] = [];
  readonly lineInfo = new Map<number, LineInfo>();
  /** Stretches the prose pass must not enter: drawn blocks and source shown as source. */
  readonly skips: [number, number][] = [];
  /** Lines shown as plain source (an open preamble, math being edited). */
  readonly sourceLines = new Set<number>();
  from: number;
  to: number;

  constructor(readonly input: BuildInput) {
    this.text = input.scan.text;
    this.sel = input.focused ? input.state.selection.ranges : [];
    this.from = input.from;
    this.to = input.to;
  }

  // ─── Helpers ───

  touched(from: number, to: number) {
    return this.sel.some((r) => r.from <= to && r.to >= from);
  }
  lineAt(pos: number) {
    return this.input.state.doc.lineAt(pos);
  }
  /** The selection is on any of the lines from `from` to `to`. */
  linesTouched(from: number, to: number) {
    return this.touched(this.lineAt(from).from, this.lineAt(to).to);
  }
  replace(from: number, to: number, widget?: WidgetType, atomic = false) {
    if (to < from) return;
    if (to === from && !widget) return;
    this.repl.push({ from, to, widget, atomic, hidden: !widget });
  }
  hide(from: number, to: number, atomic = false) {
    this.replace(from, to, undefined, atomic);
  }
  mark(from: number, to: number, cls: string, attributes?: Record<string, string>) {
    if (to > from) this.marks.push(Decoration.mark({ class: cls, attributes }).range(from, to));
  }
  /** A few characters of source standing for one character (a dash, a quote, an accent): drawn as it, and shown as typed while the cursor is beside it. */
  glyph(from: number, to: number, text: string) {
    if (!this.touched(from, to)) this.replace(from, to, new GlyphWidget(text));
  }
  markup(from: number, to: number) {
    this.mark(from, to, "cm-v-markup");
  }
  skip(from: number, to: number) {
    this.skips.push([from, to]);
  }
  line(pos: number): LineInfo {
    const from = this.lineAt(pos).from;
    let info = this.lineInfo.get(from);
    if (!info) {
      info = { cls: new Set(), envs: [], item: false };
      this.lineInfo.set(from, info);
    }
    return info;
  }
  lineClass(pos: number, cls: string) {
    this.line(pos).cls.add(cls);
  }
  /** Whether only spaces sit between the line start and `pos`. */
  startsLine(pos: number) {
    const l = this.lineAt(pos);
    return /^\s*$/.test(this.text.slice(l.from, pos));
  }
  /** Extends a block to the whole of its lines when only spaces (or a comment) lie beside it. */
  wholeLines(from: number, to: number): [number, number] {
    const a = this.lineAt(from);
    const b = this.lineAt(to);
    const start = /^\s*$/.test(this.text.slice(a.from, from)) ? a.from : from;
    const end = /^\s*(%.*)?$/.test(this.text.slice(to, b.to)) ? b.to : to;
    return [start, end];
  }
  overlaps(from: number, to: number) {
    return from <= this.to && to >= this.from;
  }
  forLines(from: number, to: number, fn: (lineFrom: number) => void) {
    const doc = this.input.state.doc;
    const first = doc.lineAt(Math.max(from, this.from)).number;
    const last = doc.lineAt(Math.min(to, this.to)).number;
    for (let n = first; n <= last; n++) fn(doc.line(n).from);
  }

  // ─── The pass ───

  run(): BuildOutput {
    const { scan } = this.input;
    // A block that crosses the edge of the stretch is drawn whole.
    for (const m of scan.maths) {
      if (m.from < this.from && m.to > this.from) this.from = this.lineAt(m.from).from;
      if (m.from < this.to && m.to > this.to) this.to = this.lineAt(m.to).to;
    }
    for (const e of scan.envs) {
      if (!e.raw && !TABULAR_ENVS.test(e.name)) continue;
      if (e.to === -1) continue;
      if (e.from < this.from && e.to > this.from) this.from = this.lineAt(e.from).from;
      if (e.from < this.to && e.to > this.to) this.to = this.lineAt(e.to).to;
    }
    this.from = this.lineAt(this.from).from;
    this.to = this.lineAt(this.to).to;

    this.preamble();
    this.afterDocument();
    this.mathBlocks();
    this.environments();
    this.skips.sort((a, b) => a[0] - b[0]);
    this.inline(this.from, this.to);
    return this.finish();
  }

  preamble() {
    const doc = this.input.scan.document;
    if (!doc) return;
    const end = this.lineAt(doc.headEnd).to;
    if (!this.overlaps(0, end)) return;
    const lines = this.lineAt(end).number;
    // The cursor at the very start of the file does not count as being in it.
    const inside = this.sel.some((r) => r.to > 0 && r.from <= end);
    const open = this.input.preambleOpen || inside;
    this.skip(0, end);
    if (open) {
      this.points.push(Decoration.widget({ widget: new PreambleWidget(lines, true, this.input.togglePreamble), block: true, side: -1 }).range(0));
      this.forLines(0, end, (l) => {
        this.sourceLines.add(l);
        this.lineClass(l, "cm-v-source");
      });
    } else this.replace(0, end, new PreambleWidget(lines, false, this.input.togglePreamble));
  }

  /** Whatever follows \end{document} is not typeset: shown as quiet source. */
  afterDocument() {
    const doc = this.input.scan.document;
    if (!doc || doc.endFrom === -1) return;
    const start = doc.endFrom;
    if (!this.overlaps(start, this.text.length)) return;
    const endLine = this.lineAt(doc.to);
    if (this.linesTouched(start, doc.to)) this.markup(start, doc.to);
    else if (/^\s*$/.test(this.text.slice(endLine.from, start))) this.hide(start, doc.to);
    else this.markup(start, doc.to);
    this.skip(start, doc.to);
    if (endLine.to < this.text.length) {
      this.skip(endLine.to, this.text.length);
      this.forLines(endLine.to + 1, this.text.length, (l) => {
        this.sourceLines.add(l);
        this.lineClass(l, "cm-v-source cm-v-ignored");
      });
    }
  }

  mathBlocks() {
    const { scan, numbering, render, renderKey } = this.input;
    for (const m of scan.maths) {
      if (!this.overlaps(m.from, m.to)) continue;
      if (scan.document && m.to <= scan.document.headEnd) continue;
      this.skip(m.from, m.to);
      const body = this.text.slice(m.bodyFrom, m.bodyTo);
      const tex = displaySource(m.env, body, numbering.equations.get(m.from));
      const labels = [...body.matchAll(/\\label\s*\{([^}]*)\}/g)].map((x) => x[1].trim());
      if (this.touched(m.from, m.to)) {
        this.forLines(m.from, m.to, (l) => {
          this.sourceLines.add(l);
          this.lineClass(l, "cm-v-source cm-v-source-math");
        });
        const end = this.lineAt(m.to).to;
        this.points.push(Decoration.widget({ widget: new MathPreviewWidget(tex, renderKey, render), block: true, side: 1 }).range(end));
        continue;
      }
      const [a, b] = this.wholeLines(m.from, m.to);
      this.replace(a, b, new MathWidget(tex, true, renderKey, render, labels.length ? `Label: ${labels.join(", ")}` : ""));
    }
  }

  environments() {
    const { scan } = this.input;
    for (const env of scan.envs) {
      if (env.endFrom === -1 || env === scan.document) continue;
      if (!this.overlaps(env.from, env.to)) continue;
      if (scan.document && env.to <= scan.document.headEnd) continue;
      if (MATH_ENVS.test(env.name)) continue;
      if (TABULAR_ENVS.test(env.name)) this.tabular(env);
      else if (env.raw) this.rawEnv(env);
      else this.proseEnv(env);
    }
  }

  tabular(env: Env) {
    const { render, renderKey } = this.input;
    this.skip(env.from, env.to);
    if (this.linesTouched(env.from, env.to)) {
      this.forLines(env.from, env.to, (l) => {
        this.sourceLines.add(l);
        this.lineClass(l, "cm-v-source");
      });
      return;
    }
    // tabularx, tabulary, and tabular* take a width before the column spec.
    const braces = env.args.filter((a) => a.kind === "{");
    const specArg = /^(tabularx|tabulary|tabular\*)$/.test(env.name) ? braces[1] : braces[0];
    const [a, b] = this.wholeLines(env.from, env.to);
    this.replace(a, b, new TableWidget(specArg ? this.text.slice(specArg.from, specArg.to) : "", this.text.slice(env.headEnd, env.endFrom), renderKey, render));
    this.addEnvLines(env);
  }

  rawEnv(env: Env) {
    this.skip(env.from, env.to);
    const lines = this.lineAt(env.to).number - this.lineAt(env.from).number + 1;
    if (PICTURE_ENVS.test(env.name)) {
      if (this.linesTouched(env.from, env.to)) {
        this.forLines(env.from, env.to, (l) => {
          this.sourceLines.add(l);
          this.lineClass(l, "cm-v-source");
        });
        return;
      }
      const [a, b] = this.wholeLines(env.from, env.to);
      this.replace(a, b, new FoldedWidget(env.name.startsWith("tikz") ? "TikZ picture" : envTitle(env.name), lines));
      this.addEnvLines(env);
      return;
    }
    // Code and verbatim: a labelled panel with the body exactly as written.
    const isComment = env.name === "comment";
    const lang = this.codeLanguage(env);
    this.envToken(env.from, env.headEnd, new EnvLabelWidget(isComment ? "generic" : "code", isComment ? "Comment" : CODE_ENVS.test(env.name) && env.name.startsWith("lst") || env.name === "minted" ? "Code" : "Verbatim", lang, this.input.renderKey, this.input.render));
    this.envToken(env.endFrom, env.to, undefined);
    const bodyFrom = this.lineAt(env.headEnd).to + 1;
    const bodyTo = this.lineAt(env.endFrom).from - 1;
    if (bodyTo >= bodyFrom)
      this.forLines(bodyFrom, bodyTo, (l) => {
        this.sourceLines.add(l);
        this.lineClass(l, isComment ? "cm-v-source cm-v-ignored" : "cm-v-code");
      });
    this.addEnvLines(env);
  }

  codeLanguage(env: Env): string {
    for (const a of env.args) {
      const s = this.text.slice(a.from, a.to);
      if (env.name === "minted" && a.kind === "{") return s.trim();
      const m = /language\s*=\s*\{?([A-Za-z+#]+)/.exec(s);
      if (m) return m[1];
    }
    return "";
  }

  /** A \begin or \end token: drawn as `widget` (or hidden), or shown as source when its line is being edited. */
  envToken(from: number, to: number, widget: WidgetType | undefined) {
    this.skip(from, to);
    if (this.linesTouched(from, to)) {
      this.markup(from, to);
      return;
    }
    if (widget) this.replace(from, to, widget);
    else this.hide(from, to);
  }

  proseEnv(env: Env) {
    const { ctx, numbering, render, renderKey } = this.input;
    const name = env.name;
    const bare = name.replace(/\*$/, "");
    const firstArg = (kind: "[" | "{") => {
      const a = env.args.find((x) => x.kind === kind);
      return a ? this.text.slice(a.from, a.to) : "";
    };
    let label: WidgetType | undefined;
    let end: WidgetType | undefined;
    const theorem = ctx.defs.theorems.get(bare);
    if (theorem) {
      const num = numbering.theorems.get(env.from);
      label = new EnvLabelWidget("theorem", num ? `${theorem.title} ${num}` : theorem.title, firstArg("["), renderKey, render);
    } else if (bare === "proof") {
      const note = firstArg("[");
      label = new EnvLabelWidget("proof", note ? "" : "Proof", "", renderKey, render);
      if (note) label = new TexWidget(`\\textit{${note}.}`, "cm-v-envlabel cm-v-envlabel-proof", renderKey, render);
      end = new QedWidget();
    } else if (bare === "abstract") {
      label = new EnvLabelWidget("abstract", "Abstract", "", renderKey, render);
    } else if (bare === "frame") {
      const title = env.args.find((a) => a.kind === "{");
      label = title ? new EnvLabelWidget("frame", "Slide", this.text.slice(title.from, title.to), renderKey, render) : new EnvLabelWidget("generic", "Slide", "", renderKey, render);
    } else if (/^(block|alertblock|exampleblock)$/.test(bare)) {
      label = new EnvLabelWidget("block", "", firstArg("{"), renderKey, render);
    } else if (bare === "thebibliography") {
      label = new EnvLabelWidget("abstract", "References", "", renderKey, render);
    } else if (!LIST_ENVS.test(name) && !QUOTE_ENVS.test(name) && !LAYOUT_ENVS.test(name)) {
      const args = env.args.map((a) => this.text.slice(a.from - 1, a.to + 1)).join("");
      label = new EnvLabelWidget("generic", envTitle(name), args, renderKey, render);
    }
    this.envToken(env.from, env.headEnd, label);
    this.envToken(env.endFrom, env.to, end);
    this.addEnvLines(env);
  }

  addEnvLines(env: Env) {
    this.forLines(env.from, env.to, (l) => this.line(l).envs.push(env));
  }

  // ─── Prose ───

  inline(from: number, to: number) {
    const skips = this.skips;
    // The first skip that ends after `from`.
    let sp = 0;
    let lo = 0;
    let hi = skips.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (skips[mid][1] <= from) lo = mid + 1;
      else hi = mid;
    }
    sp = lo;
    const re = /[\\%$~{}`'-]/g;
    let i = from;
    while (i < to) {
      while (sp < skips.length && skips[sp][1] <= i) sp++;
      if (sp < skips.length && skips[sp][0] <= i) {
        i = skips[sp][1];
        continue;
      }
      const limit = sp < skips.length ? Math.min(to, skips[sp][0]) : to;
      re.lastIndex = i;
      const m = re.exec(this.text);
      if (!m || m.index >= limit) {
        i = limit;
        continue;
      }
      i = this.token(m.index, to);
    }
  }

  /** Draws the token at `i` and returns where the next one may start. */
  token(i: number, to: number): number {
    const text = this.text;
    const c = text[i];
    switch (c) {
      case "%": {
        const eol = text.indexOf("\n", i);
        const end = eol === -1 ? text.length : eol;
        this.mark(i, end, "cm-v-comment");
        return end;
      }
      case "~":
        this.glyph(i, i + 1, "\u00a0");
        return i + 1;
      case "-": {
        if (text[i + 1] !== "-") return i + 1;
        const em = text[i + 2] === "-";
        this.glyph(i, i + (em ? 3 : 2), em ? "—" : "–");
        return i + (em ? 3 : 2);
      }
      case "`": {
        const dbl = text[i + 1] === "`";
        this.glyph(i, i + (dbl ? 2 : 1), dbl ? "“" : "‘");
        return i + (dbl ? 2 : 1);
      }
      case "'":
        if (text[i + 1] !== "'") return i + 1;
        this.glyph(i, i + 2, "”");
        return i + 2;
      case "$":
        return this.inlineMath(i, "$", "$");
      case "{":
        return this.group(i, to);
      case "}":
        return i + 1;
      default:
        return this.command(i, to);
    }
  }

  inlineMath(i: number, open: string, close: string): number {
    const text = this.text;
    if (open === "$" && text[i + 1] === "$") {
      this.markup(i, i + 2);
      return i + 2;
    }
    // The closing delimiter, on this paragraph.
    let j = i + open.length;
    let found = -1;
    const stop = Math.min(text.length, j + 3000);
    for (; j < stop; j++) {
      const ch = text[j];
      if (ch === "\\") {
        if (close === "\\)" && text[j + 1] === ")") {
          found = j;
          break;
        }
        j++;
        continue;
      }
      if (ch === "$" && close === "$") {
        found = j;
        break;
      }
      if (ch === "\n" && /^\n[ \t]*\n/.test(text.slice(j, j + 40))) break;
    }
    if (found === -1) {
      this.mark(i, i + open.length, "cm-v-markup cm-v-unbalanced");
      return i + open.length;
    }
    const end = found + close.length;
    const tex = text.slice(i + open.length, found);
    if (this.touched(i, end)) this.mark(i, end, "cm-v-math-source");
    else this.replace(i, end, new MathWidget(tex.trim(), false, this.input.renderKey, this.input.render));
    return end;
  }

  group(i: number, to: number): number {
    const text = this.text;
    if (text[i + 1] === "," && text[i + 2] === "}") {
      // 4{,}096: only the braces go.
      if (!this.touched(i, i + 3)) {
        this.hide(i, i + 1);
        this.hide(i + 2, i + 3);
      }
      return i + 3;
    }
    if (text[i + 1] === "}") {
      if (!this.touched(i, i + 2)) this.hide(i, i + 2);
      return i + 2;
    }
    const g = groupEnd(text, i, Math.max(to, i + 1));
    if (g === -1) return i + 1;
    const shown = this.touched(i, g);
    // {\bf …}, {\em …}, {\small …}
    const k = skipSpace(text, i + 1);
    if (text[k] === "\\" && isLetter(text[k + 1])) {
      const { name, end } = readName(text, k);
      const cls = DECLARATIONS[name];
      if (cls) {
        const inner = skipSpace(text, end);
        if (shown) {
          this.markup(i, inner);
          this.markup(g - 1, g);
        } else {
          this.hide(i, inner);
          this.hide(g - 1, g);
        }
        this.mark(inner, g - 1, cls);
        this.inline(inner, g - 1);
        return g;
      }
    }
    if (shown) {
      this.mark(i, i + 1, "cm-v-markup cm-v-brace");
      this.mark(g - 1, g, "cm-v-markup cm-v-brace");
    } else {
      this.hide(i, i + 1);
      this.hide(g - 1, g);
    }
    this.inline(i + 1, g - 1);
    return g;
  }

  command(i: number, to: number): number {
    const text = this.text;
    const next = text[i + 1];
    if (next === undefined) return i + 1;
    if (!isLetter(next)) return this.symbolCommand(i);
    const { name, end } = readName(text, i);
    const { scan, numbering, labels, ctx, render, renderKey, options } = this.input;

    const head = scan.heads.get(i);
    if (head) return this.heading(i);

    if (name === "begin" || name === "end") {
      // Not paired with anything: shown as quiet source.
      const k = skipSpace(text, end);
      const close = text[k] === "{" ? text.indexOf("}", k) : -1;
      const stop = close !== -1 && close - k < 60 ? close + 1 : end;
      this.mark(i, stop, "cm-v-markup cm-v-unbalanced");
      return stop;
    }

    const item = scan.items.get(i);
    // An item of a list that never closes stays as source, like the list itself.
    if (item && item.list.endFrom !== -1) {
      // Take the space after \item with it, so the text starts right after the bullet.
      let stop = item.end;
      if (text[stop] === " ") stop++;
      this.line(i).item = true;
      if (this.touched(i, stop)) {
        this.markup(i, item.end);
        return item.end;
      }
      if (item.label) {
        this.replace(i, stop, new BulletWidget("", text.slice(item.label.from, item.label.to), renderKey, render));
      } else {
        // Depth among the lists that do close.
        let depth = 0;
        for (let e: Env | null = item.list; e; e = e.parent) if (LIST_ENVS.test(e.name) && e.endFrom !== -1) depth++;
        this.replace(i, stop, new BulletWidget(this.bullet(item.list, item.index, depth), null, renderKey, null));
      }
      return stop;
    }

    if (name in TEXT_STYLES) return this.styled(i, end, name, TEXT_STYLES[name]);
    if (name === "textcolor" || name === "colorbox") return this.wrapper(i, end, "omm", 2, "");
    if (name === "href") return this.link(i, end, true);
    if (name === "url" || name === "nolinkurl") return this.link(i, end, false);

    if (/^(cite|citep|citet|citealp|citealt|citeauthor|citeyear|citeyearpar|parencite|textcite|autocite|footcite|smartcite|Cite|Citep|Citet|Textcite|Parencite|Autocite|nocite|citenum)$/.test(name)) {
      const r = readArgs(text, end, "soom");
      const keyArg = r?.args[3];
      if (!r || !keyArg) return this.unknown(i, end);
      const keys = text
        .slice(keyArg.from, keyArg.to)
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      if (this.touched(i, r.end)) {
        this.markup(i, keyArg.from);
        this.mark(keyArg.from, keyArg.to, "cm-v-cite-source");
        this.markup(keyArg.to, r.end);
        return r.end;
      }
      // With one option it is the note after; with two, the second is.
      const post = r.args[2] ?? r.args[1];
      const note = post ? plainTex(text.slice(post.from, post.to), render) : "";
      const textual = /^(citet|Citet|textcite|Textcite|citeauthor|citeyear)$/.test(name);
      const shown = keys.join(", ") + (note ? `, ${note}` : "");
      this.replace(i, r.end, new ChipWidget(name === "nocite" ? `Not cited: ${shown}` : textual ? shown : `[${shown}]`, "cm-v-cite", `\\${name}{${keys.join(",")}}`));
      return r.end;
    }

    if (/^(ref|eqref|autoref|Autoref|cref|Cref|pageref|nameref|vref|Vref|cpageref|labelcref)$/.test(name)) {
      const r = readArgs(text, end, "sm");
      if (!r || !r.args[1]) return this.unknown(i, end);
      const key = text.slice(r.args[1].from, r.args[1].to).trim();
      if (this.touched(i, r.end)) {
        this.markup(i, r.args[1].from);
        this.mark(r.args[1].from, r.args[1].to, "cm-v-ref-source");
        this.markup(r.args[1].to, r.end);
        return r.end;
      }
      const target = key.includes(",") ? undefined : labels.get(key);
      let shown = key;
      if (target && name !== "pageref" && name !== "cpageref") {
        if (name === "eqref") shown = `(${target.num})`;
        else if (/^(autoref|Autoref|cref|Cref|vref|Vref|labelcref)$/.test(name)) shown = target.kind === "Equation" ? `Equation (${target.num})` : `${target.kind} ${target.num}`;
        else shown = target.num;
      }
      this.replace(i, r.end, new ChipWidget(shown, target ? "cm-v-ref" : "cm-v-ref cm-v-ref-unknown", target ? `${target.kind} ${target.num}: ${key}` : `Reference to ${key}`));
      return r.end;
    }

    switch (name) {
      case "label": {
        const r = readArgs(text, end, "m");
        if (!r || !r.args[0]) return this.unknown(i, end);
        const key = text.slice(r.args[0].from, r.args[0].to).trim();
        if (this.touched(i, r.end)) {
          this.markup(i, r.end);
          return r.end;
        }
        this.replace(i, r.end, new ChipWidget(key, "cm-v-label", `Label ${key}`));
        return r.end;
      }
      case "footnote": {
        const r = readArgs(text, end, "om");
        if (!r || !r.args[1]) return this.unknown(i, end);
        const body = r.args[1];
        if (this.touched(i, r.end)) {
          this.markup(i, body.from);
          this.markup(body.to, r.end);
          this.mark(body.from, body.to, "cm-v-footnote-text");
          this.inline(body.from, body.to);
          return r.end;
        }
        const n = numbering.footnotes.get(i);
        this.replace(i, r.end, new FootnoteWidget(n ? String(n) : "*", plainTex(text.slice(body.from, body.to), render)));
        return r.end;
      }
      case "thanks":
      case "footnotetext": {
        const r = readArgs(text, end, "om");
        if (!r) return this.unknown(i, end);
        if (this.touched(i, r.end)) this.markup(i, r.end);
        else this.replace(i, r.end, new FootnoteWidget("*", plainTex(text.slice(r.args[1]!.from, r.args[1]!.to), render)));
        return r.end;
      }
      case "includegraphics": {
        const r = readArgs(text, end, "som");
        if (!r || !r.args[2]) return this.unknown(i, end);
        const path = text.slice(r.args[2].from, r.args[2].to).trim();
        if (this.touched(i, r.end)) {
          this.markup(i, r.end);
          return r.end;
        }
        const opts = r.args[1] ? text.slice(r.args[1].from, r.args[1].to) : "";
        const w = /width\s*=\s*([\d.]+)\s*\\(linewidth|textwidth|columnwidth)/.exec(opts);
        const width = w ? `${Math.min(100, Math.round(Number.parseFloat(w[1]) * 100))}%` : "";
        this.replace(i, r.end, new ImageWidget(options.imageUrl?.(path) ?? null, path, width));
        if (this.startsLine(i)) this.lineClass(i, "cm-v-figure-line");
        return r.end;
      }
      case "caption":
      case "captionof":
        return this.caption(i, end, name);
      case "maketitle":
      case "titlepage": {
        if (this.linesTouched(i, end)) {
          this.markup(i, end);
          return end;
        }
        const fields: Record<string, string> = {};
        for (const [k, v] of Object.entries(scan.fields)) fields[k] = text.slice(v.from, v.to);
        this.replace(i, end, new TitleWidget(fields, renderKey, render));
        return end;
      }
      case "frametitle":
      case "framesubtitle": {
        const r = readArgs(text, end, "oom");
        if (!r || !r.args[2]) return this.unknown(i, end);
        if (this.startsLine(i)) this.lineClass(i, name === "frametitle" ? "cm-v-frametitle" : "cm-v-framesubtitle");
        return this.wrapped(i, r.end, r.args[2], "");
      }
      case "LaTeX":
      case "TeX":
      case "LaTeXe":
      case "BibTeX": {
        const stop = text[end] === "{" && text[end + 1] === "}" ? end + 2 : end;
        if (this.touched(i, stop)) {
          this.markup(i, stop);
          return stop;
        }
        this.replace(i, stop, new LogoWidget(name));
        return stop;
      }
      case "today": {
        const stop = text[end] === "{" && text[end + 1] === "}" ? end + 2 : end;
        if (this.touched(i, stop)) this.markup(i, stop);
        else this.replace(i, stop, new GlyphWidget(today()));
        return stop;
      }
      case "verb": {
        const d = text[end] === "*" ? end + 1 : end;
        const delim = text[d];
        const close = delim ? text.indexOf(delim, d + 1) : -1;
        if (!delim || close === -1 || text.slice(d, close).includes("\n")) return this.unknown(i, end);
        if (this.touched(i, close + 1)) this.markup(i, close + 1);
        else {
          this.hide(i, d + 1);
          this.mark(d + 1, close, "cm-v-mono");
          this.hide(close, close + 1);
        }
        return close + 1;
      }
      case "input":
      case "include":
      case "subfile":
      case "import":
      case "subimport":
      case "inputfrom":
      case "subinputfrom":
      case "includefrom":
      case "subincludefrom": {
        const inc = scan.includes.get(i);
        if (!inc) return this.unknown(i, end);
        if (this.linesTouched(i, inc.to)) {
          this.markup(i, inc.to);
          return inc.to;
        }
        const target = resolveInclude(inc.path, this.input.path, this.input.filePaths);
        const open = options.openFile;
        // Name the row after the file's first heading, when it has one.
        const file = target ? ctx.files.get(target) : undefined;
        const first = file ? [...fileScan(file).heads.values()][0] : undefined;
        let title = first?.title ? plainTex(file!.text.slice(first.title.from, first.title.to), render) : "";
        if (!title && file) {
          // No heading: name it after its first environment (an abstract), or its file name.
          const env = fileScan(file).envs[0];
          title = env && env.name !== "document" ? envTitle(env.name) : envTitle(target!.replace(/^.*\//, "").replace(/\.tex$/, ""));
        }
        this.replace(
          i,
          inc.to,
          new MarkerWidget(title || "Missing file", target ?? `${inc.path}.tex is not in the project`, "cm-v-marker-file", target && open ? { label: "Open", run: () => open(target) } : null),
        );
        return inc.to;
      }
      case "bibliography":
      case "addbibresource": {
        const r = readArgs(text, end, "om");
        if (!r || !r.args[1]) return this.unknown(i, end);
        if (this.linesTouched(i, r.end)) {
          this.markup(i, r.end);
          return r.end;
        }
        const names = text
          .slice(r.args[1].from, r.args[1].to)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => (s.endsWith(".bib") ? s : `${s}.bib`));
        if (name === "addbibresource") {
          this.replace(i, r.end, new MarkerWidget("References from", names.join(", "), "cm-v-marker-quiet"));
          return r.end;
        }
        const first = names.map((n) => resolveInclude(n, this.input.path, this.input.filePaths)).find(Boolean) ?? null;
        const open = options.openFile;
        this.replace(i, r.end, new MarkerWidget("Bibliography", names.join(", "), first && open ? "cm-v-marker-bib" : "cm-v-marker-divider", first && open ? { label: "Open", run: () => open(first) } : null));
        return r.end;
      }
      case "bibliographystyle": {
        const r = readArgs(text, end, "m");
        if (!r || !r.args[0]) return this.unknown(i, end);
        if (this.linesTouched(i, r.end)) this.markup(i, r.end);
        else this.replace(i, r.end, new MarkerWidget("Citation style", text.slice(r.args[0].from, r.args[0].to).trim(), "cm-v-marker-quiet"));
        return r.end;
      }
      case "bibitem": {
        const r = readArgs(text, end, "om");
        if (!r || !r.args[1]) return this.unknown(i, end);
        if (this.touched(i, r.end)) this.markup(i, r.end);
        else this.replace(i, r.end, new ChipWidget(text.slice(r.args[1].from, r.args[1].to).trim(), "cm-v-cite"));
        return r.end;
      }
    }

    const markers: Record<string, [string, string]> = {
      tableofcontents: ["Table of contents", "cm-v-marker-divider"],
      listoffigures: ["List of figures", "cm-v-marker-divider"],
      listoftables: ["List of tables", "cm-v-marker-divider"],
      printindex: ["Index", "cm-v-marker-divider"],
      printbibliography: ["Bibliography", "cm-v-marker-divider"],
      printglossary: ["Glossary", "cm-v-marker-divider"],
      printglossaries: ["Glossary", "cm-v-marker-divider"],
      appendix: ["Appendix", "cm-v-marker-divider"],
      newpage: ["Page break", "cm-v-marker-page"],
      clearpage: ["Page break", "cm-v-marker-page"],
      cleardoublepage: ["Page break", "cm-v-marker-page"],
      pagebreak: ["Page break", "cm-v-marker-page"],
      frontmatter: ["Front matter", "cm-v-marker-divider"],
      mainmatter: ["Main matter", "cm-v-marker-divider"],
      backmatter: ["Back matter", "cm-v-marker-divider"],
    };
    if (name in markers) {
      const r = readArgs(text, end, name === "printbibliography" || name === "printglossary" ? "o" : name === "pagebreak" ? "o" : "");
      const stop = r ? r.end : end;
      if (this.linesTouched(i, stop)) this.markup(i, stop);
      else this.replace(i, stop, new MarkerWidget(markers[name][0], "", markers[name][1]));
      return stop;
    }

    if (name in SYMBOLS) {
      const stop = text[end] === "{" && text[end + 1] === "}" ? end + 2 : end;
      this.glyph(i, stop, SYMBOLS[name]);
      return stop;
    }
    if (name.length === 1 && name in ACCENTS) {
      const r = this.accentArg(end);
      if (r) {
        this.glyph(i, r.end, accent(ACCENTS[name], r.letter));
        return r.end;
      }
    }
    if (name in DECLARATIONS) {
      // A bare declaration (\small, \bfseries) with no group of its own: nothing to show.
      const stop = skipSpace(text, end);
      if (this.touched(i, stop)) this.markup(i, stop);
      else this.hide(i, stop);
      return stop;
    }
    if (name in QUIET) {
      const r = readArgs(text, end, QUIET[name]);
      const stop = r ? r.end : end;
      if (this.touched(i, stop)) this.markup(i, stop);
      else this.hide(i, stop);
      return stop;
    }

    // The project's own macros.
    const macro = ctx.defs.macros.get(name);
    if (macro) {
      const r = macro.nargs ? readArgs(text, end, "m".repeat(macro.nargs)) : { end: text[end] === "{" && text[end + 1] === "}" ? end + 2 : end, args: [] };
      if (!r) return this.unknown(i, end);
      if (this.touched(i, r.end)) {
        this.markup(i, r.end);
        return r.end;
      }
      let body = macro.body;
      r.args.forEach((a, k) => {
        body = body.split(`#${k + 1}`).join(a ? text.slice(a.from, a.to) : "");
      });
      const textual = !/\\(math|ensuremath|operatorname|left|right|frac|mathbb|mathcal|mathrm|mathbf)/.test(body) && plainTex(body, render) !== "";
      const ok = textual && renderOk(body, render);
      this.replace(i, r.end, ok ? new TexWidget(body, "cm-v-macro", renderKey, render, `\\${name}`) : new ChipWidget(name, "cm-v-macro-chip", `\\${name}: a macro defined in this project`));
      return r.end;
    }

    return this.unknown(i, end);
  }

  symbolCommand(i: number): number {
    const text = this.text;
    const next = text[i + 1];
    if (next === "\\") {
      // \\ and \\[4pt], and \\* .
      let stop = i + 2;
      if (text[stop] === "*") stop++;
      const o = optEnd(text, skipSpace(text, stop));
      if (o > stop) stop = o;
      if (this.touched(i, stop)) this.markup(i, stop);
      else this.replace(i, stop, new BreakWidget());
      return stop;
    }
    if (next === "(") return this.inlineMath(i, "\\(", "\\)");
    if (next === "[" || next === "]" || next === ")") {
      this.mark(i, i + 2, "cm-v-markup cm-v-unbalanced");
      return i + 2;
    }
    if (next in ACCENTS) {
      const r = this.accentArg(i + 2);
      if (r) {
        this.glyph(i, r.end, accent(ACCENTS[next], r.letter));
        return r.end;
      }
    }
    if (next in ESCAPES) {
      const glyph = ESCAPES[next];
      if (this.touched(i, i + 2)) return i + 2;
      // \% and friends: the backslash goes and the character stays, so the text is still text.
      if (glyph === next) this.hide(i, i + 1);
      else if (glyph) this.replace(i, i + 2, new GlyphWidget(glyph));
      else this.hide(i, i + 2);
      return i + 2;
    }
    return i + 2;
  }

  accentArg(i: number): { letter: string; end: number } | null {
    const text = this.text;
    if (text[i] === "{") {
      const g = groupEnd(text, i);
      if (g === -1) return null;
      const inner = text.slice(i + 1, g - 1).trim();
      return inner.length >= 1 && inner.length <= 2 ? { letter: inner, end: g } : null;
    }
    if (text[i] === "\\" && (text[i + 1] === "i" || text[i + 1] === "j") && !isLetter(text[i + 2])) return { letter: text.slice(i, i + 2), end: i + 2 };
    if (isLetter(text[i])) return { letter: text[i], end: i + 1 };
    return null;
  }

  heading(i: number): number {
    const { scan, numbering } = this.input;
    const h = scan.heads.get(i)!;
    if (!h.title) {
      this.mark(i, h.nameEnd, "cm-v-markup cm-v-unbalanced");
      return h.nameEnd;
    }
    const runIn = h.level >= 4 || !this.startsLine(i);
    if (!runIn) this.lineClass(i, `cm-v-h cm-v-h${h.level < 0 ? "p" : h.level}`);
    const num = numbering.heads.get(i);
    if (this.touched(i, h.end)) {
      this.markup(i, h.title.from);
      this.markup(h.title.to, h.end);
    } else {
      const lead = num ? new NumberWidget(h.level < 0 ? `Part ${num}` : num) : undefined;
      this.replace(i, h.title.from, lead);
      this.hide(h.title.to, h.end);
    }
    if (runIn) this.mark(h.title.from, h.title.to, "cm-v-bold cm-v-runin");
    this.inline(h.title.from, h.title.to);
    return h.end;
  }

  styled(i: number, end: number, name: string, cls: string): number {
    const r = readArgs(this.text, end, "m");
    if (!r || !r.args[0]) return this.unknown(i, end);
    const a = r.args[0];
    if (name === "enquote" && !this.touched(i, r.end)) {
      this.replace(i, a.from, new GlyphWidget("“"));
      this.replace(a.to, r.end, new GlyphWidget("”"));
      this.inline(a.from, a.to);
      return r.end;
    }
    return this.wrapped(i, r.end, a, cls);
  }

  /** A command whose one argument is the text: the command and braces give way to `cls` on the text. */
  wrapped(i: number, stop: number, a: { from: number; to: number }, cls: string): number {
    if (this.touched(i, stop)) {
      this.markup(i, a.from);
      this.markup(a.to, stop);
    } else {
      this.hide(i, a.from);
      this.hide(a.to, stop);
    }
    if (cls) this.mark(a.from, a.to, cls);
    this.inline(a.from, a.to);
    return stop;
  }

  wrapper(i: number, end: number, shape: string, index: number, cls: string): number {
    const r = readArgs(this.text, end, shape);
    const a = r?.args[index];
    if (!r || !a) return this.unknown(i, end);
    return this.wrapped(i, r.end, a, cls);
  }

  link(i: number, end: number, href: boolean): number {
    const text = this.text;
    const r = readArgs(text, end, href ? "mm" : "m");
    if (!r) return this.unknown(i, end);
    const url = r.args[0]!;
    const label = href ? r.args[1]! : url;
    const target = text.slice(url.from, url.to);
    if (this.touched(i, r.end)) {
      this.markup(i, label.from);
      this.markup(label.to, r.end);
    } else {
      this.hide(i, label.from);
      this.hide(label.to, r.end);
    }
    this.mark(label.from, label.to, "cm-v-link", { title: target });
    if (href) this.inline(label.from, label.to);
    return r.end;
  }

  caption(i: number, end: number, name: string): number {
    const text = this.text;
    const r = readArgs(text, end, name === "captionof" ? "smom" : "som");
    const body = r?.args[name === "captionof" ? 3 : 2];
    if (!r || !body) return this.unknown(i, end);
    let float = "";
    if (name === "captionof") float = text.slice(r.args[1]!.from, r.args[1]!.to).trim();
    else {
      const envs = this.line(i).envs;
      for (let k = envs.length - 1; k >= 0; k--) {
        if (envs[k].name in FLOATS) {
          float = envs[k].name;
          break;
        }
      }
    }
    const kind = FLOATS[float] ?? (float ? envTitle(float) : "");
    const num = this.input.numbering.captions.get(i);
    if (this.startsLine(i)) this.lineClass(i, "cm-v-caption-line");
    if (this.touched(i, r.end)) {
      this.markup(i, body.from);
      this.markup(body.to, r.end);
    } else {
      this.replace(i, body.from, kind ? new CaptionLeadWidget(num && !r.star ? `${kind} ${num}:` : `${kind}:`) : undefined);
      this.hide(body.to, r.end);
    }
    this.mark(body.from, body.to, "cm-v-caption");
    this.inline(body.from, body.to);
    return r.end;
  }

  /** A command nobody taught us: its name stays as quiet source, its brace arguments keep their text. */
  unknown(i: number, end: number): number {
    this.mark(i, end, "cm-v-markup cm-v-unknown");
    const text = this.text;
    let j = end;
    if (text[j] === "*") j++;
    for (let count = 0; count < 4; count++) {
      if (text[j] === "[") {
        const o = optEnd(text, j);
        if (o <= j) break;
        this.mark(j, o, "cm-v-markup cm-v-unknown");
        j = o;
      } else if (text[j] === "{") {
        const g = groupEnd(text, j);
        if (g === -1) break;
        this.mark(j, j + 1, "cm-v-markup cm-v-unknown");
        this.mark(g - 1, g, "cm-v-markup cm-v-unknown");
        this.inline(j + 1, g - 1);
        j = g;
      } else break;
    }
    return j;
  }

  bullet(list: Env, index: number, depth: number): string {
    const name = list.name.replace(/\*$/, "");
    if (name === "itemize" || name === "compactitem") return ["•", "–", "∗", "·"][(depth - 1) % 4];
    if (name === "description") return "";
    // enumerate, with enumitem's label=… when given.
    const opt = list.args.find((a) => a.kind === "[");
    const label = opt ? /label\s*=\s*\{?([^,}\]]*\\(arabic|alph|Alph|roman|Roman)\*[^,}\]]*)/.exec(this.text.slice(opt.from, opt.to)) : null;
    const fmt = (kind: string) => (kind === "alph" ? alpha(index) : kind === "Alph" ? alpha(index).toUpperCase() : kind === "roman" ? roman(index) : kind === "Roman" ? roman(index).toUpperCase() : String(index));
    if (label) return label[1].replace(/\\(arabic|alph|Alph|roman|Roman)\*/, (_, k: string) => fmt(k)).replace(/[{}]/g, "").trim();
    const levels = [(n: number) => `${n}.`, (n: number) => `(${alpha(n)})`, (n: number) => `${roman(n)}.`, (n: number) => `${alpha(n).toUpperCase()}.`];
    return levels[(depth - 1) % 4](index);
  }

  // ─── Lines and the final set ───

  finish(): BuildOutput {
    const doc = this.input.state.doc;
    const text = this.text;
    // Replacements must not overlap: the earlier (and on a tie, the longer) one wins.
    const repl = this.repl.sort((a, b) => a.from - b.from || b.to - a.to);
    const kept: Repl[] = [];
    let reach = -1;
    for (const r of repl) {
      if (r.from < reach) continue;
      kept.push(r);
      reach = Math.max(reach, r.to);
    }

    // Lines: classes, indentation, hidden leading spaces, and lines left with nothing to show.
    const decos: Range<Decoration>[] = [];
    const atomic: Range<Decoration>[] = [];
    let k = 0;
    const firstLine = doc.lineAt(this.from).number;
    const lastLine = doc.lineAt(this.to).number;
    const extra: Repl[] = [];
    for (let n = firstLine; n <= lastLine; n++) {
      const line = doc.line(n);
      // Lines swallowed by a multi-line replacement draw nothing of their own.
      while (k < kept.length && kept[k].to < line.from) k++;
      let covered = false;
      for (let q = k; q < kept.length && kept[q].from <= line.from; q++) {
        if (kept[q].from < line.from && kept[q].to >= line.from) covered = true;
      }
      if (covered) continue;
      const info = this.lineInfo.get(line.from);
      const cls: string[] = info ? [...info.cls] : [];
      const style: string[] = [];
      const source = this.sourceLines.has(line.from);

      if (!source && line.length) {
        // Leading spaces are layout, not text.
        let w = 0;
        while (w < line.length && (text[line.from + w] === " " || text[line.from + w] === "\t")) w++;
        let clash = false;
        for (let q = k; q < kept.length && kept[q].from < line.from + w; q++) if (kept[q].to > line.from) clash = true;
        if (w > 0 && w < line.length && !clash) extra.push({ from: line.from, to: line.from + w, atomic: true, hidden: true });
        // Nothing left to show on this line?
        if (!this.touched(line.from, line.to) && w < line.length) {
          let visible = false;
          let pos = line.from + w;
          for (let q = k; q < kept.length && kept[q].from <= line.to && !visible; q++) {
            const r = kept[q];
            if (r.to <= pos) continue;
            if (/\S/.test(text.slice(pos, Math.min(r.from, line.to)))) visible = true;
            else if (r.widget) visible = true;
            pos = Math.max(pos, r.to);
          }
          if (!visible && pos < line.to && /\S/.test(text.slice(pos, line.to))) visible = true;
          if (!visible) cls.push("cm-v-collapsed");
        }
      }

      // Frames and lists from the environments around this line.
      if (info && info.envs.length) {
        let pad = 0;
        let rule: Env | null = null;
        let ruleAt = 0;
        for (const env of info.envs) {
          const name = env.name.replace(/\*$/, "");
          const theorem = this.input.ctx.defs.theorems.get(name);
          if (LIST_ENVS.test(env.name)) pad += 1.75;
          else if (QUOTE_ENVS.test(env.name)) {
            cls.push("cm-v-quote");
            pad += 1.5;
          } else if (name === "abstract") cls.push("cm-v-abstract");
          else if (name === "center" || env.name in FLOATS) cls.push("cm-v-center");
          else if (name === "flushright") cls.push("cm-v-right");
          else if (theorem || name === "proof" || name === "frame" || /^(block|alertblock|exampleblock)$/.test(name) || (!LAYOUT_ENVS.test(env.name) && name !== "thebibliography" && !env.raw && !TABULAR_ENVS.test(env.name))) {
            rule = env;
            ruleAt = pad;
            pad += 1;
          }
          if (theorem?.italic && env.headEnd <= line.from && line.to <= env.endFrom) cls.push("cm-v-italic-body");
        }
        if (rule) {
          cls.push("cm-v-ruled");
          const rname = rule.name.replace(/\*$/, "");
          if (rname === "proof") cls.push("cm-v-ruled-proof");
          else if (rname === "frame") cls.push("cm-v-slide");
          else if (/^(block|alertblock|exampleblock)$/.test(rname)) cls.push("cm-v-blockenv");
          else if (!this.input.ctx.defs.theorems.has(rname)) cls.push("cm-v-ruled-generic");
          style.push(`--v-rule:${ruleAt}em`);
        }
        if (pad) style.push(`--v-pad:${pad}em`);
      }
      if (info?.item) cls.push("cm-v-item-line");
      if (cls.length || style.length) decos.push(Decoration.line({ class: cls.join(" "), attributes: style.length ? { style: style.join(";") } : undefined }).range(line.from));
    }

    for (const r of [...kept, ...extra]) {
      const deco = Decoration.replace(r.widget ? { widget: r.widget } : {});
      decos.push(deco.range(r.from, r.to));
      if (r.atomic) atomic.push(deco.range(r.from, r.to));
    }
    decos.push(...this.marks, ...this.points);
    let decorations: DecorationSet;
    try {
      decorations = Decoration.set(decos, true);
    } catch {
      decorations = Decoration.none;
    }
    let atomicSet: DecorationSet;
    try {
      atomicSet = Decoration.set(atomic, true);
    } catch {
      atomicSet = Decoration.none;
    }
    return { decorations, atomic: atomicSet };
  }
}

function renderOk(src: string, ctx: RenderContext): boolean {
  // Cheap test: every command in it is one the small renderer knows or a macro.
  for (const m of src.matchAll(/\\([a-zA-Z]+)/g)) {
    const n = m[1];
    if (n in TEXT_STYLES || n in DECLARATIONS || n in SYMBOLS || n in QUIET || ctx.macros.has(n)) continue;
    if (/^(LaTeX|TeX|LaTeXe|BibTeX|today|xspace|textcolor|href|url|ref|cite|label|text|and|footnote|thanks)$/.test(n)) continue;
    return false;
  }
  return true;
}

/**
 * The pieces drawn in place of LaTeX source. A widget only draws; where it sits and when it gives way to the source is decided in build.ts. Clicking a widget lets the editor put the cursor beside it, which reveals the source, except on the few controls (open a file, show the preamble) that act instead.
 */
import { WidgetType, type EditorView } from "@codemirror/view";
import { renderTex, logo, mathNode, type RenderContext } from "./render";
import { renderMath } from "./math";
import { optEnd, readArgs, skipSpace } from "./tex";
import { splitRows } from "./scan";

/** Marks an element as a control: the editor leaves its events alone. */
const ACTION = "data-v-action";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

abstract class Base extends WidgetType {
  ignoreEvent(event: Event): boolean {
    return event.target instanceof Element && !!event.target.closest(`[${ACTION}]`);
  }
}

/** One character (or a few) standing for an escape, a dash, a quote, or a space. */
export class GlyphWidget extends Base {
  constructor(
    readonly text: string,
    readonly cls = "",
  ) {
    super();
  }
  eq(o: GlyphWidget) {
    return o.text === this.text && o.cls === this.cls;
  }
  toDOM() {
    return el("span", `cm-v-w cm-v-glyph ${this.cls}`, this.text);
  }
}

/** A piece of LaTeX drawn through the small renderer: a macro's expansion, a description label, a logo. */
export class TexWidget extends Base {
  constructor(
    readonly src: string,
    readonly cls: string,
    readonly key: string,
    readonly ctx: RenderContext,
    readonly title = "",
  ) {
    super();
  }
  eq(o: TexWidget) {
    return o.src === this.src && o.cls === this.cls && o.key === this.key && o.title === this.title;
  }
  toDOM() {
    const e = el("span", `cm-v-w ${this.cls}`);
    e.appendChild(renderTex(this.src, this.ctx).node);
    if (this.title) e.title = this.title;
    return e;
  }
}

export class LogoWidget extends Base {
  constructor(readonly name: string) {
    super();
  }
  eq(o: LogoWidget) {
    return o.name === this.name;
  }
  toDOM() {
    const e = logo(this.name);
    e.classList.add("cm-v-w");
    return e;
  }
}

/** A citation, reference, or label, drawn as a compact chip. */
export class ChipWidget extends Base {
  constructor(
    readonly text: string,
    readonly cls: string,
    readonly title = "",
  ) {
    super();
  }
  eq(o: ChipWidget) {
    return o.text === this.text && o.cls === this.cls && o.title === this.title;
  }
  toDOM() {
    const e = el("span", `cm-v-w cm-v-chip ${this.cls}`, this.text);
    if (this.title) e.title = this.title;
    return e;
  }
}

/** A footnote's marker; its text shows on hover, and in full when the cursor enters it. */
export class FootnoteWidget extends Base {
  constructor(
    readonly mark: string,
    readonly text: string,
  ) {
    super();
  }
  eq(o: FootnoteWidget) {
    return o.mark === this.mark && o.text === this.text;
  }
  toDOM() {
    const e = el("sup", "cm-v-w cm-v-footnote-mark", this.mark);
    e.title = `Footnote: ${this.text}`;
    return e;
  }
}

/** Inline math, or display math in its own centered block with its equation numbers. */
export class MathWidget extends Base {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly key: string,
    readonly ctx: RenderContext,
    readonly title = "",
  ) {
    super();
  }
  eq(o: MathWidget) {
    return o.tex === this.tex && o.display === this.display && o.key === this.key && o.title === this.title;
  }
  get estimatedHeight() {
    return this.display ? 56 : -1;
  }
  toDOM() {
    if (!this.display) {
      const e = mathNode(this.tex, false, this.ctx);
      e.classList.add("cm-v-w");
      return e;
    }
    const wrap = el("span", "cm-v-w cm-v-display");
    const html = renderMath(this.tex, true, this.ctx.katex, this.ctx.katexKey);
    if (html === null) {
      wrap.classList.add("cm-v-display-error");
      wrap.appendChild(el("span", "cm-v-display-note", "This equation could not be drawn. Click to edit its source."));
      wrap.appendChild(el("span", "cm-v-display-source", this.tex));
    } else {
      const inner = el("span", "cm-v-display-math");
      inner.innerHTML = html;
      wrap.appendChild(inner);
    }
    if (this.title) wrap.title = this.title;
    return wrap;
  }
}

/** The typeset equation under its source while the source is being edited. */
export class MathPreviewWidget extends Base {
  constructor(
    readonly tex: string,
    readonly key: string,
    readonly ctx: RenderContext,
  ) {
    super();
  }
  eq(o: MathPreviewWidget) {
    return o.tex === this.tex && o.key === this.key;
  }
  get estimatedHeight() {
    return 56;
  }
  toDOM() {
    const wrap = el("div", "cm-v-w cm-v-preview");
    const html = renderMath(this.tex, true, this.ctx.katex, this.ctx.katexKey);
    if (html === null) wrap.appendChild(el("span", "cm-v-display-note", "Not drawable yet"));
    else wrap.innerHTML = html;
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

export class ImageWidget extends Base {
  constructor(
    readonly url: string | null,
    readonly path: string,
    readonly width: string,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.url === this.url && o.path === this.path && o.width === this.width;
  }
  get estimatedHeight() {
    return this.url ? 240 : 40;
  }
  toDOM() {
    const wrap = el("span", "cm-v-w cm-v-image");
    if (!this.url) {
      wrap.classList.add("cm-v-image-missing");
      wrap.appendChild(el("span", "", /\.(pdf|eps|ps|svg)$/i.test(this.path) ? `Image ${this.path} (shown in the PDF only)` : `Image ${this.path} is not in the project`));
      return wrap;
    }
    const img = el("img", "");
    img.src = this.url;
    img.alt = this.path;
    img.loading = "lazy";
    img.draggable = false;
    if (this.width) img.style.width = this.width;
    img.onerror = () => {
      wrap.replaceChildren(el("span", "", `Image ${this.path} could not be loaded`));
      wrap.classList.add("cm-v-image-missing");
    };
    wrap.appendChild(img);
    return wrap;
  }
}

/** A quiet one-line row for something that is not text: a table of contents, an included file, the bibliography, a page break. */
export class MarkerWidget extends Base {
  constructor(
    readonly label: string,
    readonly detail: string,
    readonly cls: string,
    readonly action: { label: string; run: () => void } | null = null,
  ) {
    super();
  }
  eq(o: MarkerWidget) {
    return o.label === this.label && o.detail === this.detail && o.cls === this.cls && !!o.action === !!this.action && o.action?.label === this.action?.label;
  }
  toDOM() {
    // A row with an action is itself the button: pressing anywhere on it acts.
    const e = this.action ? el("button", `cm-v-w cm-v-marker ${this.cls}`) : el("span", `cm-v-w cm-v-marker ${this.cls}`);
    e.appendChild(el("span", "cm-v-marker-label", this.label));
    if (this.detail) e.appendChild(el("span", "cm-v-marker-detail", this.detail));
    if (this.action && e instanceof HTMLButtonElement) {
      e.type = "button";
      e.setAttribute(ACTION, "");
      e.appendChild(el("span", "cm-v-marker-hint", this.action.label));
      const run = this.action.run;
      e.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
      e.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        run();
      });
    }
    return e;
  }
}

/** The heading's number, before its title. */
export class NumberWidget extends Base {
  constructor(readonly text: string) {
    super();
  }
  eq(o: NumberWidget) {
    return o.text === this.text;
  }
  toDOM() {
    return el("span", "cm-v-w cm-v-number", this.text);
  }
}

/** A list item's bullet, number, or description term. */
export class BulletWidget extends Base {
  constructor(
    readonly text: string,
    readonly term: string | null,
    readonly key: string,
    readonly ctx: RenderContext | null,
  ) {
    super();
  }
  eq(o: BulletWidget) {
    return o.text === this.text && o.term === this.term && o.key === this.key;
  }
  toDOM() {
    if (this.term !== null && this.ctx) {
      const e = el("span", "cm-v-w cm-v-term");
      e.appendChild(renderTex(this.term, this.ctx).node);
      return e;
    }
    return el("span", "cm-v-w cm-v-bullet", this.text);
  }
}

/** The label that opens an environment: "Theorem 2.1 (Name).", "Proof.", "Abstract", a frame's title. */
export class EnvLabelWidget extends Base {
  constructor(
    readonly kind: string,
    readonly title: string,
    readonly note: string,
    readonly key: string,
    readonly ctx: RenderContext,
  ) {
    super();
  }
  eq(o: EnvLabelWidget) {
    return o.kind === this.kind && o.title === this.title && o.note === this.note && o.key === this.key;
  }
  toDOM() {
    const e = el("span", `cm-v-w cm-v-envlabel cm-v-envlabel-${this.kind}`);
    if (this.kind === "frame" || this.kind === "block") {
      if (this.note) e.appendChild(renderTex(this.note, this.ctx).node);
      else e.textContent = this.title;
      return e;
    }
    e.appendChild(el("span", "cm-v-envlabel-title", this.title));
    if (this.note) {
      const n = el("span", "cm-v-envlabel-note");
      if (this.kind === "generic" || this.kind === "code") n.textContent = this.note;
      else {
        n.appendChild(document.createTextNode(" ("));
        n.appendChild(renderTex(this.note, this.ctx).node);
        n.appendChild(document.createTextNode(")"));
      }
      e.appendChild(n);
    }
    if (this.kind === "theorem" || this.kind === "proof") e.appendChild(document.createTextNode("."));
    return e;
  }
}

/** The end-of-proof mark. */
export class QedWidget extends Base {
  eq() {
    return true;
  }
  toDOM() {
    const e = el("span", "cm-v-w cm-v-qed", "∎");
    e.setAttribute("aria-label", "End of proof");
    return e;
  }
}

/** A forced line break (\\), drawn as a quiet return mark. */
export class BreakWidget extends Base {
  eq() {
    return true;
  }
  toDOM() {
    const e = el("span", "cm-v-w cm-v-break", "↵");
    e.title = "Line break";
    return e;
  }
}

/** A caption's lead-in: "Figure 2:". */
export class CaptionLeadWidget extends Base {
  constructor(readonly text: string) {
    super();
  }
  eq(o: CaptionLeadWidget) {
    return o.text === this.text;
  }
  toDOM() {
    return el("span", "cm-v-w cm-v-caption-lead", this.text);
  }
}

/** \maketitle: the title, authors, and date as a title block. */
export class TitleWidget extends Base {
  constructor(
    readonly fields: Record<string, string>,
    readonly key: string,
    readonly ctx: RenderContext,
  ) {
    super();
  }
  eq(o: TitleWidget) {
    return o.key === this.key && JSON.stringify(o.fields) === JSON.stringify(this.fields);
  }
  get estimatedHeight() {
    return 160;
  }
  toDOM() {
    const e = el("span", "cm-v-w cm-v-title");
    const { title, subtitle, author, institute, date } = this.fields;
    if (title === undefined) {
      e.appendChild(el("span", "cm-v-title-empty", "Title block (no \\title set)"));
      return e;
    }
    const part = (cls: string, src: string | undefined) => {
      if (src === undefined || !src.trim()) return;
      const p = el("span", cls);
      p.appendChild(renderTex(src, this.ctx).node);
      e.appendChild(p);
    };
    part("cm-v-title-main", title);
    part("cm-v-title-sub", subtitle);
    if (author !== undefined && author.trim()) {
      const a = el("span", "cm-v-title-authors");
      a.appendChild(renderTex(author, this.ctx).node);
      e.appendChild(a);
    }
    part("cm-v-title-sub", institute);
    // \date{} prints nothing; no \date at all prints today's date.
    part("cm-v-title-date", date === undefined ? "\\today" : date);
    return e;
  }
}

/** The preamble, folded into one row, or the row that folds it again. */
export class PreambleWidget extends Base {
  constructor(
    readonly lines: number,
    readonly open: boolean,
    readonly toggle: (view: EditorView) => void,
  ) {
    super();
  }
  eq(o: PreambleWidget) {
    // The toggle belongs to one instance of the extension; a reconfigured editor has a new one.
    return o.lines === this.lines && o.open === this.open && o.toggle === this.toggle;
  }
  toDOM(view: EditorView) {
    const e = el("span", `cm-v-w cm-v-preamble${this.open ? " cm-v-preamble-open" : ""}`);
    const b = el("button", "cm-v-preamble-button");
    b.type = "button";
    b.setAttribute(ACTION, "");
    b.setAttribute("aria-expanded", String(this.open));
    b.appendChild(el("span", "cm-v-chevron"));
    b.appendChild(el("span", "cm-v-preamble-label", "Preamble"));
    b.appendChild(el("span", "cm-v-preamble-count", `${this.lines} ${this.lines === 1 ? "line" : "lines"}`));
    b.appendChild(el("span", "cm-v-preamble-hint", this.open ? "Hide" : "Show"));
    b.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.toggle(view);
    });
    e.appendChild(b);
    return e;
  }
}

/** A block of source that is not prose (a TikZ picture), folded to one row until the cursor enters it. */
export class FoldedWidget extends Base {
  constructor(
    readonly label: string,
    readonly lines: number,
  ) {
    super();
  }
  eq(o: FoldedWidget) {
    return o.label === this.label && o.lines === this.lines;
  }
  toDOM() {
    const e = el("span", "cm-v-w cm-v-folded");
    e.appendChild(el("span", "cm-v-marker-label", this.label));
    e.appendChild(el("span", "cm-v-marker-detail", `${this.lines} ${this.lines === 1 ? "line" : "lines"} of source`));
    e.title = "Click to edit the source";
    return e;
  }
}

// ─── Tables ───

type Rule = "thick" | "thin" | "partial" | null;
interface Cell {
  src: string;
  span: number;
  align: string;
}
interface Row {
  cells: Cell[];
  above: Rule;
  partial: [number, number][];
}

/** Reads a column spec such as {l|c|p{3cm}*{2}{r}} into alignments. */
function columns(spec: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < spec.length) {
    const c = spec[i];
    if (c === "*") {
      const r = readArgs(spec, i + 1, "mm");
      if (r && r.args[0] && r.args[1]) {
        const n = Math.min(50, Number.parseInt(spec.slice(r.args[0].from, r.args[0].to), 10) || 0);
        const inner = columns(spec.slice(r.args[1].from, r.args[1].to));
        for (let k = 0; k < n; k++) out.push(...inner);
        i = r.end;
        continue;
      }
    }
    if (c === "l" || c === "c" || c === "r") out.push(c);
    else if (c === "p" || c === "m" || c === "b" || c === "X" || c === "L" || c === "C" || c === "R" || c === "S") out.push(c === "C" ? "c" : c === "R" || c === "S" ? "r" : "l");
    if ("pmb>@<!w".includes(c) && c !== "X") {
      // Skip the argument these take.
      const k = skipSpace(spec, i + 1);
      const r = readArgs(spec, k, "m");
      if (r) {
        i = r.end;
        continue;
      }
    }
    i++;
  }
  return out;
}

function splitCells(row: string): string[] {
  const cells: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "&" && depth === 0) {
      cells.push(row.slice(start, i));
      start = i + 1;
    }
  }
  cells.push(row.slice(start));
  return cells;
}

/** Parses a tabular body into rows of cells with the rules between them. */
function parseTable(spec: string, body: string): { rows: Row[]; trailing: Rule; cols: string[] } {
  const cols = columns(spec);
  const rows: Row[] = [];
  let pending: Rule = null;
  let partial: [number, number][] = [];
  for (let raw of splitRows(body)) {
    // Rules at the start of a row belong above it.
    for (;;) {
      raw = raw.replace(/^\s+/, "");
      const m = /^\\(hline|toprule|midrule|bottomrule|cline|cmidrule|specialrule|addlinespace|morecmidrules|hhline|noalign|rowcolor)\b\*?/.exec(raw);
      if (!m) break;
      let j = m[0].length;
      j = skipSpace(raw, j);
      if (raw[j] === "(") {
        const close = raw.indexOf(")", j);
        if (close !== -1) j = close + 1;
      }
      j = optEnd(raw, skipSpace(raw, j));
      if (j === -1) break;
      const r = /^(cline|cmidrule|specialrule|hhline|noalign|rowcolor)$/.test(m[1]) ? readArgs(raw, j, m[1] === "specialrule" ? "mmm" : "m") : null;
      if (r && r.args[0] && (m[1] === "cline" || m[1] === "cmidrule")) {
        const span = /(\d+)\s*-\s*(\d+)/.exec(raw.slice(r.args[0].from, r.args[0].to));
        if (span) partial.push([Number(span[1]), Number(span[2])]);
      } else if (m[1] === "toprule" || m[1] === "bottomrule" || m[1] === "specialrule") pending = "thick";
      else if (m[1] === "hline" || m[1] === "midrule") pending = pending === "thick" ? "thick" : "thin";
      raw = raw.slice(r ? r.end : j);
    }
    if (!raw.trim()) continue;
    const cells: Cell[] = splitCells(raw).map((src, k) => {
      const mc = /^\s*\\multicolumn\s*/.exec(src);
      if (mc) {
        const r = readArgs(src, mc[0].length, "mmm");
        if (r && r.args[0] && r.args[1] && r.args[2]) {
          const span = Math.max(1, Number.parseInt(src.slice(r.args[0].from, r.args[0].to), 10) || 1);
          return { src: src.slice(r.args[2].from, r.args[2].to), span, align: columns(src.slice(r.args[1].from, r.args[1].to))[0] ?? "c" };
        }
      }
      const mr = /^\s*\\multirow\s*/.exec(src);
      if (mr) {
        const r = readArgs(src, mr[0].length, "omom");
        if (r && r.args[3]) return { src: src.slice(r.args[3].from, r.args[3].to), span: 1, align: cols[k] ?? "l" };
      }
      return { src, span: 1, align: cols[k] ?? "l" };
    });
    // Each cell's alignment follows its starting column.
    let col = 0;
    for (const cell of cells) {
      if (cell.span === 1) cell.align = cols[col] ?? "l";
      col += cell.span;
    }
    rows.push({ cells, above: pending ?? (partial.length ? "partial" : null), partial });
    pending = null;
    partial = [];
  }
  return { rows, trailing: pending, cols };
}

export class TableWidget extends Base {
  constructor(
    readonly spec: string,
    readonly body: string,
    readonly key: string,
    readonly ctx: RenderContext,
  ) {
    super();
  }
  eq(o: TableWidget) {
    return o.spec === this.spec && o.body === this.body && o.key === this.key;
  }
  get estimatedHeight() {
    return 32 * Math.max(1, (this.body.match(/\\\\/g) ?? []).length) + 16;
  }
  toDOM() {
    const wrap = el("span", "cm-v-w cm-v-table");
    const { rows, trailing } = parseTable(this.spec, this.body);
    const table = el("table", "");
    rows.forEach((row, r) => {
      const tr = el("tr", "");
      if (row.above === "thick") tr.classList.add("cm-v-rule-thick");
      else if (row.above === "thin") tr.classList.add("cm-v-rule-thin");
      if (r === rows.length - 1 && trailing) tr.classList.add(trailing === "thick" ? "cm-v-rule-bottom-thick" : "cm-v-rule-bottom-thin");
      let col = 1;
      for (const cell of row.cells) {
        const td = el("td", `cm-v-align-${cell.align}`);
        if (cell.span > 1) td.colSpan = cell.span;
        if (row.partial.some(([a, b]) => col >= a && col <= b)) td.classList.add("cm-v-rule-partial");
        td.appendChild(renderTex(cell.src.trim(), this.ctx).node);
        tr.appendChild(td);
        col += cell.span;
      }
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    return wrap;
  }
}

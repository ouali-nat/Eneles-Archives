/**
 * Turns a short piece of LaTeX (a title, a caption, a table cell, a macro's expansion) into DOM for a widget. It knows the same text commands the editor draws in place; anything else is kept as quiet source and reported, so a caller can decide the piece is not plain text after all.
 */
import { ACCENTS, DECLARATIONS, ESCAPES, QUIET, SYMBOLS, TEXT_STYLES, accent, groupEnd, isLetter, optEnd, readArgs, readName, skipSpace } from "./tex";
import { renderMath } from "./math";
import type { Macro, Target } from "./project";

export interface RenderContext {
  macros: Map<string, Macro>;
  katex: Record<string, string>;
  katexKey: string;
  labels: Map<string, Target>;
}

export interface Rendered {
  node: DocumentFragment;
  /** False when something in it was not understood and is shown as source. */
  ok: boolean;
}

export function renderTex(src: string, ctx: RenderContext, depth = 0): Rendered {
  const frag = document.createDocumentFragment();
  const state = { ok: true };
  emit(src, 0, src.length, frag, ctx, state, depth);
  return { node: frag, ok: state.ok };
}

/** Plain text of a piece of LaTeX, for tooltips. */
export function plainTex(src: string, ctx: RenderContext): string {
  return renderTex(src, ctx).node.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

export const today = () => new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

function span(cls: string, text?: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function logo(name: string): HTMLSpanElement {
  const el = span("cm-v-logo");
  const parts: [string, string][] =
    name === "LaTeX" || name === "LaTeXe"
      ? [["L", ""], ["A", "cm-v-logo-a"], ["T", ""], ["E", "cm-v-logo-e"], ["X", ""]]
      : name === "BibTeX"
        ? [["Bib", ""], ["T", ""], ["E", "cm-v-logo-e"], ["X", ""]]
        : [["T", ""], ["E", "cm-v-logo-e"], ["X", ""]];
  for (const [t, c] of parts) el.appendChild(c ? span(c, t) : document.createTextNode(t));
  if (name === "LaTeXe") el.appendChild(document.createTextNode(" 2ε"));
  el.setAttribute("aria-label", name);
  return el;
}

function emit(src: string, from: number, to: number, out: Node, ctx: RenderContext, state: { ok: boolean }, depth: number) {
  let text = "";
  let target: Node = out;
  const flush = () => {
    if (text) target.appendChild(document.createTextNode(text));
    text = "";
  };
  const push = (node: Node) => {
    flush();
    target.appendChild(node);
  };
  let i = from;
  while (i < to) {
    const c = src[i];
    if (c === "%") {
      const eol = src.indexOf("\n", i);
      i = eol === -1 || eol > to ? to : eol + 1;
      continue;
    }
    if (c === "~") {
      text += " ";
      i++;
      continue;
    }
    if (c === "\n" || c === "\t" || c === "\r") {
      if (!text.endsWith(" ")) text += " ";
      i++;
      continue;
    }
    if (c === "-" && src[i + 1] === "-") {
      const em = src[i + 2] === "-";
      text += em ? "—" : "–";
      i += em ? 3 : 2;
      continue;
    }
    if (c === "`") {
      const dbl = src[i + 1] === "`";
      text += dbl ? "“" : "‘";
      i += dbl ? 2 : 1;
      continue;
    }
    if (c === "'" && src[i + 1] === "'") {
      text += "”";
      i += 2;
      continue;
    }
    if (c === "$") {
      const display = src[i + 1] === "$";
      const open = display ? 2 : 1;
      const close = src.indexOf(display ? "$$" : "$", i + open);
      if (close === -1 || close > to) {
        text += "$";
        i++;
        state.ok = false;
        continue;
      }
      push(mathNode(src.slice(i + open, close), false, ctx));
      i = close + open;
      continue;
    }
    if (c === "{") {
      const g = groupEnd(src, i, to);
      if (g === -1) {
        i++;
        continue;
      }
      // {\bf …} and friends.
      const k = skipSpace(src, i + 1);
      if (src[k] === "\\" && isLetter(src[k + 1])) {
        const { name, end } = readName(src, k);
        const cls = DECLARATIONS[name];
        if (cls) {
          const el = span(cls);
          emit(src, end, g - 1, el, ctx, state, depth);
          push(el);
          i = g;
          continue;
        }
      }
      const el = span("");
      emit(src, i + 1, g - 1, el, ctx, state, depth);
      push(el);
      i = g;
      continue;
    }
    if (c === "}") {
      i++;
      continue;
    }
    if (c === "&") {
      text += " ";
      i++;
      continue;
    }
    if (c !== "\\") {
      text += c;
      i++;
      continue;
    }
    // A command.
    const next = src[i + 1];
    if (next === undefined) {
      i++;
      continue;
    }
    if (next === "\\") {
      push(document.createElement("br"));
      i += 2;
      const o = optEnd(src, skipSpace(src, i), to);
      if (o > i) i = o;
      continue;
    }
    if (next === "(") {
      const close = src.indexOf("\\)", i + 2);
      if (close !== -1 && close < to) {
        push(mathNode(src.slice(i + 2, close), false, ctx));
        i = close + 2;
        continue;
      }
    }
    if (!isLetter(next)) {
      if (next in ACCENTS) {
        const r = accentArg(src, i + 2, to);
        if (r) {
          text += accent(ACCENTS[next], r.letter);
          i = r.end;
          continue;
        }
      }
      if (next in ESCAPES) {
        text += ESCAPES[next];
        i += 2;
        continue;
      }
      text += next;
      i += 2;
      continue;
    }
    const { name, end } = readName(src, i);
    // Control words swallow the spaces after them.
    const after = skipSpace(src, end);
    if (name in SYMBOLS) {
      text += SYMBOLS[name];
      i = src[end] === "{" && src[end + 1] === "}" ? end + 2 : after;
      continue;
    }
    if (name in ACCENTS && name.length === 1) {
      const r = accentArg(src, end, to);
      if (r) {
        text += accent(ACCENTS[name], r.letter);
        i = r.end;
        continue;
      }
    }
    if (name === "LaTeX" || name === "TeX" || name === "LaTeXe" || name === "BibTeX") {
      push(logo(name));
      i = src[end] === "{" && src[end + 1] === "}" ? end + 2 : end;
      continue;
    }
    if (name === "today") {
      text += today();
      i = after;
      continue;
    }
    if (name === "and" || name === "And" || name === "AND") {
      push(span("cm-v-and"));
      i = after;
      continue;
    }
    if (name in TEXT_STYLES) {
      const r = readArgs(src, end, "m", to);
      if (r?.args[0]) {
        const el = span(TEXT_STYLES[name]);
        if (name === "enquote") el.appendChild(document.createTextNode("“"));
        emit(src, r.args[0].from, r.args[0].to, el, ctx, state, depth);
        if (name === "enquote") el.appendChild(document.createTextNode("”"));
        push(el);
        i = r.end;
        continue;
      }
    }
    if (name in DECLARATIONS) {
      // A declaration in the middle of a group styles the rest of it.
      const el = span(DECLARATIONS[name]);
      flush();
      target.appendChild(el);
      target = el;
      i = after;
      continue;
    }
    if (name === "textcolor" || name === "colorbox") {
      const r = readArgs(src, end, "omm", to);
      if (r?.args[2]) {
        const el = span("");
        emit(src, r.args[2].from, r.args[2].to, el, ctx, state, depth);
        push(el);
        i = r.end;
        continue;
      }
    }
    if (name === "href") {
      const r = readArgs(src, end, "mm", to);
      if (r?.args[1]) {
        const el = span("cm-v-link");
        emit(src, r.args[1].from, r.args[1].to, el, ctx, state, depth);
        push(el);
        i = r.end;
        continue;
      }
    }
    if (name === "url" || name === "nolinkurl") {
      const r = readArgs(src, end, "m", to);
      if (r?.args[0]) {
        push(span("cm-v-link", src.slice(r.args[0].from, r.args[0].to)));
        i = r.end;
        continue;
      }
    }
    if (/^(cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|Cite|Citep|Citet|footcite|nocite)$/.test(name)) {
      const r = readArgs(src, end, "oom", to);
      if (r?.args[2]) {
        push(span("cm-v-chip cm-v-cite", `[${src.slice(r.args[2].from, r.args[2].to).split(",").map((k) => k.trim()).join(", ")}]`));
        i = r.end;
        continue;
      }
    }
    if (/^(ref|eqref|autoref|cref|Cref|pageref|nameref|vref)$/.test(name)) {
      const r = readArgs(src, end, "m", to);
      if (r?.args[0]) {
        const key = src.slice(r.args[0].from, r.args[0].to).trim();
        const target = ctx.labels.get(key);
        const shown = target ? (name === "eqref" ? `(${target.num})` : /^(autoref|cref|Cref)$/.test(name) ? `${target.kind} ${target.num}` : target.num) : key;
        push(span("cm-v-chip cm-v-ref", shown));
        i = r.end;
        continue;
      }
    }
    if (name === "label" || name === "thanks" || name === "footnote" || name === "index") {
      const r = readArgs(src, end, "om", to);
      i = r ? r.end : after;
      continue;
    }
    if (name in QUIET) {
      const r = readArgs(src, end, QUIET[name] || "", to);
      i = r ? r.end : after;
      continue;
    }
    if (name === "text" || name === "textup") {
      const r = readArgs(src, end, "m", to);
      if (r?.args[0]) {
        emit(src, r.args[0].from, r.args[0].to, target, ctx, state, depth);
        i = r.end;
        continue;
      }
    }
    const macro = ctx.macros.get(name);
    if (macro && depth < 6) {
      const shape = "m".repeat(macro.nargs);
      const r = macro.nargs ? readArgs(src, end, shape, to) : { end: src[end] === "{" && src[end + 1] === "}" ? end + 2 : after, args: [] };
      if (r) {
        let body = macro.body;
        r.args.forEach((a, k) => {
          body = body.split(`#${k + 1}`).join(a ? src.slice(a.from, a.to) : "");
        });
        const inner = renderTex(body, ctx, depth + 1);
        if (!inner.ok) state.ok = false;
        push(inner.node);
        i = r.end;
        continue;
      }
    }
    // Not understood: the command stays as quiet source.
    state.ok = false;
    push(span("cm-v-unknown", `\\${name}`));
    i = end;
  }
  flush();
}

function accentArg(src: string, i: number, to: number): { letter: string; end: number } | null {
  if (src[i] === "{") {
    const g = groupEnd(src, i, to);
    if (g === -1) return null;
    const inner = src.slice(i + 1, g - 1).trim();
    return inner.length <= 2 ? { letter: inner, end: g } : null;
  }
  const j = skipSpace(src, i);
  if (src[j] === "\\" && (src[j + 1] === "i" || src[j + 1] === "j") && !isLetter(src[j + 2])) return { letter: src.slice(j, j + 2), end: j + 2 };
  if (isLetter(src[j])) return { letter: src[j], end: j + 1 };
  return null;
}

export function mathNode(tex: string, display: boolean, ctx: RenderContext): HTMLElement {
  const el = span(display ? "cm-v-math cm-v-math-display" : "cm-v-math");
  const html = renderMath(tex.trim(), display, ctx.katex, ctx.katexKey);
  if (html === null) {
    el.className = "cm-v-math-error";
    el.textContent = tex;
  } else el.innerHTML = html;
  return el;
}

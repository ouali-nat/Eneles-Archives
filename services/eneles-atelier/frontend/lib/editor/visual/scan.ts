/**
 * The skeleton of a whole document, read in one forgiving pass: environments and where they close, display math, headings, list items, captions, includes, footnotes, the title fields, and the events that move LaTeX's counters. It is rebuilt on every change, so it only notes positions; the drawing is done for the visible part alone (see build.ts).
 */
import { FLOATS, LIST_ENVS, MATH_ENVS, RAW_ENVS, SECTION_LEVELS, groupEnd, isLetter, optEnd, readArgs, readName, skipSpace } from "./tex";

export interface Arg {
  from: number;
  to: number;
  kind: "[" | "{" | "<";
}

export interface Env {
  name: string;
  /** The backslash of \begin. */
  from: number;
  /** Just past \begin{name} and the arguments that follow it directly. */
  headEnd: number;
  args: Arg[];
  /** The backslash of \end, or -1 when the environment never closes. */
  endFrom: number;
  /** Just past \end{name}, or -1. */
  to: number;
  parent: Env | null;
  /** Math and verbatim-like environments: their body is not prose. */
  raw: boolean;
}

export interface DisplayMath {
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
  /** The environment's name, or null for \[ \] and $$ $$. */
  env: string | null;
  parent: Env | null;
}

export interface Heading {
  from: number;
  /** Just past the command name and its star. */
  nameEnd: number;
  name: string;
  level: number;
  star: boolean;
  /** The title argument's inside, or null when it is missing or unbalanced. */
  title: { from: number; to: number } | null;
  /** Just past the title's closing brace. */
  end: number;
}

export interface Item {
  from: number;
  /** Just past \item and its [label]. */
  end: number;
  label: { from: number; to: number } | null;
  list: Env;
  /** 1-based position within its list. */
  index: number;
  /** How many lists hold it: 1 for a top-level list. */
  depth: number;
}

export interface Include {
  from: number;
  to: number;
  path: string;
  cmd: string;
}

/** Things that move a counter or name a target, in document order. */
export type CountEvent =
  | { kind: "head"; pos: number; level: number; star: boolean }
  | { kind: "include"; pos: number; path: string }
  | { kind: "appendix"; pos: number }
  | { kind: "caption"; pos: number; float: string }
  | { kind: "theorem"; pos: number; env: string; star: boolean }
  | { kind: "math"; pos: number; env: string; body: string }
  | { kind: "label"; pos: number; key: string }
  | { kind: "footnote"; pos: number };

export interface Scan {
  text: string;
  envs: Env[];
  envAt: Map<number, Env>;
  endAt: Map<number, Env>;
  maths: DisplayMath[];
  mathAt: Map<number, DisplayMath>;
  heads: Map<number, Heading>;
  items: Map<number, Item>;
  includes: Map<number, Include>;
  events: CountEvent[];
  /** \begin{document}, when the file has one. */
  document: Env | null;
  /** The last \title, \author, \date (and beamer's \subtitle, \institute) arguments. */
  fields: Record<string, { from: number; to: number }>;
  docclass: string | null;
}

export function scan(text: string): Scan {
  const out: Scan = {
    text,
    envs: [],
    envAt: new Map(),
    endAt: new Map(),
    maths: [],
    mathAt: new Map(),
    heads: new Map(),
    items: new Map(),
    includes: new Map(),
    events: [],
    document: null,
    fields: {},
    docclass: null,
  };
  const stack: Env[] = [];
  const itemCount = new Map<Env, number>();
  const re = /[\\%$]/g;
  const n = text.length;

  const addMath = (m: DisplayMath) => {
    out.maths.push(m);
    out.mathAt.set(m.from, m);
  };
  /** Index of `needle` after `from`, as long as no blank line comes first (math cannot hold a paragraph break). */
  const closeWithin = (needle: string, from: number) => {
    const at = text.indexOf(needle, from);
    if (at === -1) return -1;
    const blank = /\n[ \t]*\n/g;
    blank.lastIndex = from;
    const b = blank.exec(text);
    return b && b.index < at ? -1 : at;
  };

  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const i = m.index;
    const ch = text[i];
    if (ch === "%") {
      const eol = text.indexOf("\n", i);
      if (eol === -1) break;
      re.lastIndex = eol;
      continue;
    }
    if (ch === "$") {
      if (text[i + 1] !== "$") continue;
      const close = closeWithin("$$", i + 2);
      if (close === -1) {
        re.lastIndex = i + 2;
        continue;
      }
      addMath({ from: i, to: close + 2, bodyFrom: i + 2, bodyTo: close, env: null, parent: stack[stack.length - 1] ?? null });
      re.lastIndex = close + 2;
      continue;
    }
    // A backslash.
    const next = text[i + 1];
    if (next === "[") {
      const close = closeWithin("\\]", i + 2);
      if (close !== -1) {
        addMath({ from: i, to: close + 2, bodyFrom: i + 2, bodyTo: close, env: null, parent: stack[stack.length - 1] ?? null });
        re.lastIndex = close + 2;
      } else re.lastIndex = i + 2;
      continue;
    }
    if (!isLetter(next)) {
      re.lastIndex = i + 2;
      continue;
    }
    const { name, end } = readName(text, i);
    re.lastIndex = end;

    if (name === "begin" || name === "end") {
      const k = skipSpace(text, end);
      if (text[k] !== "{") continue;
      const close = text.indexOf("}", k);
      if (close === -1 || close - k > 60 || text.slice(k, close).includes("\n")) continue;
      const envName = text.slice(k + 1, close).trim();
      if (name === "begin") {
        const { headEnd, args } = envArgs(text, close + 1);
        const env: Env = { name: envName, from: i, headEnd, args, endFrom: -1, to: -1, parent: stack[stack.length - 1] ?? null, raw: false };
        const isMath = MATH_ENVS.test(envName);
        if (isMath || RAW_ENVS.test(envName)) {
          const endTag = `\\end{${envName}}`;
          const at = isMath ? closeWithin(endTag, headEnd) : text.indexOf(endTag, headEnd);
          if (at === -1) {
            // Never closed: leave it as source and keep reading.
            re.lastIndex = close + 1;
            continue;
          }
          env.raw = true;
          env.endFrom = at;
          env.to = at + endTag.length;
          out.envs.push(env);
          out.envAt.set(env.from, env);
          out.endAt.set(env.endFrom, env);
          if (isMath) {
            const mathEnv = envName === "math" ? null : envName;
            if (envName !== "math") addMath({ from: i, to: env.to, bodyFrom: close + 1, bodyTo: at, env: mathEnv, parent: env.parent });
            out.events.push({ kind: "math", pos: i, env: envName, body: text.slice(close + 1, at) });
          }
          re.lastIndex = env.to;
          continue;
        }
        stack.push(env);
        out.envs.push(env);
        out.envAt.set(env.from, env);
        if (envName === "document") out.document = env;
        out.events.push({ kind: "theorem", pos: i, env: envName.replace(/\*$/, ""), star: envName.endsWith("*") });
        re.lastIndex = headEnd;
      } else {
        // Close the innermost environment of this name; anything opened inside it and left open stays unclosed.
        let at = -1;
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s].name === envName) {
            at = s;
            break;
          }
        }
        if (at === -1) continue;
        const env = stack[at];
        stack.length = at;
        env.endFrom = i;
        env.to = close + 1;
        out.endAt.set(i, env);
        re.lastIndex = close + 1;
      }
      continue;
    }

    if (name in SECTION_LEVELS) {
      let j = end;
      const star = text[j] === "*";
      if (star) j++;
      const nameEnd = j;
      j = skipSpace(text, j);
      const o = optEnd(text, j);
      if (o !== -1) j = skipSpace(text, o);
      const g = text[j] === "{" ? groupEnd(text, j) : -1;
      const level = SECTION_LEVELS[name];
      out.heads.set(i, { from: i, nameEnd, name, level, star, title: g === -1 ? null : { from: j + 1, to: g - 1 }, end: g === -1 ? nameEnd : g });
      out.events.push({ kind: "head", pos: i, level, star });
      if (g !== -1) re.lastIndex = j + 1;
      continue;
    }

    switch (name) {
      case "item": {
        let list: Env | null = null;
        for (let s = stack.length - 1; s >= 0; s--) {
          if (LIST_ENVS.test(stack[s].name)) {
            list = stack[s];
            break;
          }
        }
        if (!list) break;
        let depth = 0;
        for (const e of stack) if (LIST_ENVS.test(e.name)) depth++;
        const k = skipSpace(text, end);
        const o = text[k] === "[" ? optEnd(text, k) : -1;
        const index = (itemCount.get(list) ?? 0) + 1;
        itemCount.set(list, index);
        out.items.set(i, { from: i, end: o > 0 ? o : end, label: o > 0 ? { from: k + 1, to: o - 1 } : null, list, index, depth });
        break;
      }
      case "caption":
      case "captionof": {
        let float = "";
        if (name === "captionof") {
          const k = skipSpace(text, end);
          const g = groupEnd(text, k);
          if (g !== -1) float = text.slice(k + 1, g - 1).trim();
        } else {
          for (let s = stack.length - 1; s >= 0; s--) {
            if (stack[s].name in FLOATS) {
              float = stack[s].name;
              break;
            }
          }
        }
        out.events.push({ kind: "caption", pos: i, float: float.replace(/\*$/, "") });
        break;
      }
      case "label": {
        const k = skipSpace(text, end);
        const g = groupEnd(text, k);
        if (g !== -1) out.events.push({ kind: "label", pos: i, key: text.slice(k + 1, g - 1).trim() });
        break;
      }
      case "footnote":
        out.events.push({ kind: "footnote", pos: i });
        break;
      case "appendix":
        out.events.push({ kind: "appendix", pos: i });
        break;
      case "input":
      case "include":
      case "subfile":
      case "import":
      case "subimport":
      case "inputfrom":
      case "subinputfrom":
      case "includefrom":
      case "subincludefrom": {
        const two = /^(import|subimport|inputfrom|subinputfrom|includefrom|subincludefrom)$/.test(name);
        const r = readArgs(text, end, two ? "mm" : "m");
        if (!r) break;
        const parts = r.args.map((a) => (a ? text.slice(a.from, a.to).trim() : ""));
        const path = two ? `${parts[0].replace(/\/?$/, "/")}${parts[1]}` : parts[0];
        if (!path || path.includes("\\")) break;
        out.includes.set(i, { from: i, to: r.end, path, cmd: name });
        out.events.push({ kind: "include", pos: i, path });
        re.lastIndex = r.end;
        break;
      }
      case "title":
      case "author":
      case "date":
      case "subtitle":
      case "institute": {
        const r = readArgs(text, end, "om");
        const a = r?.args[1];
        if (a) out.fields[name] = { from: a.from, to: a.to };
        break;
      }
      case "documentclass": {
        const r = readArgs(text, end, "om");
        const a = r?.args[1];
        if (a) out.docclass = text.slice(a.from, a.to).trim();
        break;
      }
      case "verb": {
        // \verb|…|: anything goes between the delimiters.
        const d = text[end] === "*" ? end + 1 : end;
        const delim = text[d];
        if (!delim || /[a-zA-Z\s]/.test(delim)) break;
        const close = text.indexOf(delim, d + 1);
        const eol = text.indexOf("\n", d + 1);
        if (close !== -1 && (eol === -1 || close < eol)) re.lastIndex = close + 1;
        break;
      }
    }
    if (n === 0) break;
  }
  return out;
}

/** Arguments that follow \begin{name} directly: [options], {arguments}, and beamer's <overlays>, at most four. */
function envArgs(text: string, i: number): { headEnd: number; args: Arg[] } {
  const args: Arg[] = [];
  let j = i;
  for (let count = 0; count < 4; count++) {
    const c = text[j];
    if (c === "[") {
      const e = optEnd(text, j);
      if (e <= j) break;
      args.push({ from: j + 1, to: e - 1, kind: "[" });
      j = e;
    } else if (c === "{") {
      const e = groupEnd(text, j);
      if (e === -1) break;
      args.push({ from: j + 1, to: e - 1, kind: "{" });
      j = e;
    } else if (c === "<") {
      const e = text.indexOf(">", j);
      if (e === -1 || e - j > 40 || text.slice(j, e).includes("\n")) break;
      args.push({ from: j + 1, to: e, kind: "<" });
      j = e + 1;
    } else break;
  }
  return { headEnd: j, args };
}

/** A short fingerprint of the events that move counters, so numbering elsewhere is only redone when it could have changed. */
export function eventSignature(events: CountEvent[]): string {
  let s = "";
  for (const e of events) {
    switch (e.kind) {
      case "head":
        s += `h${e.level}${e.star ? "*" : ""};`;
        break;
      case "include":
        s += `i${e.path};`;
        break;
      case "appendix":
        s += "a;";
        break;
      case "caption":
        s += `c${e.float};`;
        break;
      case "theorem":
        s += `t${e.env}${e.star ? "*" : ""};`;
        break;
      case "math":
        s += `m${e.env}:${mathRowSignature(e.body)};`;
        break;
      case "label":
        s += `l${e.key};`;
        break;
      case "footnote":
        s += "f;";
        break;
    }
  }
  return s;
}

/** Rows of a multi-line math body that get a number, and the \tag of each. */
export function mathRows(env: string, body: string): { numbered: boolean; tag: string | null; labels: string[] }[] {
  const starred = env.endsWith("*");
  const base = env.replace(/\*$/, "");
  const multi = /^(align|alignat|flalign|gather|eqnarray)$/.test(base);
  const rows = multi ? splitRows(body) : [body];
  return rows.map((row) => {
    const tag = /\\tag\*?\s*\{([^}]*)\}/.exec(row)?.[1] ?? null;
    const off = /\\(nonumber|notag)\b/.test(row);
    const labels = [...row.matchAll(/\\label\s*\{([^}]*)\}/g)].map((x) => x[1].trim());
    return { numbered: tag !== null || (!starred && !off && base !== "displaymath" && base !== "math"), tag, labels };
  });
}

function mathRowSignature(body: string): string {
  return String((body.match(/\\\\/g) ?? []).length) + (/\\(nonumber|notag|tag)\b/.test(body) ? "x" : "");
}

/** Splits a math body at its top-level \\ (not inside braces or nested environments). A trailing \\ with nothing after it does not start a row. */
export function splitRows(body: string): string[] {
  const rows: string[] = [];
  let depth = 0;
  let envDepth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") {
      if (body[i + 1] === "\\" && depth === 0 && envDepth === 0) {
        rows.push(body.slice(start, i));
        i++;
        // \\[4pt] spacing.
        const o = optEnd(body, skipSpace(body, i + 1));
        start = o > i + 1 ? o : i + 1;
        continue;
      }
      if (body.startsWith("begin", i + 1)) envDepth++;
      else if (body.startsWith("end", i + 1)) envDepth = Math.max(0, envDepth - 1);
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
  }
  const last = body.slice(start);
  if (last.trim() || rows.length === 0) rows.push(last);
  return rows;
}

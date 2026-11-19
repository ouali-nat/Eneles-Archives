/**
 * What a file needs to know about the rest of its project: the macros and theorem environments defined anywhere in it, and how LaTeX would number the headings, floats, theorems, and equations in this file, which depends on where the file is included from. Everything is cached by the files' text, so typing prose does not redo any of it.
 */
import { THEOREMS, alpha, groupEnd, readArgs, roman, skipSpace } from "./tex";
import { eventSignature, mathRows, scan, type CountEvent, type Scan } from "./scan";

export interface ProjectFile {
  path: string;
  text: string;
}

export interface Macro {
  nargs: number;
  body: string;
}

export interface TheoremDef {
  title: string;
  italic: boolean;
  /** The counter it shares, its own name when it has one of its own, or null when unnumbered. */
  counter: string | null;
  /** The sectional unit it is numbered within ("chapter", "section"), if any. */
  within: string | null;
}

export interface Definitions {
  macros: Map<string, Macro>;
  katex: Record<string, string>;
  theorems: Map<string, TheoremDef>;
}

/** Reads \newcommand, \DeclareMathOperator, \def, \newtheorem, and \theoremstyle definitions from a file. */
export function readDefinitions(text: string, into: Definitions = { macros: new Map(), katex: {}, theorems: new Map() }): Definitions {
  let style = "plain";
  const re = /\\(newcommand|renewcommand|providecommand|DeclareRobustCommand|DeclareMathOperator|def|newtheorem|theoremstyle)\b(\*?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // Skip definitions inside comments.
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    if (/(^|[^\\])%/.test(text.slice(lineStart, m.index))) continue;
    const cmd = m[1];
    const star = m[2] === "*";
    let i = m.index + m[0].length;
    if (cmd === "theoremstyle") {
      const r = readArgs(text, i, "m");
      if (r?.args[0]) style = text.slice(r.args[0].from, r.args[0].to).trim();
      continue;
    }
    if (cmd === "newtheorem") {
      // \newtheorem{name}[shared]{Title}[within] or \newtheorem*{name}{Title}
      const r = readArgs(text, i, "momo");
      if (!r || !r.args[0] || !r.args[2]) continue;
      const name = text.slice(r.args[0].from, r.args[0].to).trim();
      const shared = r.args[1] ? text.slice(r.args[1].from, r.args[1].to).trim() : null;
      const within = r.args[3] ? text.slice(r.args[3].from, r.args[3].to).trim() : null;
      const title = text.slice(r.args[2].from, r.args[2].to).trim();
      const sharedDef = shared ? into.theorems.get(shared) : undefined;
      into.theorems.set(name, {
        title,
        italic: style === "plain",
        counter: star ? null : (shared ?? name),
        within: star ? null : shared ? (sharedDef?.within ?? null) : within,
      });
      continue;
    }
    // The macro's name: {\name} or \name directly.
    i = skipSpace(text, i);
    let name = "";
    if (text[i] === "{") {
      const g = groupEnd(text, i);
      if (g === -1) continue;
      name = text.slice(i + 1, g - 1).trim();
      i = g;
    } else {
      const n = /^\\([a-zA-Z]+|.)/.exec(text.slice(i, i + 64));
      if (!n) continue;
      name = n[0];
      i += n[0].length;
    }
    if (!/^\\([a-zA-Z]+|.)$/.test(name)) continue;
    if (cmd === "DeclareMathOperator") {
      const r = readArgs(text, i, "m");
      if (!r?.args[0]) continue;
      const body = text.slice(r.args[0].from, r.args[0].to);
      into.katex[name] = `\\operatorname${star ? "*" : ""}{${body}}`;
      continue;
    }
    if (cmd === "def") {
      // \def\name#1#2{body}
      const params = /^(#\d)*/.exec(text.slice(i, i + 20))?.[0] ?? "";
      i += params.length;
      const g = groupEnd(text, skipSpace(text, i));
      if (g === -1) continue;
      const body = text.slice(skipSpace(text, i) + 1, g - 1);
      const nargs = params.length / 2;
      into.macros.set(name.slice(1), { nargs, body });
      into.katex[name] = body;
      continue;
    }
    // \newcommand{\name}[n][default]{body}
    const r = readArgs(text, i, "oom");
    if (!r?.args[2]) continue;
    const nargs = r.args[0] ? Number.parseInt(text.slice(r.args[0].from, r.args[0].to), 10) || 0 : 0;
    const body = text.slice(r.args[2].from, r.args[2].to);
    if (cmd === "providecommand" && into.macros.has(name.slice(1))) continue;
    into.macros.set(name.slice(1), { nargs, body });
    // KaTeX has no optional arguments; a macro with one is left to KaTeX's own definition, if any.
    if (!r.args[1]) into.katex[name] = body;
  }
  return into;
}

// ─── Counters ───

export type DocClass = "article" | "report" | "book" | "beamer";

export interface CounterState {
  cls: DocClass;
  part: number;
  chapter: number;
  section: number;
  subsection: number;
  subsubsection: number;
  paragraph: number;
  appendix: boolean;
  figure: Map<string, number>;
  theorem: Map<string, number>;
  equation: number;
  footnote: number;
}

export function freshCounters(cls: DocClass): CounterState {
  return { cls, part: 0, chapter: 0, section: 0, subsection: 0, subsubsection: 0, paragraph: 0, appendix: false, figure: new Map(), theorem: new Map(), equation: 0, footnote: 0 };
}

function cloneCounters(c: CounterState): CounterState {
  return { ...c, figure: new Map(c.figure), theorem: new Map(c.theorem) };
}

export function classOf(docclass: string | null, scanned?: Scan): DocClass {
  if (docclass) {
    if (/beamer/.test(docclass)) return "beamer";
    if (/book|memoir|thesis|scrbook/.test(docclass)) return "book";
    if (/report|scrreprt/.test(docclass)) return "report";
    return "article";
  }
  if (scanned && [...scanned.heads.values()].some((h) => h.level === 0)) return "report";
  return "article";
}

/** The numbers drawn in one file. */
export interface Numbering {
  heads: Map<number, string>;
  captions: Map<number, string>;
  theorems: Map<number, string>;
  /** For each display math, the number of each row ("" for an unnumbered row). */
  equations: Map<number, string[]>;
  footnotes: Map<number, number>;
}

/** A label and what it names. */
export interface Target {
  num: string;
  kind: string;
}

const LEVEL_NAMES = ["chapter", "section", "subsection", "subsubsection", "paragraph"] as const;

/** Moves counters through one file's events. `include` walks an included file in place; `found` stops the walk at the file being edited. */
function run(
  events: CountEvent[],
  c: CounterState,
  defs: Definitions,
  hooks: {
    numbering?: Numbering;
    labels?: Map<string, Target>;
    include?: (path: string) => boolean;
  },
): boolean {
  const chapterPrefix = () => (c.cls === "report" || c.cls === "book" ? `${chapterNumber(c)}.` : "");
  let last: Target | null = null;
  for (const e of events) {
    switch (e.kind) {
      case "head": {
        if (c.cls === "beamer" || e.star) {
          last = null;
          break;
        }
        const n = bumpHead(c, e.level);
        hooks.numbering?.heads.set(e.pos, n ?? "");
        last = n ? { num: n, kind: e.level <= 0 ? (e.level < 0 ? "Part" : c.appendix ? "Appendix" : "Chapter") : c.appendix && e.level === 1 && c.cls === "article" ? "Appendix" : "Section" } : null;
        break;
      }
      case "appendix":
        c.appendix = true;
        if (c.cls === "article") c.section = 0;
        else c.chapter = 0;
        break;
      case "include":
        if (hooks.include?.(e.path)) return true;
        break;
      case "caption": {
        if (!e.float || e.float === "subfigure") break;
        const kind = e.float === "table" ? "table" : e.float === "algorithm" ? "algorithm" : "figure";
        const n = (c.figure.get(kind) ?? 0) + 1;
        c.figure.set(kind, n);
        const num = `${chapterPrefix()}${n}`;
        hooks.numbering?.captions.set(e.pos, num);
        last = { num, kind: kind === "table" ? "Table" : kind === "algorithm" ? "Algorithm" : "Figure" };
        break;
      }
      case "theorem": {
        const def = defs.theorems.get(e.env);
        if (!def || !def.counter || e.star) break;
        const key = def.counter;
        const n = (c.theorem.get(key) ?? 0) + 1;
        c.theorem.set(key, n);
        const within = def.within === "chapter" ? `${chapterNumber(c)}.` : def.within === "section" ? `${sectionNumber(c)}.` : "";
        const num = `${within}${n}`;
        hooks.numbering?.theorems.set(e.pos, num);
        last = { num, kind: def.title };
        break;
      }
      case "math": {
        const rows = mathRows(e.env, e.body);
        const nums: string[] = [];
        for (const row of rows) {
          let num = "";
          if (row.tag !== null) num = row.tag;
          else if (row.numbered) {
            c.equation++;
            num = `${chapterPrefix()}${c.equation}`;
          }
          nums.push(num);
          for (const key of row.labels) if (num) hooks.labels?.set(key, { num, kind: "Equation" });
        }
        hooks.numbering?.equations.set(e.pos, nums);
        last = null;
        break;
      }
      case "label":
        if (last && !hooks.labels?.has(e.key)) hooks.labels?.set(e.key, last);
        break;
      case "footnote":
        c.footnote++;
        hooks.numbering?.footnotes.set(e.pos, c.footnote);
        break;
    }
  }
  return false;
}

function chapterNumber(c: CounterState): string {
  return c.appendix ? alpha(c.chapter).toUpperCase() : String(c.chapter);
}
function sectionNumber(c: CounterState): string {
  if (c.cls === "article") return c.appendix ? alpha(c.section).toUpperCase() : String(c.section);
  return `${chapterNumber(c)}.${c.section}`;
}

/** Steps the counter for a heading of `level` and returns its number, or null when the class does not number that level. */
function bumpHead(c: CounterState, level: number): string | null {
  if (level < 0) {
    c.part++;
    return roman(c.part).toUpperCase();
  }
  const report = c.cls === "report" || c.cls === "book";
  const name = LEVEL_NAMES[level];
  if (!name) return null;
  if (name === "chapter") {
    if (!report) return null;
    c.chapter++;
    c.section = c.subsection = c.subsubsection = 0;
    c.figure = new Map();
    c.equation = 0;
    // Theorems numbered within chapters start again.
    c.theorem = new Map();
    return chapterNumber(c);
  }
  if (name === "section") {
    c.section++;
    c.subsection = c.subsubsection = 0;
    if (!report) {
      // Theorems numbered within sections start again.
      c.theorem = new Map();
    }
    return sectionNumber(c);
  }
  if (name === "subsection") {
    c.subsection++;
    c.subsubsection = 0;
    return `${sectionNumber(c)}.${c.subsection}`;
  }
  if (name === "subsubsection") {
    c.subsubsection++;
    // Reports number down to subsections only.
    return report ? null : `${sectionNumber(c)}.${c.subsection}.${c.subsubsection}`;
  }
  return null;
}

// ─── The project walk ───

interface Cached {
  text: string;
  scan: Scan;
  defs: Definitions;
}
const fileCache = new Map<string, Cached>();
/** Goes up whenever a file's cached reading is redone, so a context built before is known to be stale. */
let generation = 0;

/** A project file's skeleton, read once per version of its text. */
export function fileScan(file: ProjectFile): Scan {
  return cached(file).scan;
}

function cached(file: ProjectFile): Cached {
  const hit = fileCache.get(file.path);
  if (hit && hit.text === file.text) return hit;
  generation++;
  const entry = { text: file.text, scan: scan(file.text), defs: readDefinitions(file.text) };
  fileCache.set(file.path, entry);
  if (fileCache.size > 400) fileCache.delete(fileCache.keys().next().value!);
  return entry;
}

/** The project's files that an \input{name} could mean, from the file that says it. */
export function resolveInclude(name: string, from: string | null, paths: Iterable<string>): string | null {
  const clean = name.replace(/^\.\//, "").trim();
  const dir = from && from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
  const candidates = [clean, `${clean}.tex`, `${dir}${clean}`, `${dir}${clean}.tex`];
  const set = new Set(paths);
  for (const c of candidates) if (set.has(c)) return c;
  return null;
}

export interface ProjectContext {
  defs: Definitions;
  cls: DocClass;
  /** The counters where this file starts. */
  start: CounterState;
  /** Every label in the document, with what it names. */
  labels: Map<string, Target>;
  /** Moves counters through a file this one includes, as LaTeX would read it in place. */
  walkInclude: (name: string, counters: CounterState) => void;
  /** The project's files by path. */
  files: Map<string, ProjectFile>;
}

let lastKey = "";
let lastContext: ProjectContext | null = null;

/**
 * Works out where `path` sits in its project: which file includes it (directly or not), the counters at that point, and every label in the document. `live` is the file's current text, which is newer than the copy in `files`.
 */
export function projectContext(path: string | null, files: ProjectFile[], live: Scan): ProjectContext {
  const others = files.filter((f) => f.path !== path && /\.(tex|ltx|sty|cls)$/i.test(f.path));
  const own: ProjectFile = { path: path ?? "", text: live.text };
  const all = [...others, own];
  for (const f of others) cached(f);
  const key = `${path}\u0000${others.map((f) => f.path).join("|")}\u0000${generation}\u0000${eventSignature(live.events)}\u0000${live.docclass}\u0000${defsSignature(live.text)}`;
  if (key === lastKey && lastContext) return lastContext;

  const defs: Definitions = { macros: new Map(), katex: {}, theorems: new Map() };
  for (const f of others) mergeDefs(defs, cached(f).defs);
  // This file's own definitions win, and are read from its live text.
  mergeDefs(defs, readDefinitions(live.text));
  for (const [name, t] of Object.entries(THEOREMS)) if (!defs.theorems.has(name)) defs.theorems.set(name, { ...t, counter: null, within: null });

  const byPath = new Map(all.map((f) => [f.path, f]));
  const scanOf = (p: string) => (p === own.path ? live : cached(byPath.get(p)!).scan);
  // The root: this file if it is a whole document, otherwise a document that includes it.
  const roots = all.filter((f) => (f.path === own.path ? live : cached(f).scan).docclass !== null && scanOf(f.path).document);
  let root = roots.find((f) => f.path === own.path) ?? null;
  if (!root && path) root = roots.find((f) => reaches(f.path, path, byPath, scanOf, new Set())) ?? null;

  const cls = classOf(root ? scanOf(root.path).docclass : null, live);
  const labels = new Map<string, Target>();
  let snapshot: CounterState | null = null;
  const visiting = new Set<string>();
  /** Reads file `p` in place: its counters move `counters`, its labels go to `out`, and the moment it includes the file being edited is noted. */
  const walk = (p: string, counters: CounterState, out: Map<string, Target>): void => {
    if (visiting.has(p) || visiting.size > 12) return;
    visiting.add(p);
    run(scanOf(p).events, counters, defs, {
      // This file's own labels are taken from its live text instead (numberFile).
      labels: p === own.path ? new Map() : out,
      include: (name) => {
        const target = resolveInclude(name, p, byPath.keys());
        if (!target) return false;
        if (target === own.path && !snapshot) snapshot = cloneCounters(counters);
        walk(target, counters, out);
        return false;
      },
    });
    visiting.delete(p);
  };
  let start = freshCounters(cls);
  if (root) {
    if (root.path === own.path) snapshot = freshCounters(cls);
    walk(root.path, freshCounters(cls), labels);
    if (snapshot) start = snapshot;
  }
  const walkInclude = (name: string, counters: CounterState) => {
    const target = resolveInclude(name, own.path, byPath.keys());
    if (!target || target === own.path) return;
    visiting.clear();
    visiting.add(own.path);
    walk(target, counters, new Map());
    visiting.clear();
  };
  lastKey = key;
  lastContext = { defs, cls, start, labels, walkInclude, files: byPath };
  return lastContext;
}

function mergeDefs(into: Definitions, from: Definitions) {
  for (const [k, v] of from.macros) into.macros.set(k, v);
  Object.assign(into.katex, from.katex);
  for (const [k, v] of from.theorems) into.theorems.set(k, v);
}

function reaches(from: string, target: string, byPath: Map<string, ProjectFile>, scanOf: (p: string) => Scan, seen: Set<string>): boolean {
  if (seen.has(from) || seen.size > 40) return false;
  seen.add(from);
  for (const inc of scanOf(from).includes.values()) {
    const p = resolveInclude(inc.path, from, byPath.keys());
    if (!p) continue;
    if (p === target || reaches(p, target, byPath, scanOf, seen)) return true;
  }
  return false;
}

/** Numbers this file's own headings, floats, theorems, and equations from where it starts, and adds its labels to the document's. */
export function numberFile(live: Scan, ctx: ProjectContext): { numbering: Numbering; labels: Map<string, Target> } {
  const numbering: Numbering = { heads: new Map(), captions: new Map(), theorems: new Map(), equations: new Map(), footnotes: new Map() };
  const labels = new Map(ctx.labels);
  const own = new Map<string, Target>();
  const counters = cloneCounters(ctx.start);
  run(live.events, counters, ctx.defs, {
    numbering,
    labels: own,
    include: (name) => {
      ctx.walkInclude(name, counters);
      return false;
    },
  });
  for (const [k, v] of own) labels.set(k, v);
  return { numbering, labels };
}

/** The definition lines of a file, so the context is rebuilt when one of them changes. */
function defsSignature(text: string): string {
  const m = text.match(/\\(newcommand|renewcommand|providecommand|DeclareMathOperator|def|newtheorem|theoremstyle)\b[^\n]*/g);
  return m ? m.join("\n") : "";
}

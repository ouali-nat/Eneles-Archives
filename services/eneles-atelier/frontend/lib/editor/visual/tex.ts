/**
 * Small, forgiving readers for LaTeX source: balanced groups, optional arguments, command names, and the tables of characters that escapes, accents, and symbols stand for. Nothing here throws; a reader that cannot find what it wants returns -1 or null and the caller shows the source as it is.
 */

/** Longest stretch a single argument may span before it is taken to be unbalanced. */
const MAX_ARG = 4000;

export const isLetter = (c: string | undefined) => !!c && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
export const isSpace = (c: string | undefined) => c === " " || c === "\t";

/** Index just past the balanced {…} that opens at `i`, or -1. A blank line ends the search: no argument runs across a paragraph break. */
export function groupEnd(text: string, i: number, limit = text.length): number {
  if (text[i] !== "{") return -1;
  let depth = 0;
  const stop = Math.min(limit, i + MAX_ARG);
  for (let j = i; j < stop; j++) {
    const ch = text[j];
    if (ch === "\\") {
      j++;
      continue;
    }
    if (ch === "%") {
      const eol = text.indexOf("\n", j);
      if (eol === -1) return -1;
      j = eol - 1;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      if (--depth === 0) return j + 1;
    } else if (ch === "\n" && blankAfter(text, j)) return -1;
  }
  return -1;
}

/** Whether the newline at `j` starts a blank line. */
function blankAfter(text: string, j: number): boolean {
  for (let k = j + 1; k < text.length; k++) {
    const c = text[k];
    if (c === "\n") return true;
    if (c !== " " && c !== "\t" && c !== "\r") return false;
  }
  return true;
}

/** Index just past the […] that opens at `i` (brackets nest through braces), or `i` itself when there is none, or -1 when it does not close. */
export function optEnd(text: string, i: number, limit = text.length): number {
  if (text[i] !== "[") return i;
  let depth = 0;
  const stop = Math.min(limit, i + MAX_ARG);
  for (let j = i + 1; j < stop; j++) {
    const ch = text[j];
    if (ch === "\\") {
      j++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === "]" && depth <= 0) return j + 1;
    else if (ch === "\n" && blankAfter(text, j)) return -1;
  }
  return -1;
}

/** Skips spaces and tabs (and at most one newline when `newline` is set). */
export function skipSpace(text: string, i: number, newline = false): number {
  let seen = false;
  while (i < text.length) {
    const c = text[i];
    if (isSpace(c)) i++;
    else if (c === "\n" && newline && !seen) {
      seen = true;
      i++;
    } else break;
  }
  return i;
}

/** The command name that starts after the backslash at `i`, and where it ends. */
export function readName(text: string, i: number): { name: string; end: number } {
  let j = i + 1;
  while (j < text.length && isLetter(text[j])) j++;
  if (j === i + 1) return { name: text[i + 1] ?? "", end: Math.min(text.length, i + 2) };
  return { name: text.slice(i + 1, j), end: j };
}

/** Reads a run of arguments after a command: optional […] and required {…}, in the order given by `shape` ("o" optional, "m" mandatory, "s" a star). `args[k]` is the k-th letter of the shape (null for a star or a missing option). Returns null if a mandatory one is missing or unbalanced. */
export function readArgs(
  text: string,
  i: number,
  shape: string,
  limit = text.length,
): { end: number; args: ({ from: number; to: number } | null)[]; star: boolean } | null {
  const args: ({ from: number; to: number } | null)[] = [];
  let star = false;
  let j = i;
  for (const kind of shape) {
    if (kind === "s") {
      // A star takes a slot too, so argument indexes follow the shape string.
      if (text[j] === "*") {
        star = true;
        j++;
      }
      args.push(null);
      continue;
    }
    const k = skipSpace(text, j, true);
    if (kind === "o") {
      if (text[k] !== "[") {
        args.push(null);
        continue;
      }
      const e = optEnd(text, k, limit);
      if (e === -1) return null;
      args.push({ from: k + 1, to: e - 1 });
      j = e;
    } else {
      if (text[k] !== "{") return null;
      const e = groupEnd(text, k, limit);
      if (e === -1) return null;
      args.push({ from: k + 1, to: e - 1 });
      j = e;
    }
  }
  return { end: j, args, star };
}

/** The characters that one-symbol escapes stand for. */
export const ESCAPES: Record<string, string> = {
  "%": "%",
  "&": "&",
  _: "_",
  "#": "#",
  $: "$",
  "{": "{",
  "}": "}",
  ",": " ",
  ";": " ",
  ":": " ",
  " ": " ",
  "!": "",
  "/": "",
  "-": "",
  "@": "",
};

/** Commands that produce one character. */
export const SYMBOLS: Record<string, string> = {
  ldots: "…",
  dots: "…",
  textellipsis: "…",
  textbackslash: "\\",
  textasciitilde: "~",
  textasciicircum: "^",
  textbar: "|",
  textless: "<",
  textgreater: ">",
  textendash: "–",
  textemdash: "—",
  textquoteleft: "‘",
  textquoteright: "’",
  textquotedblleft: "“",
  textquotedblright: "”",
  textbullet: "•",
  textperiodcentered: "·",
  textdegree: "°",
  copyright: "©",
  textcopyright: "©",
  textregistered: "®",
  texttrademark: "™",
  S: "§",
  P: "¶",
  dag: "†",
  ddag: "‡",
  pounds: "£",
  euro: "€",
  ss: "ß",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  o: "ø",
  O: "Ø",
  l: "ł",
  L: "Ł",
  i: "ı",
  j: "ȷ",
  aa: "å",
  AA: "Å",
  quad: " ",
  qquad: "  ",
  enspace: " ",
  thinspace: " ",
  space: " ",
  nobreakspace: " ",
  textvisiblespace: "␣",
  checkmark: "✓",
};

/** Accent commands and the combining marks they add. */
export const ACCENTS: Record<string, string> = {
  "'": "́",
  "`": "̀",
  "^": "̂",
  '"': "̈",
  "~": "̃",
  "=": "̄",
  ".": "̇",
  u: "̆",
  v: "̌",
  H: "̋",
  c: "̧",
  k: "̨",
  r: "̊",
  d: "̣",
  b: "̱",
};

/** Applies an accent to a letter, composed where Unicode has the character. */
export function accent(mark: string, letter: string): string {
  const base = letter === "\\i" ? "i" : letter === "\\j" ? "j" : letter;
  return (base + mark).normalize("NFC");
}

/** Text-style commands with one argument, and the class that draws them. */
export const TEXT_STYLES: Record<string, string> = {
  textbf: "cm-v-bold",
  textit: "cm-v-italic",
  emph: "cm-v-italic",
  textsl: "cm-v-italic",
  underline: "cm-v-underline",
  uline: "cm-v-underline",
  ul: "cm-v-underline",
  sout: "cm-v-strike",
  st: "cm-v-strike",
  texttt: "cm-v-mono",
  textsc: "cm-v-smallcaps",
  textsf: "cm-v-sans",
  textrm: "cm-v-plain",
  textup: "cm-v-plain",
  textmd: "cm-v-plain",
  textnormal: "cm-v-plain",
  mbox: "cm-v-plain",
  hbox: "cm-v-plain",
  makebox: "cm-v-plain",
  textsuperscript: "cm-v-sup",
  textsubscript: "cm-v-sub",
  hl: "cm-v-highlight",
  enquote: "cm-v-quoted",
};

/** Declarations that change the font until the group ends, as in {\bf …}. */
export const DECLARATIONS: Record<string, string> = {
  bf: "cm-v-bold",
  bfseries: "cm-v-bold",
  it: "cm-v-italic",
  itshape: "cm-v-italic",
  em: "cm-v-italic",
  sl: "cm-v-italic",
  slshape: "cm-v-italic",
  tt: "cm-v-mono",
  ttfamily: "cm-v-mono",
  sc: "cm-v-smallcaps",
  scshape: "cm-v-smallcaps",
  sf: "cm-v-sans",
  sffamily: "cm-v-sans",
  rm: "cm-v-plain",
  rmfamily: "cm-v-plain",
  upshape: "cm-v-plain",
  normalfont: "cm-v-plain",
  tiny: "cm-v-size-xs",
  scriptsize: "cm-v-size-xs",
  footnotesize: "cm-v-size-sm",
  small: "cm-v-size-sm",
  normalsize: "cm-v-plain",
  large: "cm-v-size-lg",
  Large: "cm-v-size-xl",
  LARGE: "cm-v-size-xl",
  huge: "cm-v-size-xxl",
  Huge: "cm-v-size-xxl",
};

/** Commands that only affect layout or spacing and have nothing to show. The number is how many mandatory arguments they take ("o" adds an optional one, "s" a star). */
export const QUIET: Record<string, string> = {
  noindent: "",
  indent: "",
  centering: "",
  raggedright: "",
  raggedleft: "",
  par: "",
  smallskip: "",
  medskip: "",
  bigskip: "",
  vfill: "",
  hfill: "",
  hfil: "",
  vfil: "",
  linebreak: "o",
  nolinebreak: "o",
  protect: "",
  phantomsection: "",
  FloatBarrier: "",
  null: "",
  relax: "",
  selectfont: "",
  strut: "",
  vspace: "sm",
  hspace: "sm",
  addvspace: "m",
  addcontentsline: "mmm",
  pagestyle: "m",
  thispagestyle: "m",
  pagenumbering: "m",
  onehalfspacing: "",
  doublespacing: "",
  singlespacing: "",
  frenchspacing: "",
  sloppy: "",
  fussy: "",
  allowbreak: "",
  nopagebreak: "o",
  pause: "",
  justifying: "",
  index: "m",
  glsresetall: "",
};

/** Floats and the name their captions carry. */
export const FLOATS: Record<string, string> = {
  figure: "Figure",
  "figure*": "Figure",
  table: "Table",
  "table*": "Table",
  wrapfigure: "Figure",
  wraptable: "Table",
  subfigure: "Figure",
  algorithm: "Algorithm",
  listing: "Listing",
  sidewaysfigure: "Figure",
  sidewaystable: "Table",
};

export const SECTION_LEVELS: Record<string, number> = {
  part: -1,
  chapter: 0,
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
  subparagraph: 5,
};

/** Display-math environments. */
export const MATH_ENVS = /^(equation|align|alignat|flalign|gather|multline|eqnarray|displaymath|math|dmath|dgroup)\*?$/;
/** Environments whose body is taken exactly as written. */
export const RAW_ENVS = /^(verbatim\*?|Verbatim\*?|BVerbatim|lstlisting|minted|comment|filecontents\*?|alltt|tikzpicture|tikzcd|forest|pgfpicture|asy|circuitikz)$/;
export const LIST_ENVS = /^(itemize|enumerate|description|compactitem|compactenum|inparaenum|asparaenum|enumerate\*|itemize\*)$/;
export const TABULAR_ENVS = /^(tabular\*?|tabularx|tabulary|longtable|array)$/;

/** Theorem-like environments known without a \newtheorem, with their title and whether the body is set in italics. */
export const THEOREMS: Record<string, { title: string; italic: boolean }> = {
  theorem: { title: "Theorem", italic: true },
  thm: { title: "Theorem", italic: true },
  lemma: { title: "Lemma", italic: true },
  lem: { title: "Lemma", italic: true },
  proposition: { title: "Proposition", italic: true },
  prop: { title: "Proposition", italic: true },
  corollary: { title: "Corollary", italic: true },
  cor: { title: "Corollary", italic: true },
  conjecture: { title: "Conjecture", italic: true },
  claim: { title: "Claim", italic: true },
  fact: { title: "Fact", italic: true },
  observation: { title: "Observation", italic: true },
  definition: { title: "Definition", italic: false },
  defn: { title: "Definition", italic: false },
  example: { title: "Example", italic: false },
  exercise: { title: "Exercise", italic: false },
  problem: { title: "Problem", italic: false },
  question: { title: "Question", italic: false },
  assumption: { title: "Assumption", italic: false },
  axiom: { title: "Axiom", italic: false },
  hypothesis: { title: "Hypothesis", italic: false },
  remark: { title: "Remark", italic: false },
  note: { title: "Note", italic: false },
  notation: { title: "Notation", italic: false },
  solution: { title: "Solution", italic: false },
  answer: { title: "Answer", italic: false },
  case: { title: "Case", italic: false },
};

/** A readable name for an environment nobody taught us: "subfigure" becomes "Subfigure". */
export function envTitle(name: string): string {
  const bare = name.replace(/\*$/, "");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/** Lower-case roman numerals for list labels and part numbers. */
export function roman(n: number): string {
  const table: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

export const alpha = (n: number) => (n >= 1 && n <= 26 ? String.fromCharCode(96 + n) : String(n));

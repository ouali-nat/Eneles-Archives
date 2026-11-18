/**
 * The words in a LaTeX source that a spell checker should look at: running
 * text, section titles, captions, footnotes. Skipped: commands, comments,
 * math, verbatim, and code, and the arguments of commands that take names
 * rather than prose (\label, \cite, \usepackage, \begin, \includegraphics…).
 */

export interface SpellWord {
  from: number;
  to: number;
  word: string;
}

/** Commands whose braced arguments are names, keys, or code, not prose. */
const NAME_ARGS: Record<string, number> = {
  label: 1, ref: 1, eqref: 1, autoref: 1, cref: 1, Cref: 1, pageref: 1, nameref: 1, vref: 1,
  cite: 1, citep: 1, citet: 1, citealp: 1, citealt: 1, citeauthor: 1, citeyear: 1,
  parencite: 1, textcite: 1, autocite: 1, footcite: 1, fullcite: 1, nocite: 1, Cite: 1, Textcite: 1,
  usepackage: 1, RequirePackage: 1, documentclass: 1, LoadClass: 1,
  begin: 1, end: 1, input: 1, include: 1, includeonly: 1, subfile: 1,
  includegraphics: 1, includepdf: 1, graphicspath: 1, bibliography: 1, bibliographystyle: 1,
  addbibresource: 1, printbibliography: 0,
  url: 1, href: 1, hyperref: 0, hypersetup: 1,
  newcommand: 2, renewcommand: 2, providecommand: 2, DeclareRobustCommand: 2,
  newenvironment: 3, renewenvironment: 3, def: 1, let: 0,
  DeclareMathOperator: 2, newtheorem: 1, theoremstyle: 1, numberwithin: 2,
  setlength: 2, addtolength: 2, setcounter: 2, addtocounter: 2, newcounter: 1, stepcounter: 1,
  hspace: 1, vspace: 1, phantom: 1, hphantom: 1, vphantom: 1,
  color: 1, textcolor: 1, colorbox: 1, fcolorbox: 2, pagecolor: 1, definecolor: 3, colorlet: 2,
  pagestyle: 1, thispagestyle: 1, pagenumbering: 1,
  geometry: 1, usetikzlibrary: 1, tikzset: 1, pgfplotsset: 1, lstset: 1, captionsetup: 1,
  setmainfont: 1, setsansfont: 1, setmonofont: 1, fontspec: 1, newfontfamily: 2, selectlanguage: 1,
  verb: 0, lstinline: 1, mintinline: 2, texttt: 1, path: 1,
  SI: 2, si: 1, num: 1, qty: 2, unit: 1, ang: 1,
  ensuremath: 1, makeatletter: 0, makeatother: 0,
  multicolumn: 2, multirow: 2, cline: 1, cmidrule: 1, rule: 2, resizebox: 2, scalebox: 1,
  setbeamertemplate: 1, usetheme: 1, usecolortheme: 1, usefonttheme: 1,
  newglossaryentry: 1, gls: 1, Gls: 1, glspl: 1, acrshort: 1, acrlong: 1, acrfull: 1, ac: 1, acp: 1,
  index: 1, nomenclature: 0,
};

/** Environments whose body is not prose. */
const SKIP_ENVS = new Set([
  "equation", "equation*", "align", "align*", "alignat", "alignat*", "gather", "gather*",
  "multline", "multline*", "flalign", "flalign*", "eqnarray", "eqnarray*", "displaymath", "math",
  "split", "cases", "matrix", "pmatrix", "bmatrix", "vmatrix", "array", "subequations*",
  "verbatim", "verbatim*", "Verbatim", "lstlisting", "minted", "comment", "filecontents", "filecontents*",
  "tikzpicture", "tikzcd", "pgfpicture", "axis", "circuitikz", "forest", "quantikz", "pspicture",
  "luacode", "luacode*", "algorithmic", "thebibliography",
]);

/** Environments that take a column spec or other code right after \begin{…}. */
const ENV_LEADING_ARGS: Record<string, number> = {
  tabular: 1, "tabular*": 2, tabularx: 2, tabulary: 2, longtable: 1, tblr: 1, longtblr: 1,
  array: 1, minipage: 1, wrapfigure: 2, multicols: 1, "multicols*": 1, subfigure: 1, adjustbox: 1,
};

const isLetter = (ch: string) => /[A-Za-z@]/.test(ch);

/** Index just past the brace group opening at `i` (text[i] === "{"). */
function skipGroup(text: string, i: number, open = "{", close = "}"): number {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (ch === "\\") {
      j++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return j + 1;
    } else if (ch === "%" && open === "{") {
      const nl = text.indexOf("\n", j);
      j = nl === -1 ? text.length : nl;
    }
  }
  return text.length;
}

function skipSpaces(text: string, i: number): number {
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
  return i;
}

/** Skip `count` arguments, each optionally preceded by [..] options. */
function skipArgs(text: string, i: number, count: number): number {
  let j = i;
  let taken = 0;
  while (j < text.length) {
    const k = skipSpaces(text, j);
    if (text[k] === "*") {
      j = k + 1;
      continue;
    }
    if (text[k] === "[") {
      j = skipGroup(text, k, "[", "]");
      continue;
    }
    if (taken < count && text[k] === "{") {
      j = skipGroup(text, k);
      taken++;
      continue;
    }
    if (taken < count && text[k] === "\\" && count > 0 && taken === 0) {
      // \newcommand\foo{...}: an unbraced first argument.
      let e = k + 1;
      while (e < text.length && isLetter(text[e])) e++;
      j = e;
      taken++;
      continue;
    }
    break;
  }
  return j;
}

/** Position of the matching \end{env}, or the end of the text. */
function findEnd(text: string, from: number, env: string): number {
  const needle = `\\end{${env}}`;
  const at = text.indexOf(needle, from);
  return at === -1 ? text.length : at + needle.length;
}

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/uy;

/** Words worth checking: not one letter, no digits, not ALLCAPS or camelCase. */
function worthChecking(word: string): boolean {
  if (word.length < 2) return false;
  if (word === word.toUpperCase()) return false;
  if (/\p{Lu}/u.test(word.slice(1).replace(/['’]/g, ""))) return false;
  return true;
}

export function spellWords(text: string): SpellWord[] {
  const out: SpellWord[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];

    if (ch === "%") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }

    if (ch === "\\") {
      const next = text[i + 1];
      if (next === undefined) break;
      if (next === "(" || next === "[") {
        const close = next === "(" ? "\\)" : "\\]";
        const at = text.indexOf(close, i + 2);
        i = at === -1 ? n : at + 2;
        continue;
      }
      if (!isLetter(next)) {
        i += 2; // \%, \&, \\, \{ …
        continue;
      }
      let e = i + 1;
      while (e < n && isLetter(text[e])) e++;
      const name = text.slice(i + 1, e);

      if (name === "verb" || name === "lstinline") {
        // \verb|...| with any delimiter, or \lstinline{...}.
        let k = e;
        if (text[k] === "*") k++;
        if (text[k] === "[") k = skipGroup(text, k, "[", "]");
        const delim = text[k];
        if (delim === "{") {
          i = skipGroup(text, k);
        } else if (delim) {
          const at = text.indexOf(delim, k + 1);
          i = at === -1 ? n : at + 1;
        } else {
          i = k;
        }
        continue;
      }

      if (name === "begin") {
        const k = skipSpaces(text, e);
        if (text[k] === "{") {
          const close = text.indexOf("}", k);
          const env = close === -1 ? "" : text.slice(k + 1, close).trim();
          const after = close === -1 ? n : close + 1;
          if (SKIP_ENVS.has(env)) {
            i = findEnd(text, after, env);
            continue;
          }
          i = skipArgs(text, after, ENV_LEADING_ARGS[env] ?? 0);
          continue;
        }
      }

      if (name in NAME_ARGS) {
        i = skipArgs(text, e, NAME_ARGS[name]);
        continue;
      }
      i = e;
      continue;
    }

    if (ch === "$") {
      const display = text[i + 1] === "$";
      const close = display ? "$$" : "$";
      let j = i + close.length;
      while (j < n) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text.startsWith(close, j)) break;
        j++;
      }
      i = Math.min(n, j + close.length);
      continue;
    }

    WORD.lastIndex = i;
    const m = WORD.exec(text);
    if (m) {
      const word = m[0];
      const end = i + word.length;
      // Glued to a digit or an underscore, it is an identifier.
      const before = text[i - 1];
      const after = text[end];
      const glued = (c: string | undefined) => c !== undefined && /[0-9_]/.test(c);
      if (!glued(before) && !glued(after) && worthChecking(word)) {
        out.push({ from: i, to: end, word: word.replace(/’/g, "'") });
      }
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

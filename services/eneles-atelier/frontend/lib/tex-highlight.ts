/*
 * Syntax colors for LaTeX and BibTeX shown outside the editor: the assistant's diffs, suggested changes, code blocks in the manuals, a snip's source. The editor itself is colored by its own theme; everywhere else the site's tokens color the same things, so source reads the same on every page: commands, the names they take (an environment, a label, a file, a citation key), math, the separators that lay out a table or a matrix, comments, and punctuation.
 *
 * It works a line at a time and hands back what it needs to carry into the next line (whether display math is open), so a diff or a long block can be colored row by row.
 */

export type TexTone = "command" | "name" | "math" | "comment" | "punctuation" | "keyword" | "align";
export type TexToken = { text: string; tone?: TexTone };
export type TexLanguage = "latex" | "bibtex";

/** What a line leaves open for the next one. */
export interface TexLineState {
  /** Inside \[ … \], $$ … $$, or a math environment that began on an earlier line. */
  math: boolean;
}

export const TEX_START: TexLineState = { math: false };

/** Commands whose first braced argument is a name, not prose. */
const NAMING = new Set(["begin", "end", "label", "ref", "eqref", "pageref", "autoref", "cref", "Cref", "nameref", "input", "include", "includegraphics", "usepackage", "RequirePackage", "documentclass", "bibliography", "bibliographystyle", "addbibresource", "usetikzlibrary", "newcommand", "renewcommand", "providecommand", "newenvironment", "renewenvironment", "newtheorem", "DeclareMathOperator", "hypersetup", "setcounter", "pagestyle"]);
const MATH_ENVIRONMENTS = /^(equation|align|alignat|gather|multline|flalign|eqnarray|displaymath|math)\*?$/;
const isCitation = (name: string) => /^[a-zA-Z]*cite[a-zA-Z]*\*?$/.test(name);

function push(tokens: TexToken[], text: string, tone?: TexTone) {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.tone === tone) last.text += text;
  else tokens.push({ text, tone });
}

/** One line of LaTeX as colored pieces. */
export function tokenizeTexLine(line: string, state: TexLineState = TEX_START): { tokens: TexToken[]; state: TexLineState } {
  const tokens: TexToken[] = [];
  let math = state.math;
  // Inline math ($ … $) opened on this line; it never carries to the next.
  let inline = false;
  // After \begin, \label, \cite and their like: the next braced group is a name. Optional arguments in brackets may come first.
  let naming: string | null = null;
  let i = 0;
  const tone = () => (math || inline ? "math" : undefined);
  while (i < line.length) {
    const c = line[i];
    if (c === "%") {
      push(tokens, line.slice(i), "comment");
      break;
    }
    if (c === "\\") {
      const word = /^\\([a-zA-Z@]+\*?)/.exec(line.slice(i));
      if (!word) {
        // A control symbol: \\, \%, \[, \(, \{ and the rest.
        const symbol = line.slice(i, i + 2);
        if (symbol === "\\[" || symbol === "\\(") {
          math = true;
          push(tokens, symbol, "math");
        } else if (symbol === "\\]" || symbol === "\\)") {
          push(tokens, symbol, "math");
          math = false;
        } else if (symbol === "\\\\") push(tokens, symbol, "align");
        else push(tokens, symbol, tone() ?? "command");
        i += symbol.length;
        naming = null;
        continue;
      }
      const name = word[1];
      push(tokens, word[0], tone() ?? "command");
      i += word[0].length;
      naming = NAMING.has(name.replace(/\*$/, "")) || isCitation(name) ? name : null;
      continue;
    }
    if (naming && c === "[") {
      // An optional argument before the name: \usepackage[utf8]{inputenc}.
      const close = line.indexOf("]", i);
      const end = close < 0 ? line.length : close + 1;
      push(tokens, "[", "punctuation");
      push(tokens, line.slice(i + 1, close < 0 ? end : close));
      if (close >= 0) push(tokens, "]", "punctuation");
      i = end;
      continue;
    }
    if (naming && c === "{") {
      const close = line.indexOf("}", i);
      const end = close < 0 ? line.length : close;
      const inner = line.slice(i + 1, end);
      push(tokens, "{", "punctuation");
      push(tokens, inner, "name");
      if (close >= 0) push(tokens, "}", "punctuation");
      i = close < 0 ? line.length : close + 1;
      const command = naming.replace(/\*$/, "");
      if (MATH_ENVIRONMENTS.test(inner)) math = command === "begin" ? true : command === "end" ? false : math;
      // \newcommand{\name}[2]{…}: only the first group is the name.
      naming = null;
      continue;
    }
    naming = null;
    if (c === "$") {
      const double = line[i + 1] === "$";
      if (double) {
        math = !math;
        push(tokens, "$$", "math");
        i += 2;
      } else {
        push(tokens, "$", "math");
        inline = !inline;
        i += 1;
      }
      continue;
    }
    if (c === "{" || c === "}" || c === "[" || c === "]") {
      push(tokens, c, tone() ?? "punctuation");
      i += 1;
      continue;
    }
    if (c === "&") {
      // Cell and row separators lay a table, a matrix, or a circuit out, so they keep a color of their own even inside math.
      push(tokens, c, "align");
      i += 1;
      continue;
    }
    // Plain text up to the next thing that matters.
    const rest = /^[^\\%${}\[\]&]+/.exec(line.slice(i));
    const text = rest ? rest[0] : c;
    push(tokens, text, tone());
    i += text.length;
  }
  return { tokens, state: { math } };
}

/** One line of a .bib file: the entry type, its key, the field names, and comments. */
export function tokenizeBibLine(line: string): TexToken[] {
  const tokens: TexToken[] = [];
  if (/^\s*%/.test(line)) return [{ text: line, tone: "comment" }];
  const entry = /^(\s*)(@[a-zA-Z]+)(\s*\{\s*)([^,\s]*)(.*)$/.exec(line);
  if (entry) {
    push(tokens, entry[1]);
    push(tokens, entry[2], "keyword");
    push(tokens, entry[3], "punctuation");
    push(tokens, entry[4], "name");
    push(tokens, entry[5]);
    return tokens;
  }
  const field = /^(\s*)([a-zA-Z][\w-]*)(\s*=\s*)(.*)$/.exec(line);
  if (field) {
    push(tokens, field[1]);
    push(tokens, field[2], "command");
    push(tokens, field[3], "punctuation");
    push(tokens, field[4]);
    return tokens;
  }
  return [{ text: line }];
}

/** Which coloring a file or a fenced block's language takes; null for anything that is not TeX. */
export function texLanguageOf(nameOrLanguage: string | null | undefined): TexLanguage | null {
  const value = (nameOrLanguage ?? "").toLowerCase();
  const ext = value.includes(".") ? value.slice(value.lastIndexOf(".") + 1) : value;
  if (["tex", "latex", "ltx", "sty", "cls", "tikz", "pgf", "def", "dtx", "ins"].includes(ext)) return "latex";
  if (["bib", "bibtex", "bst"].includes(ext)) return "bibtex";
  return null;
}

/** A whole block, line by line, carrying open math from one line to the next. */
export function tokenizeTex(source: string, language: TexLanguage = "latex"): TexToken[][] {
  let state = TEX_START;
  return source.split("\n").map((line) => {
    if (language === "bibtex") return tokenizeBibLine(line);
    const result = tokenizeTexLine(line, state);
    state = result.state;
    return result.tokens;
  });
}

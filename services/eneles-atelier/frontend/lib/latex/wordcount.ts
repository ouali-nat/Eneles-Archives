/**
 * A word count from LaTeX source, in the spirit of texcount: the document's
 * body only, following \input and \include into other files, with words in
 * headings, captions, and footnotes counted apart from the running text, and
 * equations counted rather than their symbols.
 */

export interface WordCount {
  text: number;
  headings: number;
  captions: number;
  footnotes: number;
  headingCount: number;
  inlineMath: number;
  displayMath: number;
  files: string[];
  /** Files named by \input or \include that are not in the project. */
  missing: string[];
}

const SKIP_ENVS = [
  "verbatim", "verbatim*", "Verbatim", "lstlisting", "minted", "comment", "filecontents", "filecontents*",
  "tikzpicture", "tikzcd", "pgfpicture", "axis", "circuitikz", "forest", "quantikz", "pspicture",
  "thebibliography", "luacode", "luacode*",
];
const MATH_ENVS = [
  "equation", "equation*", "align", "align*", "alignat", "alignat*", "gather", "gather*", "multline",
  "multline*", "flalign", "flalign*", "eqnarray", "eqnarray*", "displaymath", "math",
];
/** Commands whose arguments are names or code: dropped with their arguments. */
const DROP = /\\(label|ref|eqref|autoref|cref|Cref|pageref|nameref|vref|[a-zA-Z]*cite[a-zA-Z]*|nocite|usepackage|documentclass|includegraphics|bibliography|bibliographystyle|addbibresource|printbibliography|url|hspace|vspace|setlength|setcounter|addtocounter|newcommand|renewcommand|providecommand|def|newenvironment|renewenvironment|color|definecolor|pagestyle|thispagestyle|label|index|hypersetup|geometry|graphicspath|input|include|begin|end|multicolumn|multirow|cline|cmidrule|SI|si|num|qty|unit|includepdf)\*?(\s*\[[^\]]*\])*(\s*\{[^{}]*(\{[^{}]*\}[^{}]*)*\})*/g;

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const words = (s: string) => (s.match(WORD) ?? []).length;

function stripComments(text: string): string {
  return text.replace(/(^|[^\\])%.*$/gm, "$1");
}

/** Index just past the balanced group that opens at `i`. */
function groupEnd(text: string, i: number): number {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === "\\") {
      j++;
      continue;
    }
    if (text[j] === "{") depth++;
    else if (text[j] === "}" && --depth === 0) return j + 1;
  }
  return text.length;
}

/** Pull out every \name[..]{...} argument, returning the text without them. */
function extract(text: string, names: string[]): { rest: string; parts: string[] } {
  const parts: string[] = [];
  const re = new RegExp(`\\\\(?:${names.join("|")})\\*?\\s*(?:\\[[^\\]]*\\]\\s*)?\\{`, "g");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    const end = groupEnd(text, open);
    parts.push(text.slice(open + 1, end - 1));
    out += text.slice(last, m.index) + " ";
    last = end;
    re.lastIndex = end;
  }
  return { rest: out + text.slice(last), parts };
}

function resolve(name: string, files: Map<string, string>): string | null {
  const clean = name.trim().replace(/^\.\//, "");
  for (const candidate of [clean, `${clean}.tex`]) if (files.has(candidate)) return candidate;
  return null;
}

/** The source with \input and \include replaced by the files they name. */
function expand(path: string, files: Map<string, string>, seen: Set<string>, missing: Set<string>, depth = 0): string {
  seen.add(path);
  const text = stripComments(files.get(path) ?? "");
  if (depth > 12) return text;
  return text.replace(/\\(?:input|include|subfile)\s*\{([^}]+)\}/g, (_, name: string) => {
    const target = resolve(name, files);
    if (!target) {
      missing.add(name.trim());
      return " ";
    }
    if (seen.has(target)) return " ";
    return ` ${expand(target, files, seen, missing, depth + 1)} `;
  });
}

export function countWords(mainPath: string, files: Map<string, string>): WordCount {
  const seen = new Set<string>();
  const missing = new Set<string>();
  let text = expand(mainPath, files, seen, missing);

  const begin = text.indexOf("\\begin{document}");
  const end = text.lastIndexOf("\\end{document}");
  // The title is usually set in the preamble; it is a heading all the same.
  const preambleTitle = begin !== -1 ? extract(text.slice(0, begin), ["title"]).parts : [];
  if (begin !== -1) text = text.slice(begin + "\\begin{document}".length, end > begin ? end : undefined);

  for (const env of SKIP_ENVS) {
    const e = env.replace(/\*/g, "\\*");
    text = text.replace(new RegExp(`\\\\begin\\{${e}\\}[\\s\\S]*?\\\\end\\{${e}\\}`, "g"), " ");
  }

  let displayMath = 0;
  for (const env of MATH_ENVS) {
    const e = env.replace(/\*/g, "\\*");
    text = text.replace(new RegExp(`\\\\begin\\{${e}\\}[\\s\\S]*?\\\\end\\{${e}\\}`, "g"), () => {
      displayMath++;
      return " ";
    });
  }
  text = text.replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, () => {
    displayMath++;
    return " ";
  });
  let inlineMath = 0;
  text = text.replace(/(?<!\\)\$(?:\\.|[^$\\])+\$|\\\([\s\S]*?\\\)/g, () => {
    inlineMath++;
    return " ";
  });

  const footnotes = extract(text, ["footnote", "footnotetext"]);
  const captions = extract(footnotes.rest, ["caption"]);
  const headings = extract(captions.rest, ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph", "title"]);
  headings.parts.unshift(...preambleTitle);

  const clean = (s: string) =>
    s
      .replace(DROP, " ")
      .replace(/\\[a-zA-Z@]+\*?/g, " ")
      .replace(/\\./g, " ")
      .replace(/[{}[\]~]/g, " ");

  return {
    text: words(clean(headings.rest)),
    headings: headings.parts.reduce((n, p) => n + words(clean(p)), 0),
    captions: captions.parts.reduce((n, p) => n + words(clean(p)), 0),
    footnotes: footnotes.parts.reduce((n, p) => n + words(clean(p)), 0),
    headingCount: headings.parts.length,
    inlineMath,
    displayMath,
    files: [...seen],
    missing: [...missing],
  };
}

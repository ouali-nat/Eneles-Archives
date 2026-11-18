/**
 * The document's outline as LaTeX numbers it: parts, chapters, and sections read from the main file and from every file it brings in with \input, \include, \subfile, \import, or \subimport, in the order they appear, so a chapter kept in its own file is numbered where the main file puts it (the third \include is chapter 3, and its sections are 3.1, 3.2, and so on).
 *
 * Numbering follows the standard classes: chapters run on across parts; sections are numbered within chapters when the document has chapters, and subsubsections only when it has none; starred headings get no number and do not count; after \appendix the top level is lettered (A, B, …); chapters in \frontmatter and \backmatter are not numbered. Comments are ignored. A file is read once on any one path from the main file, so a file that includes itself does not loop.
 */

export type OutlineLevel = 0 | 1 | 2 | 3 | 4;

export interface OutlineEntry {
  /** part=0, chapter=1, section=2, subsection=3, subsubsection=4 */
  level: OutlineLevel;
  label: string;
  /** The file the heading is in, and its line there (1-based). */
  path: string;
  line: number;
  /** As LaTeX prints it ("3.2", "A", "II"), or empty for a starred or unnumbered heading. */
  number: string;
  /** The files that led here from the root, the root first and the heading's own file last. */
  via: string[];
}

const LEVELS: Record<string, OutlineLevel> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4 };

// One command at a time, in the order they appear on a line: a heading, a file brought in, or a change of numbering.
const COMMAND = /\\(part|chapter|section|subsection|subsubsection|input|include|subfile|import|subimport|inputfrom|subinputfrom|includefrom|subincludefrom|appendix|frontmatter|mainmatter|backmatter)(?![a-zA-Z])/g;

/** The line with its comment removed: from the first % that is not escaped. */
function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "%") return line.slice(0, i);
  }
  return line;
}

/** The braced group that starts at `at` (after any spaces), with nested braces kept: its text and where it ends. */
function group(text: string, at: number, open = "{", close = "}"): { value: string; end: number } | null {
  let i = at;
  while (text[i] === " " || text[i] === "\t") i++;
  if (text[i] !== open) return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return { value: text.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

/** Folds "a/./b" and "a/x/../b" into "a/b". */
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** A heading's text as it reads in the outline: labels, footnotes, and font commands dropped, grouping braces dropped, and everything else (math, \\ref) left as written. */
function cleanLabel(raw: string): string {
  return raw
    .replace(/\\(?:protect|label\s*\{[^}]*\}|footnote\s*\{[^}]*\}|\\)/g, "")
    .replace(/~/g, " ")
    .replace(/\\(?:textbf|textit|emph|texttt|textsc|textrm|textsf|underline)\s*\{([^}]*)\}/g, "$1")
    // Bare grouping braces go; a command's argument keeps its braces, so \ref{thm:main} still reads as written.
    .replace(/(^|[^\\a-zA-Z*\]])\{([^{}]*)\}/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

function roman(n: number): string {
  let out = "";
  for (const [value, digits] of ROMAN)
    while (n >= value) {
      out += digits;
      n -= value;
    }
  return out;
}

function letter(n: number): string {
  let out = "";
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

interface Raw {
  level: OutlineLevel;
  label: string;
  starred: boolean;
  path: string;
  line: number;
  via: string[];
  /** Set by \appendix, \frontmatter, \mainmatter, and \backmatter, in place of a heading. */
  marker?: "appendix" | "frontmatter" | "mainmatter" | "backmatter";
}

/**
 * The outline of the document that starts at `root` (the main file, or any file read on its own), following the files it brings in. `files` maps each project path to its text. `baseDir` is the folder LaTeX runs in, which paths in \input are read from: the main file's, also when a file is read on its own.
 */
export function buildOutline(root: string, files: ReadonlyMap<string, string>, baseDir = dirname(root)): OutlineEntry[] {
  const resolve = (name: string, from: string): string | null => {
    const clean = name.trim();
    if (!clean) return null;
    // LaTeX looks from the folder it runs in, which is the main file's; a relative \subimport looks from the including file's.
    for (const dir of from === baseDir ? [baseDir] : [from, baseDir]) {
      const base = normalize(dir + clean);
      for (const candidate of [base, `${base}.tex`]) if (files.has(candidate)) return candidate;
    }
    return null;
  };

  const raws: Raw[] = [];
  const walk = (path: string, via: string[]) => {
    const text = files.get(path);
    if (text === undefined) return;
    const chain = [...via, path];
    const lines = text.split("\n");
    // Its own copy of the pattern: a file read from inside this one would otherwise move this one's place on the line.
    const command = new RegExp(COMMAND.source, "g");
    for (let n = 0; n < lines.length; n++) {
      const line = stripComment(lines[n]);
      if (!line.includes("\\")) continue;
      command.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = command.exec(line))) {
        const name = m[1];
        let at = m.index + m[0].length;
        if (name in LEVELS) {
          const starred = line[at] === "*";
          if (starred) at++;
          // An optional short title for the table of contents comes first; the outline shows the full one.
          const short = group(line, at, "[", "]");
          if (short) at = short.end;
          const title = group(line, at);
          if (!title) continue;
          raws.push({ level: LEVELS[name], label: cleanLabel(title.value), starred, path, line: n + 1, via: chain });
          command.lastIndex = title.end;
        } else if (name === "appendix" || name === "frontmatter" || name === "mainmatter" || name === "backmatter") {
          raws.push({ level: 0, label: "", starred: true, path, line: n + 1, via: chain, marker: name });
        } else {
          // \import{dir}{file} and its kin name a folder, then the file in it; \subimport's folder is relative to this file.
          const twoPart = name.includes("import") || name.includes("from");
          const first = group(line, at);
          if (!first) continue;
          let target: string | null;
          let end = first.end;
          if (twoPart) {
            const second = group(line, first.end);
            if (!second) continue;
            end = second.end;
            const dir = first.value.trim().replace(/\/?$/, "/");
            const relative = name.startsWith("sub");
            target = resolve(dir + second.value, relative ? dirname(path) : baseDir);
          } else {
            target = resolve(first.value, name === "subfile" ? dirname(path) : baseDir);
          }
          command.lastIndex = end;
          if (target && !chain.includes(target)) walk(target, chain);
        }
      }
    }
  };
  walk(root, []);

  const hasChapters = raws.some((r) => !r.marker && r.level === 1);
  const counters = [0, 0, 0, 0, 0];
  let appendix = false;
  let matter: "front" | "main" | "back" = "main";
  const entries: OutlineEntry[] = [];
  for (const r of raws) {
    if (r.marker) {
      if (r.marker === "appendix") {
        appendix = true;
        // The top level starts again, lettered.
        const top = hasChapters ? 1 : 2;
        for (let d = top; d < counters.length; d++) counters[d] = 0;
      } else matter = r.marker === "frontmatter" ? "front" : r.marker === "backmatter" ? "back" : "main";
      continue;
    }
    // In the front and back matter of a book, chapters are not numbered (and nothing under them is).
    const numbered = !r.starred && !(hasChapters && matter !== "main");
    // Books and reports number down to subsections; articles down to subsubsections.
    const shown = numbered && !(hasChapters && r.level === 4);
    let number = "";
    if (numbered) {
      counters[r.level]++;
      // A part does not start the chapters again; everything else starts the levels below it again.
      for (let d = Math.max(r.level + 1, r.level === 0 ? 5 : 0); d < counters.length; d++) counters[d] = 0;
      if (r.level === 0) number = roman(counters[0]);
      else {
        const top = hasChapters ? 1 : 2;
        if (r.level < top) number = String(counters[r.level]);
        else {
          const parts: string[] = [];
          for (let d = top; d <= r.level; d++) parts.push(d === top && appendix ? letter(counters[d]) : String(counters[d]));
          number = parts.join(".");
        }
      }
    }
    entries.push({ level: r.level, label: r.label, path: r.path, line: r.line, number: shown ? number : "", via: r.via });
  }
  return entries;
}

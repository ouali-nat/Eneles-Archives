import type { ClickedWord, SourceJump } from "@/lib/synctex";

/**
 * A double-click in a PDF's reference list. TeX typesets that list from a generated file, so the place SyncTeX reports is only where the list was asked for: `\bibliography{…}`, `\printbibliography`, or the end of the document. The entry itself lives in a .bib file, which TeX never typeset, so it is found by its words instead: the clicked word and the words around it on that line of the PDF are looked for in every .bib file, and the entry that holds the most of them is the one. The jump lands on the line of that entry that has the clicked word (the author's name, a word of the title), or on the entry's first line.
 */

const CALL_SITE = /\\(bibliography|printbibliography|addbibresource|end\{document\}|begin\{thebibliography\})/;

/** Text reduced to what a PDF and a .bib entry have in common: lower-case letters and digits, with braces, TeX accents, and commands dropped. */
function plain(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\\[a-zA-Z]+\s*|\\./g, "")
    .replace(/[{}~"]/g, "")
    .toLowerCase();
}

const wordsOf = (text: string): string[] => plain(text).match(/[a-z0-9]{3,}/g) ?? [];

/** Whether a jump landed where the reference list is called from, rather than on text of the document. */
export function isBibliographyCallSite(lineText: string | undefined): boolean {
  return !!lineText && CALL_SITE.test(lineText);
}

/**
 * The place in a .bib file that a clicked reference came from, or null when no entry matches.
 * `bibFiles` maps each .bib path to its text.
 */
export function findBibEntry(bibFiles: Record<string, string>, clicked: ClickedWord | null, lineText: string): SourceJump | null {
  const target = clicked ? (wordsOf(clicked.word)[0] ?? "") : "";
  const context = new Set([...(clicked ? [clicked.word, ...clicked.before, ...clicked.after] : []), lineText].flatMap(wordsOf));
  if (!context.size) return null;

  const candidates: { path: string; start: number; lines: string[]; score: number }[] = [];
  for (const [path, text] of Object.entries(bibFiles)) {
    const lines = text.split("\n");
    const starts = lines.flatMap((line, i) => (/^\s*@(?!comment|string|preamble)\w+\s*[{(]/i.test(line) ? [i] : []));
    starts.forEach((start, n) => {
      const entry = lines.slice(start, starts[n + 1] ?? lines.length);
      const have = new Set(wordsOf(entry.join(" ")));
      let score = 0;
      for (const word of context) if (have.has(word)) score += word === target ? 3 : 1;
      candidates.push({ path, start, lines: entry, score });
    });
  }
  // One shared word is a coincidence (a year, "and"); an entry is the answer only when the clicked word is in it or several words agree. Among equals, the first in the file.
  const found = candidates.reduce<(typeof candidates)[number] | null>((top, c) => (c.score > (top?.score ?? 0) ? c : top), null);
  if (!found || found.score < 3) return null;

  const offset = target ? found.lines.findIndex((line) => wordsOf(line).includes(target)) : -1;
  const line = found.start + Math.max(offset, 0);
  const raw = found.lines[Math.max(offset, 0)] ?? "";
  // The clicked word as it is written in the source, when it is written the same way (no accent commands in it).
  const at = clicked && offset >= 0 ? raw.toLowerCase().indexOf(clicked.word.toLowerCase()) : -1;
  return { path: found.path, line: line + 1, column: Math.max(at, 0), length: at >= 0 && clicked ? clicked.word.length : 0, word: at >= 0 && clicked ? clicked.word : "", exact: true };
}

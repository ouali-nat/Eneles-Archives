/**
 * Shared utilities for TikZ compilation and rendering.
 */

export function constructLatex(source: string): string {
  if (source.includes("\\documentclass")) {
    return source.trim();
  }

  const lines = source.split("\n");
  const preamble: string[] = [];
  const body: string[] = [];

  // Not standalone's tikz option: it makes every tikzpicture its own page,
  // which breaks packages that wrap tikzpicture in their own environments
  // (zx-calculus, tensormatrix, chronology). TikZ is loaded as a package.
  preamble.push("\\documentclass[margin=3mm]{standalone}");
  if (!/\\usepackage(\[.*\])?\{tikz\}/.test(source)) {
    preamble.push("\\usepackage{tikz}");
  }

  if (!source.match(/\\usepackage(\[.*\])?\{xcolor\}/)) {
    preamble.push("\\usepackage{xcolor}");
  }

  preamble.push("\\usepackage{amsmath}");
  preamble.push("\\usepackage{amssymb}");

  const preambleRegex = /^\\(usepackage|usetikzlibrary|usepgfplotslibrary|pgfplotsset|tikzset|ctikzset)/;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.match(preambleRegex)) {
      preamble.push(trimmed);
    } else {
      body.push(line);
    }
  });

  return `${preamble.join("\n")}\n\n\\begin{document}\n${body.join("\n")}\n\\end{document}`;
}



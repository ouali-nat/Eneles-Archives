/**
 * Putting a library example into someone's document: the figure goes where the cursor is, and the packages and TikZ libraries it needs go into the main document's preamble, once each.
 */

/** Lines of an example's source that belong in the preamble rather than in the figure. The preview wrapper (`constructLatex`) moves the same lines. */
export const PREAMBLE_LINE = /^\\(usepackage|usetikzlibrary|usepgfplotslibrary|pgfplotsset|tikzset|ctikzset)\b/

/** Packages that load TikZ themselves, so a document using one of them does not need `\usepackage{tikz}` as well. */
const LOADS_TIKZ = new Set(["tikz", "pgfplots", "circuitikz", "tikz-cd", "quantikz", "forest", "tikz-feynman", "pgfgantt", "venndiagram", "chronology", "zx-calculus", "optikz", "tikzorbital", "neuralnetwork", "smartdiagram", "tensormatrix", "polyhedra", "dynkin-diagrams", "tkz-euclide"])

export function splitTikzSource(source: string): { preamble: string[]; body: string } {
  const preamble: string[] = []
  const body: string[] = []
  for (const line of source.split("\n")) {
    if (PREAMBLE_LINE.test(line.trim())) preamble.push(line.trim())
    else body.push(line)
  }
  return { preamble, body: body.join("\n").trim() }
}

function list(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean)
}

interface Preamble {
  packages: Set<string>
  tikzLibraries: Set<string>
  pgfplotsLibraries: Set<string>
  hasCompat: boolean
  lines: Set<string>
}

/** What a preamble (or a package file it reads) already loads. Comments are ignored. */
function scan(texts: string[]): Preamble {
  const found: Preamble = { packages: new Set(), tikzLibraries: new Set(), pgfplotsLibraries: new Set(), hasCompat: false, lines: new Set() }
  for (const text of texts) {
    const clean = text.replace(/(^|[^\\])%.*$/gm, "$1")
    for (const m of clean.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)) list(m[1]).forEach((p) => found.packages.add(p))
    for (const m of clean.matchAll(/\\usetikzlibrary\s*\{([^}]*)\}/g)) list(m[1]).forEach((l) => found.tikzLibraries.add(l))
    for (const m of clean.matchAll(/\\usepgfplotslibrary\s*\{([^}]*)\}/g)) list(m[1]).forEach((l) => found.pgfplotsLibraries.add(l))
    if (/\\pgfplotsset\s*\{[^}]*compat\s*=/.test(clean)) found.hasCompat = true
    for (const line of clean.split("\n")) found.lines.add(line.trim())
  }
  return found
}

/** The preamble of a document: everything before `\begin{document}`, or all of it when it has none (a package or a file of definitions). */
export function preambleOf(doc: string): string {
  const at = doc.search(/\\begin\s*\{document\}/)
  return at === -1 ? doc : doc.slice(0, at)
}

/**
 * The preamble lines an example needs that `existing` (the main document's preamble and anything it reads) does not have yet, in an order that works: packages, then TikZ and pgfplots libraries, then settings.
 */
export function missingPreamble(source: string, existing: string[]): string[] {
  const have = scan(existing)
  const { preamble, body } = splitTikzSource(source)
  const packages: string[] = []
  const settings: string[] = []
  const tikzLibraries: string[] = []
  const pgfplotsLibraries: string[] = []
  const loads = (pkg: string) => have.packages.has(pkg) || packages.some((line) => line.includes(`{${pkg}}`))

  for (const line of preamble) {
    const pkg = /^\\usepackage\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(line)
    if (pkg) {
      const wanted = list(pkg[1]).filter((p) => !have.packages.has(p))
      if (wanted.length === list(pkg[1]).length) packages.push(line)
      else if (wanted.length) packages.push(`\\usepackage{${wanted.join(",")}}`)
      continue
    }
    const tikzLib = /^\\usetikzlibrary\s*\{([^}]*)\}/.exec(line)
    if (tikzLib) {
      for (const lib of list(tikzLib[1])) if (!have.tikzLibraries.has(lib) && !tikzLibraries.includes(lib)) tikzLibraries.push(lib)
      continue
    }
    const plotLib = /^\\usepgfplotslibrary\s*\{([^}]*)\}/.exec(line)
    if (plotLib) {
      for (const lib of list(plotLib[1])) if (!have.pgfplotsLibraries.has(lib) && !pgfplotsLibraries.includes(lib)) pgfplotsLibraries.push(lib)
      continue
    }
    if (/^\\pgfplotsset\s*\{\s*compat\s*=/.test(line)) {
      if (!have.hasCompat) settings.push(line)
      continue
    }
    if (!have.lines.has(line)) settings.push(line)
  }

  // The preview wrapper loads TikZ for every example, so an example that draws with it may not say so.
  const usesTikz = /\\begin\{tikzpicture\}|\\tikz\b|\\usetikzlibrary/.test(source) || tikzLibraries.length > 0
  const tikzLoaded = [...LOADS_TIKZ].some((pkg) => loads(pkg))
  if (usesTikz && !tikzLoaded) packages.unshift("\\usepackage{tikz}")
  // The same wrapper loads amsmath; text inside math is the one thing from it the examples use.
  if (/\\text\{|\\operatorname|\\dfrac|\\tfrac/.test(body) && !loads("amsmath")) packages.push("\\usepackage{amsmath}")
  if (/\\(mathbb|mathfrak|varnothing|leqslant|geqslant|checkmark|lrcorner|ulcorner|urcorner|llcorner|square|blacksquare|twoheadrightarrow|rightarrowtail|therefore)\b/.test(body) && !loads("amssymb")) packages.push("\\usepackage{amssymb}")

  return [
    ...packages,
    ...(tikzLibraries.length ? [`\\usetikzlibrary{${tikzLibraries.join(", ")}}`] : []),
    ...(pgfplotsLibraries.length ? [`\\usepgfplotslibrary{${pgfplotsLibraries.join(", ")}}`] : []),
    ...settings,
  ]
}

/**
 * The document with `lines` added to its preamble, after the last line that loads a package or a library (so they come after TikZ itself), or just before `\begin{document}` when there is none. Null when the document has no `\begin{document}`.
 */
export function addToPreamble(doc: string, lines: string[]): string | null {
  if (!lines.length) return doc
  const begin = doc.search(/\\begin\s*\{document\}/)
  if (begin === -1) return null
  const head = doc.slice(0, begin)
  let at = -1
  for (const m of head.matchAll(/^[ \t]*\\(?:usepackage|RequirePackage|usetikzlibrary|usepgfplotslibrary|pgfplotsset|tdplotset|tikzset|ctikzset)\b.*$/gm)) {
    // A directive that spans several lines (\usepackage{a,\n b}) ends at its closing brace.
    let end = (m.index ?? 0) + m[0].length
    let depth = 0
    for (let i = m.index ?? 0; i < head.length; i++) {
      if (head[i] === "{") depth++
      else if (head[i] === "}" && --depth === 0) {
        end = Math.max(end, head.indexOf("\n", i) === -1 ? head.length : head.indexOf("\n", i))
        break
      }
    }
    at = Math.max(at, end)
  }
  const block = lines.join("\n")
  if (at === -1) {
    const before = head.endsWith("\n") || head === "" ? "" : "\n"
    return `${head}${before}${block}\n${doc.slice(begin)}`
  }
  return `${doc.slice(0, at)}\n${block}${doc.slice(at)}`
}

/**
 * Files a main document reads its preamble from: `\input`/`\include` in its preamble, by path relative to the project root, with `.tex` added when it has no extension.
 */
export function preambleInputs(mainDoc: string): string[] {
  const head = preambleOf(mainDoc).replace(/(^|[^\\])%.*$/gm, "$1")
  return [...head.matchAll(/\\(?:input|include)\s*\{([^}]+)\}/g)].map((m) => {
    const path = m[1].trim().replace(/^\.\//, "")
    return /\.\w+$/.test(path) ? path : `${path}.tex`
  })
}

/**
 * What adding an example to a project changes in the main document's preamble: the lines it needs that neither the main document, the files its preamble inputs, nor the project's own package files (.sty) load yet, and the main document with them added (null when it has no `\begin{document}` to put them before).
 */
export function planPreamble(source: string, main: string, files: { path: string; content: string }[]): { lines: string[]; next: string | null } {
  const byPath = new Map(files.map((f) => [f.path.replace(/^\.\//, ""), f.content]))
  const existing = [
    preambleOf(main),
    ...preambleInputs(main).map((path) => byPath.get(path) ?? ""),
    ...files.filter((f) => f.path.endsWith(".sty")).map((f) => f.content),
  ]
  const lines = missingPreamble(source, existing)
  return { lines, next: lines.length ? addToPreamble(main, lines) : main }
}

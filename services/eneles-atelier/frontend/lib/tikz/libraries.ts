import { reindentLatex } from "@/lib/latex/format"
import manifest from "@/content/library.json"
import type { TikzExample, TikzLibrary } from "./types"

export type { TikzExample, TikzLibrary } from "./types"

/**
 * The TikZ library. Its content lives in the `library` repository (packages, examples as .tex files, and nav.json for the order), which scripts/sync-content.mjs copies into content/library.json; this module only reads it. `node scripts/check.mjs` in that repository compiles every example.
 */
interface LibraryManifest {
  categories: { title: string; packages: (Omit<TikzLibrary, "exampleCount">)[] }[]
}
const data = manifest as unknown as LibraryManifest

/** "All", then the categories in the library's own order. */
export const tikzCategories: readonly string[] = ["All", ...data.categories.map((c) => c.title)]

const rawTikzLibraries = data.categories.flatMap((c) => c.packages)

/**
 * Public view of the library data with indentation normalised by nesting
 * depth. Normalising here rather than at each call site means the browser, the
 * insert palette and anything written into a project all receive identically
 * formatted source.
 */
export const tikzLibraries: TikzLibrary[] = rawTikzLibraries.map((lib) => ({
  ...lib,
  exampleCount: lib.examples.length,
  examples: lib.examples.map((example) => ({
    ...example,
    source: reindentLatex(example.source),
  })),
}))

/** A package's name (tikz-cd) is set in monospace, as code; a family of our own (Flowcharts) is not. */
export function isPackageName(lib: Pick<TikzLibrary, "custom">): boolean {
  return !lib.custom
}

export function getLibraryById(id: string): TikzLibrary | undefined {
  return tikzLibraries.find((lib) => lib.id === id)
}

export function getExampleById(libraryId: string, exampleId: string): TikzExample | undefined {
  const lib = getLibraryById(libraryId)
  return lib?.examples.find((ex) => ex.id === exampleId)
}

export function searchLibraries(query: string): TikzLibrary[] {
  const q = query.toLowerCase()
  return tikzLibraries.filter(
    (lib) =>
      lib.name.toLowerCase().includes(q) ||
      lib.description.toLowerCase().includes(q) ||
      lib.tags.some((tag) => tag.toLowerCase().includes(q)) ||
      lib.category.toLowerCase().includes(q)
  )
}

/** Format for the bucket prebuild script (backend/scripts/prebuild-tikz-components.mjs) */
export function getTikzExamplesForPrebuild() {
  return tikzLibraries.map((lib) => ({
    id: lib.id,
    name: lib.name,
    examples: lib.examples.map((ex) => ({
      id: ex.id,
      name: ex.name,
      source: ex.source,
    })),
  }))
}

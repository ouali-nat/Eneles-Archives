export interface TikzExample {
  id: string
  name: string
  description: string
  /** Preamble lines (`\usepackage`, `\usetikzlibrary`, `\pgfplotsset`) first, then the figure. */
  source: string
  tags: string[]
  /** The engine when it is not pdfLaTeX. */
  engine?: string
  /** The prebuilt preview image (public/tikz-previews), when the library has a current one. */
  preview?: string
  /** The same image for the dark theme: the figure on a transparent ground, its colors kept and its black ink made light (scripts/dark-preview.mjs). */
  previewDark?: string
}

export interface TikzLibrary {
  id: string
  name: string
  description: string
  category: string
  ctanUrl: string
  exampleCount: number
  tags: string[]
  /** A family of plain TikZ figures of our own (Flowcharts), not a package on CTAN: its name is not set as a package name. */
  custom?: boolean
  /** The engine when it is not pdfLaTeX. */
  engine?: string
  examples: TikzExample[]
}

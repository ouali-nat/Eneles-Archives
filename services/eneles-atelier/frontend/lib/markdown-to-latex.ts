/**
 * Markdown → LaTeX converter
 *
 * Walks the MDAST tree produced by remark-parse / remark-math / remark-gfm
 * and emits LaTeX. Handles headings, paragraphs, lists, tables, bold/italic,
 * links, images, code blocks, math (display + inline), and horizontal rules.
 *
 * Extracted PDF images are injected as \includegraphics inside \figure
 * environments at page-break boundaries.
 */

import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkMath from "remark-math"
import remarkGfm from "remark-gfm"

export interface ImageRef {
  src: string
  page?: number
  caption?: string
}

interface ConvertOptions {
  wrapDocument?: boolean
  title?: string
  packages?: string[]
  images?: ImageRef[]
}

// ---------------------------------------------------------------------------
// MDAST → LaTeX
// ---------------------------------------------------------------------------

function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
}

function nodeToLatex(node: any): string {
  switch (node.type) {
    case "root":
      return (node.children || []).map(nodeToLatex).join("\n\n")

    case "heading": {
      const depth = node.depth || 1
      const levels = ["section", "subsection", "subsubsection", "paragraph", "subparagraph"]
      const cmd = levels[Math.min(depth - 1, levels.length - 1)]
      const inner = (node.children || []).map(nodeToLatex).join("")
      return `\\${cmd}{${inner}}`
    }

    case "paragraph":
      return (node.children || []).map(nodeToLatex).join("")

    case "text":
      return escapeLatex(node.value || "")

    case "emphasis": {
      const inner = (node.children || []).map(nodeToLatex).join("")
      return `\\emph{${inner}}`
    }

    case "strong": {
      const inner = (node.children || []).map(nodeToLatex).join("")
      return `\\textbf{${inner}}`
    }

    case "delete": {
      const inner = (node.children || []).map(nodeToLatex).join("")
      return `\\sout{${inner}}`
    }

    case "inlineCode":
      return `\\texttt{${escapeLatex(node.value || "")}}`

    case "code": {
      const code = node.value || ""
      return `\\begin{verbatim}\n${code}\n\\end{verbatim}`
    }

    case "blockquote": {
      const inner = (node.children || []).map(nodeToLatex).join("\n")
      return `\\begin{quote}\n${inner}\n\\end{quote}`
    }

    case "link": {
      const inner = (node.children || []).map(nodeToLatex).join("")
      const url = node.url || ""
      return `\\href{${url}}{${inner}}`
    }

    case "image": {
      const alt = node.alt || ""
      const url = node.url || ""
      return [
        "\\begin{figure}[htbp]",
        "  \\centering",
        `  \\includegraphics[max width=\\textwidth]{${url}}`,
        alt ? `  \\caption{${escapeLatex(alt)}}` : "",
        "\\end{figure}",
      ].filter(Boolean).join("\n")
    }

    case "list": {
      const env = node.ordered ? "enumerate" : "itemize"
      const items = (node.children || []).map(nodeToLatex).join("\n")
      return `\\begin{${env}}\n${items}\n\\end{${env}}`
    }

    case "listItem": {
      const inner = (node.children || [])
        .map(nodeToLatex)
        .join("\n")
        .replace(/^\n+|\n+$/g, "")
      return `  \\item ${inner}`
    }

    case "table": {
      const rows: any[] = node.children || []
      if (rows.length === 0) return ""
      const numCols = (rows[0].children || []).length
      const colSpec = "l".repeat(numCols).split("").join(" ")
      const headerCells = (rows[0].children || [])
        .map((cell: any) => (cell.children || []).map(nodeToLatex).join(""))
      const header = headerCells.join(" & ") + " \\\\"
      const bodyRows = rows.slice(1).map((row: any) => {
        const cells = (row.children || [])
          .map((cell: any) => (cell.children || []).map(nodeToLatex).join(""))
        return cells.join(" & ") + " \\\\"
      })
      return [
        `\\begin{tabular}{${colSpec}}`,
        "\\hline",
        header,
        "\\hline",
        ...bodyRows,
        "\\hline",
        "\\end{tabular}",
      ].join("\n")
    }

    case "tableRow":
    case "tableCell":
      return (node.children || []).map(nodeToLatex).join("")

    case "thematicBreak":
      return "\\bigskip\\hrule\\bigskip"

    case "break":
      return "\\\\"

    case "math":
      return `\\[\n${node.value || ""}\n\\]`

    case "inlineMath":
      return `$${node.value || ""}$`

    case "html":
      return `% HTML: ${(node.value || "").replace(/\n/g, " ")}`

    case "footnoteReference":
      return `\\footnotemark[${node.identifier || ""}]`

    case "footnoteDefinition": {
      const inner = (node.children || []).map(nodeToLatex).join("")
      return `\\footnotetext[${node.identifier || ""}]{${inner}}`
    }

    default:
      if (node.children) {
        return (node.children as any[]).map(nodeToLatex).join("")
      }
      if (node.value) return escapeLatex(node.value)
      return ""
  }
}

// ---------------------------------------------------------------------------
// Image insertion
// ---------------------------------------------------------------------------

function figureBlock(img: ImageRef, index: number): string {
  const caption = img.caption || `Figure ${index + 1}`
  return [
    "",
    "\\begin{figure}[htbp]",
    "  \\centering",
    `  \\includegraphics[max width=\\textwidth]{${img.src}}`,
    `  \\caption{${caption}}`,
    "\\end{figure}",
    "",
  ].join("\n")
}

function insertImages(body: string, images: ImageRef[]): string {
  if (!images.length) return body

  const pagePattern = /^(%\s*Page\s+(\d+).*|\\bigskip\\hrule\\bigskip)$/gm
  const hasPageMarkers = pagePattern.test(body)
  pagePattern.lastIndex = 0

  if (hasPageMarkers) {
    const sections: { text: string; pageNum?: number }[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pagePattern.exec(body)) !== null) {
      sections.push({ text: body.slice(lastIndex, match.index) })
      const pageNum = match[2] ? parseInt(match[2], 10) : undefined
      sections.push({ text: match[0], pageNum })
      lastIndex = match.index + match[0].length
    }
    sections.push({ text: body.slice(lastIndex) })

    const used = new Set<number>()
    let result = ""
    for (const section of sections) {
      result += section.text
      if (section.pageNum !== undefined) {
        images.forEach((img, idx) => {
          if (!used.has(idx) && img.page === section.pageNum) {
            result += figureBlock(img, idx)
            used.add(idx)
          }
        })
      }
    }
    images.forEach((img, idx) => {
      if (!used.has(idx)) result += figureBlock(img, idx)
    })
    return result
  }

  const headingPattern = /^(\\(?:sub)*section\{[^}]*\})$/gm
  const headingPositions: { index: number; end: number }[] = []
  let hMatch: RegExpExecArray | null
  while ((hMatch = headingPattern.exec(body)) !== null) {
    headingPositions.push({ index: hMatch.index, end: hMatch.index + hMatch[0].length })
  }

  if (headingPositions.length > 0) {
    const maxPage = Math.max(...images.map((i) => i.page ?? 1))
    const insertions = new Map<number, string[]>()
    images.forEach((img, idx) => {
      const page = img.page ?? 1
      const headingIdx = Math.min(
        Math.round(((page - 1) / Math.max(maxPage, 1)) * headingPositions.length),
        headingPositions.length - 1,
      )
      if (!insertions.has(headingIdx)) insertions.set(headingIdx, [])
      insertions.get(headingIdx)!.push(figureBlock(img, idx))
    })

    let result = ""
    let lastEnd = 0
    headingPositions.forEach((pos, i) => {
      result += body.slice(lastEnd, pos.end)
      lastEnd = pos.end
      if (insertions.has(i)) result += insertions.get(i)!.join("")
    })
    result += body.slice(lastEnd)
    return result
  }

  return body + "\n" + images.map((img, i) => figureBlock(img, i)).join("\n")
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function markdownToLatex(md: string, options: ConvertOptions = {}): string {
  const { wrapDocument = true, title, packages = [], images = [] } = options

  const tree = unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkGfm)
    .parse(md)

  let body = nodeToLatex(tree).replace(/\n{3,}/g, "\n\n").trim()

  if (images.length > 0) {
    body = insertImages(body, images)
  }

  if (!wrapDocument) return body

  const defaultPackages = [
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage{amsmath,amssymb,amsfonts}",
    "\\usepackage{graphicx}",
    "\\usepackage[export]{adjustbox}",
    "\\usepackage{hyperref}",
    "\\usepackage[normalem]{ulem}",
    "\\usepackage{geometry}",
    "\\geometry{margin=1in}",
  ]

  const allPackages = [
    ...defaultPackages,
    ...packages.map((p) => (p.startsWith("\\") ? p : `\\usepackage{${p}}`)),
  ]

  const lines = [
    "\\documentclass{article}",
    ...allPackages,
    "",
    title ? `\\title{${title}}` : null,
    title ? "\\date{}" : null,
    "",
    "\\begin{document}",
    title ? "\\maketitle" : null,
    "",
    body,
    "",
    "\\end{document}",
  ].filter((l): l is string => l !== null)

  return lines.join("\n") + "\n"
}

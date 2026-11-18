/**
 * LaTeX templates for project creation and template discovery.
 * Used by the /library browser and the New Project dialog.
 */

import { reindentLatex } from "@/lib/latex/format"

export interface LaTeXTemplate {
  id: string
  name: string
  description: string
  category: string
  content: string
  mainFile?: string
}

export const LATEX_TEMPLATE_CATEGORIES = [
  "Notes",
  "Paper",
  "Beamer",
  "Book",
  "Homework",
  "Resume",
  "Letter",
  "Other",
] as const

const LOREM = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`

const SCIFI = `The quantum lattice shimmered as the neural interface synced with the void-core. Across the nebula, distant signals pulsed in patterns that defied Euclidean geometry. The ship's AI, call-sign Aurora, had been decoding them for cycles---perhaps messages, perhaps noise from the birth of stars. In the observation deck, Dr. Chen watched the probability clouds collapse into certainty: the coordinates were real.`

const rawTemplates: LaTeXTemplate[] = [
  {
    id: "notes-lecture",
    name: "Lecture notes",
    description: "Structured notes for courses with sections and subsections",
    category: "Notes",
    content: `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath}

\\title{Lecture Notes: Introduction}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle
\\tableofcontents
\\newpage

\\section{Overview}

${LOREM} Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

\\subsection{Key Concepts}

${LOREM} Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.

\\subsection{Historical Context}

${LOREM} Totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.

\\newpage

\\section{Main Results}

${LOREM} Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.

\\subsection{Proof Sketch}

Consider the following equation:
\\[
  \\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
\\]

${LOREM}

\\newpage

\\section{Applications}

${LOREM} At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti.

\\subsection{Example}

${LOREM} Quos dolores et quas molestias excepturi sint occaecati cupi non provident.

\\section{Summary}

${LOREM} Similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga.

\\end{document}
`,
    mainFile: "main.tex",
  },
  {
    id: "paper-academic",
    name: "Academic paper",
    description: "Conference or journal paper with abstract and sections",
    category: "Paper",
    content: `\\documentclass[11pt,twocolumn]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=0.75in]{geometry}
\\usepackage{amsmath}

\\title{Neural Synthesis of Quantum Lattice Patterns}
\\author{Anonymous Author(s)}
\\date{\\today}

\\begin{document}

\\twocolumn[
\\maketitle
\\begin{abstract}
\\noindent ${SCIFI} We present a novel approach to decoding cross-dimensional signals using recursively entangled networks. Our method achieves state-of-the-art on the VoidCore benchmark.
\\end{abstract}
\\vspace{2em}
]

\\section{Introduction}
\\label{sec:intro}

${SCIFI} The implications for interstellar communication are profound---if the patterns prove intentional, we may not be alone in our curiosity.

${LOREM}

\\section{Related Work}

${LOREM} Previous approaches have focused on classical signal processing. Our work extends prior methods to the quantum regime.

\\section{Methodology}

${SCIFI} The core innovation lies in the hybrid architecture: a transformer encoder processes temporal sequences while a graph network captures the spatial lattice structure.

\\subsection{Architecture}

${LOREM}

\\subsection{Training}

${LOREM}

\\section{Experiments}

We evaluate on three benchmarks with strong results across all metrics.

${LOREM}

\\section{Conclusion}

${SCIFI} The signals continue. We have only begun to listen.

${LOREM}

\\end{document}
`,
    mainFile: "main.tex",
  },
  {
    id: "beamer-slides",
    name: "Beamer presentation",
    description: "Slide deck with title, outline, and content frames",
    category: "Beamer",
    content: `\\documentclass{beamer}
\\usetheme{default}

\\title{Project Aurora}
\\author{Research Team}
\\date{\\today}

\\begin{document}

\\frame{\\titlepage}

\\begin{frame}
\\frametitle{Outline}
\\tableofcontents
\\end{frame}

\\section{Introduction}

\\begin{frame}
\\frametitle{The Problem}

${SCIFI}

The question: Are we decoding messages, or imposing meaning on chaos?
\\end{frame}

\\begin{frame}
\\frametitle{Our Approach}

We combine:
\\begin{itemize}
\\item Quantum lattice analysis
\\item Neural signal decoding
\\item Cross-dimensional correlation
\\end{itemize}

${LOREM}
\\end{frame}

\\section{Methodology}

\\begin{frame}
\\frametitle{Architecture Overview}

${LOREM}

Key insight: The void-core behaves like a recurrent encoder.
\\end{frame}

\\begin{frame}
\\frametitle{Training Pipeline}

${LOREM}

Three phases: pretrain, fine-tune, decode.
\\end{frame}

\\section{Results}

\\begin{frame}
\\frametitle{Benchmark Performance}

${LOREM}

We achieve 94\\% accuracy on VoidCore-2.
\\end{frame}

\\begin{frame}
\\frametitle{Case Study}

${SCIFI}

The Nebula Seven signal remains our strongest candidate.
\\end{frame}

\\section{Conclusion}

\\begin{frame}
\\frametitle{Summary}

\\begin{enumerate}
\\item Cross-dimensional signals are decodable
\\item Hybrid architectures outperform single-modality
\\item More data needed---the universe is vast
\\end{enumerate}
\\end{frame}

\\begin{frame}
\\frametitle{Thank you}

Questions?
\\end{frame}

\\end{document}
`,
    mainFile: "main.tex",
  },
  {
    id: "book-chapter",
    name: "Book / long-form",
    description: "Book structure with chapters and front matter",
    category: "Book",
    content: `\\documentclass[11pt]{book}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=1in]{geometry}

\\title{Across the Nebula}
\\author{Science Fiction Press}
\\date{\\today}

\\begin{document}

\\frontmatter
\\maketitle
\\tableofcontents

\\mainmatter
\\chapter{The Signal}

${SCIFI}

${LOREM}

\\chapter{The Decoding}

${LOREM} The team gathered in the observation deck as the first coherent sequence emerged. It was not language---not as we knew it---but structure. Mathematics. A proof, perhaps, or a map.

${LOREM}

\\newpage

\\chapter{The Reply}

${SCIFI} We transmitted our own proof. The Riemann hypothesis, rendered in quantum states. A handshake across light-years.

${LOREM}

\\chapter{Epilogue}

${LOREM} The signals continue. We listen. We learn. We reach.

\\end{document}
`,
    mainFile: "main.tex",
  },
  {
    id: "homework-problems",
    name: "Homework / problem set",
    description: "Problem set with numbered exercises",
    category: "Homework",
    content: `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath,amssymb}

\\title{Problem Set 3}
\\author{Course Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\textbf{Collaboration policy:} You may discuss with classmates but must write solutions independently.

\\section*{Problems}

\\begin{enumerate}

\\item \\textbf{Warm-up.} ${LOREM}

\\item \\textbf{Quantum lattice.} The quantum lattice shimmered as the neural interface synced. Prove that the eigenvalue spectrum of the void-core operator is discrete.

\\item \\textbf{Signal decoding.} Suppose we receive a sequence $x_1, x_2, \\ldots$ from the nebula. Under what conditions can we recover a unique source? Provide a proof or counterexample.

\\newpage

\\item \\textbf{Euclidean defiance.} The distant signals pulsed in patterns that defied Euclidean geometry. Formalize \`\`Euclidean defiance\`\` and give an example of a space that satisfies your definition.

\\item \\textbf{Probability collapse.} Dr. Chen watched the probability clouds collapse. Model this as a stochastic process and compute the expected time to certainty.

\\item \\textbf{Open-ended.} The coordinates were real. What do we do next? Write a short proposal (max 1 page).

\\end{enumerate}

\\vspace{1em}
\\hrule
\\vspace{0.5em}
\\textbf{Submission:} Upload to the course website by Friday 11:59pm.

\\end{document}
`,
    mainFile: "main.tex",
  },
  {
    id: "resume-professional",
    name: "Resume / CV",
    description: "Professional resume with education and experience",
    category: "Resume",
    content: `\\documentclass[11pt]{article}
\\usepackage[margin=0.75in]{geometry}

\\begin{document}

\\begin{center}
{\\Large \\textbf{Your Name}} \\\\
Email | Phone | Location
\\end{center}
\\vspace{0.5em}

\\section*{Education}

\\textbf{University Name} \\hfill Year \\
Degree, Major \\\\
${LOREM}

\\textbf{Previous Institution} \\hfill Year \\
Degree \\\\
${LOREM}

\\section*{Experience}

\\textbf{Company / Lab} \\hfill Dates \\
Role \\\\
${LOREM}

\\textbf{Another Role} \\hfill Dates \\
${LOREM}

\\newpage

\\section*{Publications}

\\begin{enumerate}
\\item Author names. \`\`Title of paper.\'\' \\textit{Journal}, vol, pages, year.
\\item Author names. \`\`Another paper.\'\' \\textit{Conference}, year.
\\end{enumerate}

\\section*{Skills}

${LOREM}

\\section*{Awards}

${LOREM}

\\end{document}
`,
    mainFile: "main.tex",
  },
  {
    id: "letter-formal",
    name: "Formal letter",
    description: "Business or formal correspondence",
    category: "Letter",
    content: `\\documentclass[11pt]{letter}

\\signature{Your Name}
\\address{Your Street Address\\\\Your City, State ZIP\\\\Your Email}

\\begin{document}

\\begin{letter}{Recipient Name\\\\Recipient Title\\\\Company or Institution\\\\Address\\\\City, State ZIP}

\\opening{Dear Dr. Recipient,}

I am writing to inquire about the research position in quantum signal processing that was advertised in the September bulletin.

${LOREM}

${SCIFI} I believe my background in neural decoding and cross-dimensional analysis would be a strong fit for your team's work on the VoidCore project.

${LOREM}

I have enclosed my curriculum vitae and would welcome the opportunity to discuss this further at your convenience. Thank you for considering my application.

\\closing{Sincerely,}

\\end{letter}
\\end{document}
`,
    mainFile: "main.tex",
  },
  {
    id: "other-minimal",
    name: "Minimal document",
    description: "Generic multipage document for any purpose",
    category: "Other",
    content: `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=1in]{geometry}

\\title{Document Title}
\\author{Author}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{First Section}

${LOREM}

${SCIFI}

\\section{Second Section}

${LOREM}

\\subsection{Subsection}

${LOREM}

\\newpage

\\section{Third Section}

${LOREM}

\\subsection{Another Subsection}

${SCIFI}

${LOREM}

\\section{Conclusion}

${LOREM}

\\end{document}
`,
    mainFile: "main.tex",
  },
]

/**
 * Templates with indentation normalised by nesting depth.
 *
 * Normalising here rather than at each call site means the browser, the New
 * Project dialog, the ZIP export and the files written into a new project all
 * receive identically formatted source. `document` is listed as flat because
 * indenting an entire template body one level is consistent but not how anyone
 * writes LaTeX.
 */
export const LATEX_TEMPLATES: LaTeXTemplate[] = rawTemplates.map((template) => ({
  ...template,
  content: reindentLatex(template.content, { flatEnvironments: ["document"] }),
}))

export function getTemplateById(id: string): LaTeXTemplate | undefined {
  return LATEX_TEMPLATES.find((t) => t.id === id)
}

export function getTemplatesByCategory(category: string): LaTeXTemplate[] {
  if (category === "All") return LATEX_TEMPLATES
  return LATEX_TEMPLATES.filter((t) => t.category === category)
}

export function searchTemplates(query: string): LaTeXTemplate[] {
  const q = query.toLowerCase()
  return LATEX_TEMPLATES.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
  )
}

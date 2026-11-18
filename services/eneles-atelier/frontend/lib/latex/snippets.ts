/**
 * LaTeX snippet templates for the editor.
 */

export interface LatexSnippet {
  label: string;
  category: string;
  template: string;
  description?: string;
}

export const LATEX_SNIPPETS: LatexSnippet[] = [
  // Document structure
  {
    label: "Article",
    category: "Document",
    description: "Basic article template",
    template: `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath, amssymb, amsthm}
\\usepackage{geometry}
\\geometry{margin=1in}

\\title{Untitled Document}
\\author{Author Name}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}



\\end{document}`,
  },
  {
    label: "Beamer",
    category: "Document",
    description: "Presentation slides",
    template: `\\documentclass{beamer}
\\usetheme{Madrid}
\\usepackage[utf8]{inputenc}

\\title{Presentation Title}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\begin{frame}
\\titlepage
\\end{frame}

\\begin{frame}{Outline}
\\tableofcontents
\\end{frame}

\\section{Introduction}
\\begin{frame}{Introduction}
  Content here.
\\end{frame}

\\end{document}`,
  },
  {
    label: "Report",
    category: "Document",
    description: "Report template with chapters",
    template: `\\documentclass{report}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath, amssymb}
\\usepackage{geometry}
\\geometry{margin=1in}

\\title{Report Title}
\\author{Author Name}
\\date{\\today}

\\begin{document}
\\maketitle
\\tableofcontents

\\chapter{Introduction}



\\end{document}`,
  },
  {
    label: "Homework",
    category: "Document",
    description: "Homework / problem set template",
    template: `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath, amssymb, amsthm}
\\usepackage{geometry}
\\geometry{margin=1in}
\\usepackage{enumitem}

\\newcommand{\\problem}[1]{\\section*{Problem #1}}
\\newcommand{\\solution}{\\subsection*{Solution}}

\\title{Homework \\#1}
\\author{Your Name}
\\date{\\today}

\\begin{document}
\\maketitle

\\problem{1}
Statement of the problem.

\\solution
Your solution here.

\\end{document}`,
  },

  // Math environments
  {
    label: "Equation",
    category: "Math",
    description: "Numbered equation",
    template: `\\begin{equation}
  
\\end{equation}`,
  },
  {
    label: "Align",
    category: "Math",
    description: "Aligned equations",
    template: `\\begin{align}
  a &= b + c \\\\
  d &= e + f
\\end{align}`,
  },
  {
    label: "Matrix",
    category: "Math",
    description: "Matrix with brackets",
    template: `\\begin{bmatrix}
  a & b \\\\
  c & d
\\end{bmatrix}`,
  },
  {
    label: "Cases",
    category: "Math",
    description: "Piecewise function",
    template: `\\begin{cases}
  f(x) & \\text{if } x \\geq 0 \\\\
  g(x) & \\text{if } x < 0
\\end{cases}`,
  },
  {
    label: "Theorem",
    category: "Math",
    description: "Theorem environment",
    template: `\\begin{theorem}
  
\\end{theorem}`,
  },
  {
    label: "Sum",
    category: "Math",
    description: "Summation",
    template: `\\sum_{i=1}^{n} `,
  },
  {
    label: "Integral",
    category: "Math",
    description: "Definite integral",
    template: `\\int_{a}^{b}  \\, dx`,
  },
  {
    label: "Limit",
    category: "Math",
    description: "Limit",
    template: `\\lim_{x \\to \\infty} `,
  },
  {
    label: "Fraction",
    category: "Math",
    description: "Fraction",
    template: `\\frac{}{}`,
  },

  // Structures
  {
    label: "Figure",
    category: "Structure",
    description: "Figure with image",
    template: `\\begin{figure}[htbp]
  \\centering
  \\includegraphics[width=0.8\\textwidth]{image.png}
  \\caption{Caption text}
  \\label{fig:label}
\\end{figure}`,
  },
  {
    label: "Table",
    category: "Structure",
    description: "Basic table",
    template: `\\begin{table}[htbp]
  \\centering
  \\begin{tabular}{|c|c|c|}
    \\hline
    Header 1 & Header 2 & Header 3 \\\\
    \\hline
    Cell 1 & Cell 2 & Cell 3 \\\\
    Cell 4 & Cell 5 & Cell 6 \\\\
    \\hline
  \\end{tabular}
  \\caption{Caption text}
  \\label{tab:label}
\\end{table}`,
  },
  {
    label: "Itemize",
    category: "Structure",
    description: "Bulleted list",
    template: `\\begin{itemize}
  \\item First item
  \\item Second item
  \\item Third item
\\end{itemize}`,
  },
  {
    label: "Enumerate",
    category: "Structure",
    description: "Numbered list",
    template: `\\begin{enumerate}
  \\item First item
  \\item Second item
  \\item Third item
\\end{enumerate}`,
  },
  {
    label: "Code Listing",
    category: "Structure",
    description: "Code listing with lstlisting",
    template: `\\begin{lstlisting}[language=Python, caption=Caption text]

\\end{lstlisting}`,
  },
  {
    label: "Bibliography",
    category: "Structure",
    description: "Bibliography section",
    template: `\\bibliographystyle{plain}
\\bibliography{references}`,
  },

  // TikZ
  {
    label: "TikZ Picture",
    category: "TikZ",
    description: "Empty TikZ picture",
    template: `\\begin{tikzpicture}
  
\\end{tikzpicture}`,
  },
  {
    label: "Graph",
    category: "TikZ",
    description: "Simple directed graph",
    template: `\\usetikzlibrary{positioning}
\\begin{tikzpicture}[->, >=stealth, node distance=2cm, thick]
  \\node[circle, draw] (A) {A};
  \\node[circle, draw] (B) [right=of A] {B};
  \\node[circle, draw] (C) [below right=of A] {C};
  \\draw (A) -- (B);
  \\draw (A) -- (C);
  \\draw (B) -- (C);
\\end{tikzpicture}`,
  },
  {
    label: "DFA / Automaton",
    category: "TikZ",
    description: "Deterministic finite automaton",
    template: `\\usetikzlibrary{automata, positioning}
\\begin{tikzpicture}[->, >=stealth, shorten >=1pt, node distance=2.5cm, on grid, auto]
  \\node[state, initial] (q0) {$q_0$};
  \\node[state] (q1) [right=of q0] {$q_1$};
  \\node[state, accepting] (q2) [right=of q1] {$q_2$};

  \\path[->] (q0) edge node {a} (q1)
        (q1) edge node {b} (q2)
        (q1) edge[loop above] node {a} ()
        (q2) edge[loop above] node {a,b} ();
\\end{tikzpicture}`,
  },
  {
    label: "Binary Tree",
    category: "TikZ",
    description: "Binary tree",
    template: `\\begin{tikzpicture}[level distance=1.5cm,
  level 1/.style={sibling distance=3cm},
  level 2/.style={sibling distance=1.5cm}]
  \\node[circle, draw] {Root}
    child { node[circle, draw] {L}
      child { node[circle, draw] {LL} }
      child { node[circle, draw] {LR} }
    }
    child { node[circle, draw] {R}
      child { node[circle, draw] {RL} }
      child { node[circle, draw] {RR} }
    };
\\end{tikzpicture}`,
  },
  {
    label: "Flowchart",
    category: "TikZ",
    description: "Simple flowchart",
    template: `\\begin{tikzpicture}[node distance=2cm, auto,
  block/.style={rectangle, draw, text width=5em, text centered, minimum height=3em},
  decision/.style={diamond, draw, text width=4em, text centered, inner sep=0pt},
  line/.style={draw, -stealth}]
  \\node[block] (start) {Start};
  \\node[decision, below of=start] (decide) {Condition?};
  \\node[block, below left of=decide, node distance=3cm] (yes) {Yes};
  \\node[block, below right of=decide, node distance=3cm] (no) {No};
  \\node[block, below of=decide, node distance=4cm] (stop) {End};

  \\path[line] (start) -- (decide);
  \\path[line] (decide) -| node[near start] {yes} (yes);
  \\path[line] (decide) -| node[near start] {no} (no);
  \\path[line] (yes) |- (stop);
  \\path[line] (no) |- (stop);
\\end{tikzpicture}`,
  },
  {
    label: "Commutative Diagram",
    category: "TikZ",
    description: "Commutative diagram with tikz-cd",
    template: `\\usepackage{tikz-cd}
\\begin{tikzcd}
  A \\arrow[r, "f"] \\arrow[d, "g"'] & B \\arrow[d, "h"] \\\\
  C \\arrow[r, "k"'] & D
\\end{tikzcd}`,
  },

  // Unnumbered math environments
  {
    label: "Equation*",
    category: "Math",
    description: "Unnumbered equation",
    template: `\\begin{equation*}
  
\\end{equation*}`,
  },
  {
    label: "Align*",
    category: "Math",
    description: "Unnumbered aligned equations",
    template: `\\begin{align*}
  a &= b + c \\\\
  d &= e + f
\\end{align*}`,
  },
  {
    label: "Gather",
    category: "Math",
    description: "Centered equations (numbered)",
    template: `\\begin{gather}
  a + b = c \\\\
  d + e = f
\\end{gather}`,
  },
  {
    label: "Gather*",
    category: "Math",
    description: "Centered equations (unnumbered)",
    template: `\\begin{gather*}
  a + b = c \\\\
  d + e = f
\\end{gather*}`,
  },
  {
    label: "Multline",
    category: "Math",
    description: "Multi-line equation",
    template: `\\begin{multline}
  a + b + c + d \\\\
  + e + f + g
\\end{multline}`,
  },
  {
    label: "Multline*",
    category: "Math",
    description: "Multi-line equation (unnumbered)",
    template: `\\begin{multline*}
  a + b + c + d \\\\
  + e + f + g
\\end{multline*}`,
  },
  {
    label: "Split",
    category: "Math",
    description: "Split equation inside equation env",
    template: `\\begin{equation}
\\begin{split}
  a &= b + c \\\\
    &= d + e
\\end{split}
\\end{equation}`,
  },

  // Theorem-like environments
  {
    label: "Proof",
    category: "Math",
    description: "Proof environment",
    template: `\\begin{proof}
  
\\end{proof}`,
  },
  {
    label: "Lemma",
    category: "Math",
    description: "Lemma environment",
    template: `\\begin{lemma}
  
\\end{lemma}`,
  },
  {
    label: "Definition",
    category: "Math",
    description: "Definition environment",
    template: `\\begin{definition}
  
\\end{definition}`,
  },
  {
    label: "Corollary",
    category: "Math",
    description: "Corollary environment",
    template: `\\begin{corollary}
  
\\end{corollary}`,
  },
  {
    label: "Proposition",
    category: "Math",
    description: "Proposition environment",
    template: `\\begin{proposition}
  
\\end{proposition}`,
  },
  {
    label: "Remark",
    category: "Math",
    description: "Remark environment",
    template: `\\begin{remark}
  
\\end{remark}`,
  },
  {
    label: "Example",
    category: "Math",
    description: "Example environment",
    template: `\\begin{example}
  
\\end{example}`,
  },

  // More structure snippets
  {
    label: "Minipage",
    category: "Structure",
    description: "Side-by-side content",
    template: `\\begin{minipage}{0.48\\textwidth}
  Left content
\\end{minipage}
\\hfill
\\begin{minipage}{0.48\\textwidth}
  Right content
\\end{minipage}`,
  },
  {
    label: "Subfigure",
    category: "Structure",
    description: "Figure with subfigures",
    template: `\\usepackage{subcaption}
\\begin{figure}[htbp]
  \\centering
  \\begin{subfigure}{0.48\\textwidth}
    \\centering
    \\includegraphics[width=\\linewidth]{image1.png}
    \\caption{First}
    \\label{fig:sub1}
  \\end{subfigure}
  \\hfill
  \\begin{subfigure}{0.48\\textwidth}
    \\centering
    \\includegraphics[width=\\linewidth]{image2.png}
    \\caption{Second}
    \\label{fig:sub2}
  \\end{subfigure}
  \\caption{Overall caption}
  \\label{fig:overall}
\\end{figure}`,
  },
  {
    label: "Algorithm",
    category: "Structure",
    description: "Algorithm pseudocode",
    template: `\\usepackage{algorithm}
\\usepackage{algorithmic}
\\begin{algorithm}[htbp]
  \\caption{Algorithm Name}
  \\begin{algorithmic}[1]
    \\REQUIRE Input
    \\ENSURE Output
    \\STATE Initialize
    \\FOR{$i = 1$ to $n$}
      \\STATE Do something
    \\ENDFOR
    \\RETURN result
  \\end{algorithmic}
\\end{algorithm}`,
  },
  {
    label: "Description",
    category: "Structure",
    description: "Description list",
    template: `\\begin{description}
  \\item[Term 1] Description of first term
  \\item[Term 2] Description of second term
  \\item[Term 3] Description of third term
\\end{description}`,
  },
];

export const SNIPPET_CATEGORIES = [
  "Document",
  "Math",
  "Structure",
  "TikZ",
] as const;

export type SnippetCategory = (typeof SNIPPET_CATEGORIES)[number];

export function getSnippetsByCategory(category: SnippetCategory): LatexSnippet[] {
  return LATEX_SNIPPETS.filter((s) => s.category === category);
}

export const DEFAULT_DOCUMENT = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath, amssymb, amsthm}
\\usepackage{geometry}
\\geometry{margin=1in}

\\title{Untitled Document}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
Hello, world!

\\end{document}
`;

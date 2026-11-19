/**
 * Fuzzy LaTeX autocomplete for CodeMirror 6.
 *
 * Features:
 *   1. Subsequence (fuzzy) matching: typing "\begeq" matches "\begin{equation}"
 *   2. Environments exposed as single "\begin{name}" tokens in the completion list
 *   3. Document macro extraction: \newcommand, \newtheorem, \def, \DeclareMathOperator
 *   4. Proper \end{} auto-close with indentation when completing environments
 *   5. Standard \command completions with cursor placement inside braces
 */

import {
  type CompletionContext,
  type CompletionResult,
  type Completion,
} from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";

/** Environments that should get an automatic \item on the first line */
const LIST_ENVS = new Set(["itemize", "enumerate", "description"]);

/** Read the indent unit string from the editor state (respects project tab size) */
function getIndentStr(view: EditorView): string {
  return view.state.facet(indentUnit);
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers: check if a matching \end{} already exists after the cursor
// ────────────────────────────────────────────────────────────────────────────

/** Escape special regex characters in a string */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check whether the text after the cursor already contains an unmatched
 * \end{envName} that would pair with the \begin{envName} being inserted.
 * This prevents duplicate \end{} tags when the user accepts autocomplete
 * and one already exists below.
 */
function hasMatchingEnd(textAfter: string, envName: string): boolean {
  const beginRegex = new RegExp(`\\\\begin\\{${escapeRegex(envName)}\\}`, "g");
  const endRegex = new RegExp(`\\\\end\\{${escapeRegex(envName)}\\}`, "g");

  const tokens: { pos: number; type: "begin" | "end" }[] = [];

  let match;
  while ((match = beginRegex.exec(textAfter)) !== null) {
    tokens.push({ pos: match.index, type: "begin" });
  }
  while ((match = endRegex.exec(textAfter)) !== null) {
    tokens.push({ pos: match.index, type: "end" });
  }

  // Sort by position
  tokens.sort((a, b) => a.pos - b.pos);

  // Walk through: the first unmatched \end{envName} means one already exists for us
  let nesting = 0;
  for (const token of tokens) {
    if (token.type === "begin") {
      nesting++;
    } else {
      if (nesting === 0) return true; // Found an unmatched \end: it's ours
      nesting--;
    }
  }

  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Fuzzy subsequence matcher
// ────────────────────────────────────────────────────────────────────────────

/**
 * Score how well `query` fuzzy-matches `target`.
 * Returns -1 if the query chars don't all appear in order.
 * Higher score = better match.
 */
function fuzzyScore(query: string, target: string): number {
  const ql = query.toLowerCase();
  const tl = target.toLowerCase();

  let qi = 0;
  let score = 0;
  let prevMatchIdx = -2; // -2 so the first match can't be "consecutive"

  for (let ti = 0; ti < tl.length && qi < ql.length; ti++) {
    if (tl[ti] === ql[qi]) {
      // Consecutive match bonus
      if (ti === prevMatchIdx + 1) score += 6;
      // Start-of-string bonus
      if (ti === 0) score += 10;
      // Word-boundary bonus (after \, {, _, -)
      else if ("{}\\_-*".includes(target[ti - 1])) score += 8;
      // Base match score
      score += 3;
      // Gap penalty
      if (prevMatchIdx >= 0) {
        const gap = ti - prevMatchIdx - 1;
        if (gap > 0) score -= gap * 0.4;
      }
      prevMatchIdx = ti;
      qi++;
    }
  }

  // Not all query chars matched
  if (qi < ql.length) return -1;

  // Prefer shorter targets (more precise)
  score -= target.length * 0.08;

  // Exact prefix gets a large bonus so normal typing still feels instant
  if (tl.startsWith(ql)) score += 20 + ql.length * 2;

  return score;
}

// ────────────────────────────────────────────────────────────────────────────
// Static completion data
// ────────────────────────────────────────────────────────────────────────────

interface CmdDef {
  label: string;
  type: string;
  info?: string;
  /** If set, this is inserted instead of the label. */
  apply?: string;
}

const COMMANDS: CmdDef[] = [
  // Document structure
  {
    label: "\\documentclass",
    type: "keyword",
    apply: "\\documentclass{article}",
    info: "Document class",
  },
  {
    label: "\\usepackage",
    type: "keyword",
    apply: "\\usepackage{}",
    info: "Import package",
  },
  {
    label: "\\section",
    type: "keyword",
    apply: "\\section{}",
    info: "Section heading",
  },
  {
    label: "\\subsection",
    type: "keyword",
    apply: "\\subsection{}",
    info: "Subsection heading",
  },
  {
    label: "\\subsubsection",
    type: "keyword",
    apply: "\\subsubsection{}",
    info: "Subsubsection heading",
  },
  {
    label: "\\chapter",
    type: "keyword",
    apply: "\\chapter{}",
    info: "Chapter heading",
  },
  {
    label: "\\paragraph",
    type: "keyword",
    apply: "\\paragraph{}",
    info: "Paragraph heading",
  },
  {
    label: "\\title",
    type: "keyword",
    apply: "\\title{}",
    info: "Document title",
  },
  {
    label: "\\author",
    type: "keyword",
    apply: "\\author{}",
    info: "Document author",
  },
  {
    label: "\\date",
    type: "keyword",
    apply: "\\date{\\today}",
    info: "Document date",
  },
  { label: "\\maketitle", type: "keyword", info: "Render title block" },
  { label: "\\tableofcontents", type: "keyword", info: "Table of contents" },
  { label: "\\newpage", type: "keyword", info: "Page break" },
  { label: "\\clearpage", type: "keyword", info: "Clear page" },
  {
    label: "\\input",
    type: "function",
    apply: "\\input{}",
    info: "Input file",
  },
  {
    label: "\\include",
    type: "function",
    apply: "\\include{}",
    info: "Include file",
  },

  // Text formatting
  {
    label: "\\textbf",
    type: "function",
    apply: "\\textbf{}",
    info: "Bold text",
  },
  {
    label: "\\textit",
    type: "function",
    apply: "\\textit{}",
    info: "Italic text",
  },
  {
    label: "\\underline",
    type: "function",
    apply: "\\underline{}",
    info: "Underlined text",
  },
  {
    label: "\\emph",
    type: "function",
    apply: "\\emph{}",
    info: "Emphasized text",
  },
  {
    label: "\\texttt",
    type: "function",
    apply: "\\texttt{}",
    info: "Monospace text",
  },
  {
    label: "\\textsc",
    type: "function",
    apply: "\\textsc{}",
    info: "Small caps",
  },
  {
    label: "\\textrm",
    type: "function",
    apply: "\\textrm{}",
    info: "Roman text",
  },
  {
    label: "\\textsf",
    type: "function",
    apply: "\\textsf{}",
    info: "Sans-serif text",
  },
  { label: "\\tiny", type: "keyword", info: "Tiny size" },
  { label: "\\small", type: "keyword", info: "Small size" },
  { label: "\\normalsize", type: "keyword", info: "Normal size" },
  { label: "\\large", type: "keyword", info: "Large size" },
  { label: "\\Large", type: "keyword", info: "Larger size" },
  { label: "\\LARGE", type: "keyword", info: "Even larger size" },
  { label: "\\huge", type: "keyword", info: "Huge size" },
  { label: "\\Huge", type: "keyword", info: "Largest size" },

  // Math
  { label: "\\frac", type: "function", apply: "\\frac{}{}", info: "Fraction" },
  {
    label: "\\dfrac",
    type: "function",
    apply: "\\dfrac{}{}",
    info: "Display fraction",
  },
  {
    label: "\\tfrac",
    type: "function",
    apply: "\\tfrac{}{}",
    info: "Text fraction",
  },
  { label: "\\sqrt", type: "function", apply: "\\sqrt{}", info: "Square root" },
  {
    label: "\\sum",
    type: "function",
    apply: "\\sum_{i=1}^{n}",
    info: "Summation",
  },
  {
    label: "\\prod",
    type: "function",
    apply: "\\prod_{i=1}^{n}",
    info: "Product",
  },
  {
    label: "\\int",
    type: "function",
    apply: "\\int_{a}^{b}",
    info: "Integral",
  },
  { label: "\\iint", type: "function", info: "Double integral" },
  { label: "\\iiint", type: "function", info: "Triple integral" },
  { label: "\\oint", type: "function", info: "Contour integral" },
  {
    label: "\\lim",
    type: "function",
    apply: "\\lim_{x \\to \\infty}",
    info: "Limit",
  },
  { label: "\\sup", type: "function", info: "Supremum" },
  { label: "\\inf", type: "function", info: "Infimum" },
  { label: "\\max", type: "function", info: "Maximum" },
  { label: "\\min", type: "function", info: "Minimum" },
  { label: "\\infty", type: "constant", info: "Infinity symbol" },
  { label: "\\partial", type: "constant", info: "Partial derivative" },
  { label: "\\nabla", type: "constant", info: "Nabla / gradient" },
  { label: "\\forall", type: "constant", info: "For all" },
  { label: "\\exists", type: "constant", info: "Exists" },
  { label: "\\nexists", type: "constant", info: "Does not exist" },
  { label: "\\in", type: "constant", info: "Element of" },
  { label: "\\notin", type: "constant", info: "Not element of" },
  { label: "\\subset", type: "constant", info: "Subset" },
  { label: "\\subseteq", type: "constant", info: "Subset or equal" },
  { label: "\\supset", type: "constant", info: "Superset" },
  { label: "\\supseteq", type: "constant", info: "Superset or equal" },
  { label: "\\cup", type: "constant", info: "Union" },
  { label: "\\cap", type: "constant", info: "Intersection" },
  { label: "\\emptyset", type: "constant", info: "Empty set" },
  { label: "\\varnothing", type: "constant", info: "Empty set (variant)" },
  {
    label: "\\mathbb",
    type: "function",
    apply: "\\mathbb{}",
    info: "Blackboard bold",
  },
  {
    label: "\\mathcal",
    type: "function",
    apply: "\\mathcal{}",
    info: "Calligraphic",
  },
  {
    label: "\\mathfrak",
    type: "function",
    apply: "\\mathfrak{}",
    info: "Fraktur",
  },
  {
    label: "\\mathrm",
    type: "function",
    apply: "\\mathrm{}",
    info: "Roman math",
  },
  {
    label: "\\mathsf",
    type: "function",
    apply: "\\mathsf{}",
    info: "Sans-serif math",
  },
  {
    label: "\\mathit",
    type: "function",
    apply: "\\mathit{}",
    info: "Italic math",
  },
  {
    label: "\\text",
    type: "function",
    apply: "\\text{}",
    info: "Text in math",
  },
  { label: "\\left", type: "keyword", info: "Left delimiter" },
  { label: "\\right", type: "keyword", info: "Right delimiter" },
  { label: "\\bigl", type: "keyword", info: "Big left delimiter" },
  { label: "\\bigr", type: "keyword", info: "Big right delimiter" },
  { label: "\\cdot", type: "constant", info: "Center dot" },
  { label: "\\cdots", type: "constant", info: "Center dots" },
  { label: "\\ldots", type: "constant", info: "Lower dots" },
  { label: "\\vdots", type: "constant", info: "Vertical dots" },
  { label: "\\ddots", type: "constant", info: "Diagonal dots" },
  {
    label: "\\overline",
    type: "function",
    apply: "\\overline{}",
    info: "Overline",
  },
  { label: "\\hat", type: "function", apply: "\\hat{}", info: "Hat accent" },
  {
    label: "\\tilde",
    type: "function",
    apply: "\\tilde{}",
    info: "Tilde accent",
  },
  {
    label: "\\widetilde",
    type: "function",
    apply: "\\widetilde{}",
    info: "Wide tilde",
  },
  {
    label: "\\widehat",
    type: "function",
    apply: "\\widehat{}",
    info: "Wide hat",
  },
  { label: "\\vec", type: "function", apply: "\\vec{}", info: "Vector accent" },
  { label: "\\bar", type: "function", apply: "\\bar{}", info: "Bar accent" },
  { label: "\\dot", type: "function", apply: "\\dot{}", info: "Dot accent" },
  {
    label: "\\ddot",
    type: "function",
    apply: "\\ddot{}",
    info: "Double dot accent",
  },

  // Greek letters (lowercase)
  { label: "\\alpha", type: "constant", info: "α" },
  { label: "\\beta", type: "constant", info: "β" },
  { label: "\\gamma", type: "constant", info: "γ" },
  { label: "\\delta", type: "constant", info: "δ" },
  { label: "\\epsilon", type: "constant", info: "ε" },
  { label: "\\varepsilon", type: "constant", info: "ε (variant)" },
  { label: "\\zeta", type: "constant", info: "ζ" },
  { label: "\\eta", type: "constant", info: "η" },
  { label: "\\theta", type: "constant", info: "θ" },
  { label: "\\vartheta", type: "constant", info: "θ (variant)" },
  { label: "\\iota", type: "constant", info: "ι" },
  { label: "\\kappa", type: "constant", info: "κ" },
  { label: "\\lambda", type: "constant", info: "λ" },
  { label: "\\mu", type: "constant", info: "μ" },
  { label: "\\nu", type: "constant", info: "ν" },
  { label: "\\xi", type: "constant", info: "ξ" },
  { label: "\\pi", type: "constant", info: "π" },
  { label: "\\varpi", type: "constant", info: "π (variant)" },
  { label: "\\rho", type: "constant", info: "ρ" },
  { label: "\\varrho", type: "constant", info: "ρ (variant)" },
  { label: "\\sigma", type: "constant", info: "σ" },
  { label: "\\varsigma", type: "constant", info: "ς" },
  { label: "\\tau", type: "constant", info: "τ" },
  { label: "\\upsilon", type: "constant", info: "υ" },
  { label: "\\phi", type: "constant", info: "φ" },
  { label: "\\varphi", type: "constant", info: "φ (variant)" },
  { label: "\\chi", type: "constant", info: "χ" },
  { label: "\\psi", type: "constant", info: "ψ" },
  { label: "\\omega", type: "constant", info: "ω" },

  // Greek letters (uppercase)
  { label: "\\Gamma", type: "constant", info: "Γ" },
  { label: "\\Delta", type: "constant", info: "Δ" },
  { label: "\\Theta", type: "constant", info: "Θ" },
  { label: "\\Lambda", type: "constant", info: "Λ" },
  { label: "\\Xi", type: "constant", info: "Ξ" },
  { label: "\\Pi", type: "constant", info: "Π" },
  { label: "\\Sigma", type: "constant", info: "Σ" },
  { label: "\\Upsilon", type: "constant", info: "Υ" },
  { label: "\\Phi", type: "constant", info: "Φ" },
  { label: "\\Psi", type: "constant", info: "Ψ" },
  { label: "\\Omega", type: "constant", info: "Ω" },

  // Arrows
  { label: "\\rightarrow", type: "constant", info: "→" },
  { label: "\\leftarrow", type: "constant", info: "←" },
  { label: "\\Rightarrow", type: "constant", info: "⇒" },
  { label: "\\Leftarrow", type: "constant", info: "⇐" },
  { label: "\\leftrightarrow", type: "constant", info: "↔" },
  { label: "\\Leftrightarrow", type: "constant", info: "⇔" },
  { label: "\\longrightarrow", type: "constant", info: "⟶" },
  { label: "\\longleftarrow", type: "constant", info: "⟵" },
  { label: "\\Longrightarrow", type: "constant", info: "⟹" },
  { label: "\\Longleftarrow", type: "constant", info: "⟸" },
  { label: "\\mapsto", type: "constant", info: "↦" },
  { label: "\\longmapsto", type: "constant", info: "⟼" },
  { label: "\\hookrightarrow", type: "constant", info: "↪" },
  { label: "\\hookleftarrow", type: "constant", info: "↩" },
  { label: "\\to", type: "constant", info: "→" },
  { label: "\\implies", type: "constant", info: "⟹" },
  { label: "\\iff", type: "constant", info: "⟺" },
  { label: "\\uparrow", type: "constant", info: "↑" },
  { label: "\\downarrow", type: "constant", info: "↓" },

  // Relations & operators
  { label: "\\leq", type: "constant", info: "≤" },
  { label: "\\geq", type: "constant", info: "≥" },
  { label: "\\neq", type: "constant", info: "≠" },
  { label: "\\approx", type: "constant", info: "≈" },
  { label: "\\equiv", type: "constant", info: "≡" },
  { label: "\\sim", type: "constant", info: "∼" },
  { label: "\\simeq", type: "constant", info: "≃" },
  { label: "\\cong", type: "constant", info: "≅" },
  { label: "\\propto", type: "constant", info: "∝" },
  { label: "\\perp", type: "constant", info: "⊥" },
  { label: "\\parallel", type: "constant", info: "∥" },
  { label: "\\times", type: "constant", info: "×" },
  { label: "\\div", type: "constant", info: "÷" },
  { label: "\\pm", type: "constant", info: "±" },
  { label: "\\mp", type: "constant", info: "∓" },
  { label: "\\otimes", type: "constant", info: "⊗" },
  { label: "\\oplus", type: "constant", info: "⊕" },
  { label: "\\circ", type: "constant", info: "∘" },
  { label: "\\bullet", type: "constant", info: "•" },
  { label: "\\wedge", type: "constant", info: "∧" },
  { label: "\\vee", type: "constant", info: "∨" },
  { label: "\\neg", type: "constant", info: "¬" },
  { label: "\\land", type: "constant", info: "∧" },
  { label: "\\lor", type: "constant", info: "∨" },
  { label: "\\lnot", type: "constant", info: "¬" },

  // References & citations
  { label: "\\label", type: "function", apply: "\\label{}", info: "Label" },
  { label: "\\ref", type: "function", apply: "\\ref{}", info: "Reference" },
  {
    label: "\\eqref",
    type: "function",
    apply: "\\eqref{}",
    info: "Equation reference",
  },
  {
    label: "\\pageref",
    type: "function",
    apply: "\\pageref{}",
    info: "Page reference",
  },
  { label: "\\cite", type: "function", apply: "\\cite{}", info: "Citation" },
  {
    label: "\\citet",
    type: "function",
    apply: "\\citet{}",
    info: "Textual citation",
  },
  {
    label: "\\citep",
    type: "function",
    apply: "\\citep{}",
    info: "Parenthetical citation",
  },
  {
    label: "\\footnote",
    type: "function",
    apply: "\\footnote{}",
    info: "Footnote",
  },
  {
    label: "\\includegraphics",
    type: "function",
    apply: "\\includegraphics[width=0.8\\textwidth]{}",
    info: "Include image",
  },

  // Declarations
  {
    label: "\\newcommand",
    type: "keyword",
    apply: "\\newcommand{\\}{}",
    info: "Define new command",
  },
  {
    label: "\\renewcommand",
    type: "keyword",
    apply: "\\renewcommand{\\}{}",
    info: "Redefine command",
  },
  {
    label: "\\newenvironment",
    type: "keyword",
    apply: "\\newenvironment{}{}{}",
    info: "Define new environment",
  },
  {
    label: "\\newtheorem",
    type: "keyword",
    apply: "\\newtheorem{}{}",
    info: "Define theorem-like environment",
  },
  {
    label: "\\DeclareMathOperator",
    type: "keyword",
    apply: "\\DeclareMathOperator{\\}{}",
    info: "Declare math operator",
  },
  { label: "\\def", type: "keyword", info: "TeX-level macro definition" },
  { label: "\\let", type: "keyword", info: "TeX-level alias" },
  {
    label: "\\setlength",
    type: "keyword",
    apply: "\\setlength{}{}",
    info: "Set length",
  },

  // Misc
  {
    label: "\\hspace",
    type: "function",
    apply: "\\hspace{}",
    info: "Horizontal space",
  },
  {
    label: "\\vspace",
    type: "function",
    apply: "\\vspace{}",
    info: "Vertical space",
  },
  {
    label: "\\phantom",
    type: "function",
    apply: "\\phantom{}",
    info: "Invisible box",
  },
  { label: "\\quad", type: "constant", info: "Quad space" },
  { label: "\\qquad", type: "constant", info: "Double quad space" },
  { label: "\\centering", type: "keyword", info: "Center content" },
  { label: "\\raggedright", type: "keyword", info: "Left-aligned content" },
  { label: "\\raggedleft", type: "keyword", info: "Right-aligned content" },
  { label: "\\item", type: "keyword", info: "List item" },
  {
    label: "\\caption",
    type: "function",
    apply: "\\caption{}",
    info: "Caption",
  },
  { label: "\\hline", type: "keyword", info: "Horizontal line" },
  {
    label: "\\cline",
    type: "function",
    apply: "\\cline{-}",
    info: "Partial horizontal line",
  },
  {
    label: "\\multicolumn",
    type: "function",
    apply: "\\multicolumn{}{}{}",
    info: "Span columns",
  },
  {
    label: "\\multirow",
    type: "function",
    apply: "\\multirow{}{}{}",
    info: "Span rows",
  },
  { label: "\\toprule", type: "keyword", info: "Booktabs top rule" },
  { label: "\\midrule", type: "keyword", info: "Booktabs mid rule" },
  { label: "\\bottomrule", type: "keyword", info: "Booktabs bottom rule" },
  {
    label: "\\bibliography",
    type: "function",
    apply: "\\bibliography{}",
    info: "Bibliography file",
  },
  {
    label: "\\bibliographystyle",
    type: "function",
    apply: "\\bibliographystyle{}",
    info: "Bibliography style",
  },
];

const ENVIRONMENTS = [
  "document",
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "split",
  "flalign",
  "flalign*",
  "eqnarray",
  "eqnarray*",
  "figure",
  "figure*",
  "table",
  "table*",
  "tabular",
  "tabular*",
  "tabularx",
  "longtable",
  "itemize",
  "enumerate",
  "description",
  "abstract",
  "proof",
  "theorem",
  "lemma",
  "corollary",
  "proposition",
  "definition",
  "example",
  "remark",
  "note",
  "conjecture",
  "notation",
  "observation",
  "assumption",
  "axiom",
  "property",
  "claim",
  "exercise",
  "problem",
  "solution",
  "question",
  "verbatim",
  "lstlisting",
  "minted",
  "minipage",
  "center",
  "flushleft",
  "flushright",
  "quote",
  "quotation",
  "verse",
  "cases",
  "bmatrix",
  "pmatrix",
  "vmatrix",
  "Bmatrix",
  "Vmatrix",
  "matrix",
  "array",
  "tikzpicture",
  "tikzcd",
  "frame",
  "block",
  "algorithmic",
  "algorithm",
  "thebibliography",
  "appendix",
  "displaymath",
  "math",
  "picture",
  "letter",
  "titlepage",
  "landscape",
  "multicols",
  "wrapfigure",
  "subfigure",
];

// ────────────────────────────────────────────────────────────────────────────
// Document macro extraction
// ────────────────────────────────────────────────────────────────────────────

interface ExtractedMacro {
  label: string;
  type: string;
  info: string;
  /** If true this is an environment name (for \begin{}/\end{}) */
  isEnv?: boolean;
}

/**
 * Scan the document text for user-defined macros and theorem-like environments.
 * Returns a deduplicated list.
 */
function extractDocumentMacros(doc: string): ExtractedMacro[] {
  const seen = new Set<string>();
  const macros: ExtractedMacro[] = [];

  const add = (m: ExtractedMacro) => {
    if (seen.has(m.label)) return;
    seen.add(m.label);
    macros.push(m);
  };

  // \newcommand{\name}  \newcommand*{\name}  \renewcommand{\name}
  // Also matches \providecommand
  const cmdRe = /\\(?:new|renew|provide)command\*?\s*\{(\\[a-zA-Z]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = cmdRe.exec(doc)) !== null) {
    add({ label: m[1], type: "function", info: "User command" });
  }

  // \DeclareMathOperator{\name}{display}  \DeclareMathOperator*{\name}{display}
  const opRe = /\\DeclareMathOperator\*?\s*\{(\\[a-zA-Z]+)\}/g;
  while ((m = opRe.exec(doc)) !== null) {
    add({ label: m[1], type: "function", info: "Math operator" });
  }

  // \def\name  (TeX primitive)
  const defRe = /\\def\s*(\\[a-zA-Z]+)/g;
  while ((m = defRe.exec(doc)) !== null) {
    add({ label: m[1], type: "function", info: "TeX macro" });
  }

  // \let\name = \other
  const letRe = /\\let\s*(\\[a-zA-Z]+)/g;
  while ((m = letRe.exec(doc)) !== null) {
    add({ label: m[1], type: "function", info: "TeX alias" });
  }

  // \newtheorem{name}{Display Name}  \newtheorem*{name}{Display Name}
  const thmRe =
    /\\newtheorem\*?\s*\{([a-zA-Z]+)\}\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
  while ((m = thmRe.exec(doc)) !== null) {
    const envName = m[1];
    const displayName = m[2] || envName;
    add({
      label: envName,
      type: "type",
      info: `${displayName} (theorem-like)`,
      isEnv: true,
    });
  }

  // \newenvironment{name}  \renewenvironment{name}
  const envRe = /\\(?:new|renew)environment\*?\s*\{([a-zA-Z]+)\}/g;
  while ((m = envRe.exec(doc)) !== null) {
    add({
      label: m[1],
      type: "type",
      info: "User environment",
      isEnv: true,
    });
  }

  // \theoremstyle{...} followed by \newtheorem: already handled above

  return macros;
}

// ────────────────────────────────────────────────────────────────────────────
// Build the Completion objects
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a Completion for a \begin{env} environment.
 * The `apply` function inserts:
 *   \begin{env}
 *     |
 *   \end{env}
 * with correct indentation and cursor placement.
 */
function makeEnvCompletion(
  envName: string,
  info: string,
): { label: string; filterLabel: string; completion: Completion } {
  const label = `\\begin{${envName}}`;
  const isList = LIST_ENVS.has(envName);
  return {
    label,
    filterLabel: label, // fuzzy matched against this
    completion: {
      label,
      type: "type",
      info,
      apply: (
        view: EditorView,
        _completion: Completion,
        from: number,
        to: number,
      ) => {
        const ind = getIndentStr(view);
        const line = view.state.doc.lineAt(from);
        const indentMatch = line.text.match(/^(\s*)/);
        const baseIndent = indentMatch ? indentMatch[1] : "";
        const innerIndent = baseIndent + ind;

        const innerContent = isList
          ? `${innerIndent}\\item `
          : `${innerIndent}`;
        const alreadyHasEnd = hasMatchingEnd(
          view.state.doc.sliceString(to),
          envName,
        );
        const endTag = `\n${baseIndent}\\end{${envName}}`;
        const insert = alreadyHasEnd
          ? `\\begin{${envName}}\n${innerContent}`
          : `\\begin{${envName}}\n${innerContent}${endTag}`;
        const cursorPos = from + `\\begin{${envName}}\n${innerContent}`.length;

        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: cursorPos },
        });
      },
    },
  };
}

/**
 * Build a Completion for a regular \command.
 * If the apply string contains `{}`, place the cursor inside the first `{}`.
 */
function makeCmdCompletion(cmd: CmdDef): {
  label: string;
  filterLabel: string;
  completion: Completion;
} {
  const applyText = cmd.apply || cmd.label;

  // If the apply text has {}, place cursor inside the first pair
  const braceIdx = applyText.indexOf("{}");
  const needsCursorPlacement = braceIdx >= 0;

  const completion: Completion = {
    label: cmd.label,
    type: cmd.type,
    info: cmd.info,
  };

  if (needsCursorPlacement) {
    completion.apply = (
      view: EditorView,
      _completion: Completion,
      from: number,
      to: number,
    ) => {
      view.dispatch({
        changes: { from, to, insert: applyText },
        selection: { anchor: from + braceIdx + 1 },
      });
    };
  } else {
    completion.apply = applyText;
  }

  return {
    label: cmd.label,
    filterLabel: cmd.label,
    completion,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Pre-built candidate list (static, built once on module load)
// ────────────────────────────────────────────────────────────────────────────

interface Candidate {
  /** String used for fuzzy matching */
  filterLabel: string;
  /** The Completion object handed to CodeMirror */
  completion: Completion;
}

const STATIC_CANDIDATES: Candidate[] = [
  // Commands
  ...COMMANDS.filter((cmd) => cmd.label).map((cmd) => {
    const c = makeCmdCompletion(cmd);
    return {
      filterLabel: c.filterLabel,
      completion: c.completion,
    } as Candidate;
  }),
  // Environments as \begin{...}
  ...ENVIRONMENTS.filter(Boolean).map((env) => {
    const c = makeEnvCompletion(env, `${env} environment`);
    return {
      filterLabel: c.filterLabel,
      completion: c.completion,
    } as Candidate;
  }),
];

// ────────────────────────────────────────────────────────────────────────────
// Completion source: the main export
// ────────────────────────────────────────────────────────────────────────────

/**
 * CodeMirror 6 completion source with fuzzy subsequence matching.
 *
 * This is designed to be used as the sole completion source for the editor
 * (disable the `enableAutocomplete` option on the `latex()` language extension
 * and register this via `autocompletion({ override: [latexCompletionSource] })`).
 */
export function latexCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  // ── Case 1: inside \begin{...} or \end{...}, environment-name completion ──
  const envMatch = context.matchBefore(/\\(?:begin|end)\{[a-zA-Z*]*/);
  if (envMatch) {
    return handleEnvNameCompletion(context, envMatch);
  }

  // ── Case 2: general \command, fuzzy matching across commands + \begin{env} ──
  const cmdMatch = context.matchBefore(/\\[a-zA-Z]*/);
  if (cmdMatch && cmdMatch.text.length >= 2) {
    return handleFuzzyCompletion(context, cmdMatch);
  }

  return null;
}

// ── Case 1 handler ──────────────────────────────────────────────────────────

function handleEnvNameCompletion(
  context: CompletionContext,
  envMatch: { from: number; to: number; text: string },
): CompletionResult | null {
  const braceIdx = envMatch.text.indexOf("{");
  if (braceIdx < 0) return null;

  const nameFrom = envMatch.from + braceIdx + 1;
  const query = envMatch.text.slice(braceIdx + 1); // e.g. "eq" from "\begin{eq"
  const isBegin = envMatch.text.startsWith("\\begin");

  // Gather environment names (static + document macros)
  const doc = context.state.doc.toString();
  const docMacros = extractDocumentMacros(doc);
  const docEnvNames = docMacros.filter((m) => m.isEnv).map((m) => m.label);
  const allEnvNames = [...new Set([...ENVIRONMENTS, ...docEnvNames])];

  // Fuzzy-match the typed portion against environment names
  const scored = allEnvNames
    .map((env) => ({
      env,
      score: query.length > 0 ? fuzzyScore(query, env) : 0,
    }))
    .filter((s) => s.score >= 0 || query.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);

  if (scored.length === 0) return null;

  const options: Completion[] = scored
    .filter(({ env }) => typeof env === "string" && env.length > 0)
    .map(({ env }) => {
      if (isBegin) {
        // Inside \begin{}: insert name + closing brace + \end{} block
        return {
          label: env,
          type: "type",
          info: `${env} environment`,
          apply: (
            view: EditorView,
            _c: Completion,
            from: number,
            to: number,
          ) => {
            // Check if there's already a } right after `to`
            const charAfter = view.state.sliceDoc(to, to + 1);
            const needClosingBrace = charAfter !== "}";

            const ind = getIndentStr(view);
            const line = view.state.doc.lineAt(from);
            const indentMatch = line.text.match(/^(\s*)/);
            const baseIndent = indentMatch ? indentMatch[1] : "";
            const innerIndent = baseIndent + ind;
            const isListEnv = LIST_ENVS.has(env);

            const closeBrace = needClosingBrace ? "}" : "";
            const innerContent = isListEnv
              ? `${innerIndent}\\item `
              : `${innerIndent}`;
            const replaceTo = needClosingBrace ? to : to + 1;
            const alreadyHasEnd = hasMatchingEnd(
              view.state.doc.sliceString(replaceTo),
              env,
            );
            const endTag = `\n${baseIndent}\\end{${env}}`;
            const insert = alreadyHasEnd
              ? `${env}${closeBrace}\n${innerContent}`
              : `${env}${closeBrace}\n${innerContent}${endTag}`;
            const cursorPos =
              from + env.length + closeBrace.length + 1 + innerContent.length;

            view.dispatch({
              changes: { from, to: replaceTo, insert },
              selection: { anchor: cursorPos },
            });
          },
        };
      } else {
        // Inside \end{}: just insert name, consume existing } if present
        return {
          label: env,
          type: "type",
          info: `${env} environment`,
          apply: (
            view: EditorView,
            _c: Completion,
            from: number,
            to: number,
          ) => {
            const charAfter = view.state.sliceDoc(to, to + 1);
            const consumeClose = charAfter === "}" ? 1 : 0;
            view.dispatch({
              changes: { from, to: to + consumeClose, insert: `${env}}` },
              selection: { anchor: from + env.length + 1 },
            });
          },
        };
      }
    });

  return {
    from: nameFrom,
    options,
    filter: false, // we already fuzzy-filtered
  };
}

// ── Case 2 handler ──────────────────────────────────────────────────────────

function handleFuzzyCompletion(
  context: CompletionContext,
  cmdMatch: { from: number; to: number; text: string },
): CompletionResult | null {
  const query = cmdMatch.text; // e.g. "\begeq" or "\frc"

  // Build dynamic candidates from document macros
  const doc = context.state.doc.toString();
  const docMacros = extractDocumentMacros(doc);

  const dynamicCandidates: Candidate[] = [];
  for (const macro of docMacros) {
    if (!macro.label) continue; // skip malformed entries
    if (macro.isEnv) {
      const c = makeEnvCompletion(macro.label, macro.info);
      dynamicCandidates.push({
        filterLabel: c.filterLabel,
        completion: c.completion,
      });
    } else {
      dynamicCandidates.push({
        filterLabel: macro.label,
        completion: {
          label: macro.label,
          type: macro.type,
          info: macro.info,
        },
      });
    }
  }

  // Merge static + dynamic, dedup by filterLabel
  const seen = new Set<string>();
  const allCandidates: Candidate[] = [];
  for (const c of [...STATIC_CANDIDATES, ...dynamicCandidates]) {
    if (seen.has(c.filterLabel)) continue;
    seen.add(c.filterLabel);
    allCandidates.push(c);
  }

  // Fuzzy match
  const scored = allCandidates
    .map((c) => ({ candidate: c, score: fuzzyScore(query, c.filterLabel) }))
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);

  if (scored.length === 0) return null;

  const options = scored
    .map((s) => ({
      ...s.candidate.completion,
      // Use boost so CodeMirror respects our sort order
      boost: s.score,
    }))
    .filter((o) => typeof o.label === "string" && o.label.length > 0);

  if (options.length === 0) return null;

  return {
    from: cmdMatch.from,
    options,
    filter: false, // we already fuzzy-filtered and sorted
  };
}

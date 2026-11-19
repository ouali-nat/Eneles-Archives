// Examples, TikZ starters and library chips.
//
// Mirrors impress/python/pythonpath/texer_imp/snippets.py, where every entry is
// compiled by the test suite. Edit there first, then carry the change here.

import { RenderMode, Workspace } from "./types";

export interface Snippet {
  id: string;
  label: string;
  mode: RenderMode;
  workspace: Exclude<Workspace, "boxes">;
  source: string;
}

export const SNIPPETS: Snippet[] = [
  {
    id: "integral",
    label: "Integral",
    mode: "quick",
    workspace: "math",
    source: "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}",
  },
  {
    id: "matrix",
    label: "Matrix",
    mode: "quick",
    workspace: "math",
    source: "\\begin{pmatrix}\n  a & b \\\\\n  c & d\n\\end{pmatrix}\n\\begin{pmatrix} x \\\\ y \\end{pmatrix}\n=\n\\begin{pmatrix} ax+by \\\\ cx+dy \\end{pmatrix}",
  },
  {
    id: "align",
    label: "Aligned steps",
    mode: "quick",
    workspace: "math",
    source: "\\begin{aligned}\n  (a+b)^2\n    &= (a+b)(a+b) \\\\\n    &= a^2 + 2ab + b^2\n\\end{aligned}",
  },
  {
    id: "cases",
    label: "Cases",
    mode: "quick",
    workspace: "math",
    source: "|x| = \\begin{cases}\n  x & x \\ge 0 \\\\\n  -x & x < 0\n\\end{cases}",
  },
  {
    id: "quadratic",
    label: "Quadratic formula",
    mode: "quick",
    workspace: "math",
    source: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
  },
  {
    id: "units",
    label: "Units (siunitx)",
    mode: "full",
    workspace: "latex",
    source: "\\usepackage{siunitx}\n$g = \\qty{9.81}{\\metre\\per\\second\\squared}$",
  },
  {
    id: "physics",
    label: "Physics notation",
    mode: "full",
    workspace: "latex",
    source: "\\usepackage{physics}\n$\\dv{f}{x} \\quad \\pdv{u}{t} \\quad \\ket{\\psi} \\quad \\expval{H}$",
  },
  {
    id: "tikz-arrow",
    label: "TikZ arrow",
    mode: "full",
    workspace: "tikz",
    source: "\\usetikzlibrary{arrows.meta,positioning}\n\\begin{tikzpicture}[node distance=2.2cm, auto]\n  \\node (A) {$A$};\n  \\node (B) [right=of A] {$B$};\n  \\draw[->] (A) -- node {$f$} (B);\n\\end{tikzpicture}",
  },
  {
    id: "commutative",
    label: "Comm. square",
    mode: "full",
    workspace: "tikz",
    source: "\\usetikzlibrary{matrix,arrows.meta}\n\\begin{tikzpicture}\n  \\matrix (m) [matrix of math nodes, row sep=2em, column sep=2.5em]\n    { A & B \\\\\n      C & D \\\\};\n  \\draw[-{Stealth}] (m-1-1) -- node[above] {$f$} (m-1-2);\n  \\draw[-{Stealth}] (m-1-1) -- node[left] {$g$} (m-2-1);\n  \\draw[-{Stealth}] (m-1-2) -- node[right] {$h$} (m-2-2);\n  \\draw[-{Stealth}] (m-2-1) -- node[below] {$k$} (m-2-2);\n\\end{tikzpicture}",
  },
  {
    id: "circuit",
    label: "Circuit",
    mode: "full",
    workspace: "tikz",
    source: "\\usepackage{circuitikz}\n\\begin{circuitikz}[american]\n  \\draw (0,0) to[V, v=$V$] (0,2)\n        to[R, l=$R$] (3,2)\n        to[C, l=$C$] (3,0)\n        -- (0,0);\n\\end{circuitikz}",
  },
  {
    id: "chemfig",
    label: "Molecule",
    mode: "full",
    workspace: "latex",
    source: "\\usepackage{chemfig}\n\\chemfig{H-C(-[2]H)(-[6]H)-C(-[2]H)(-[6]H)-OH}",
  },
  {
    id: "pgfplots",
    label: "Plot",
    mode: "full",
    workspace: "tikz",
    source: "\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}\n\\begin{tikzpicture}\n\\begin{axis}[width=8cm, height=5cm, xlabel={$x$}, ylabel={$y$}, grid=major]\n  \\addplot[domain=-2:2, samples=80] {x^2};\n\\end{axis}\n\\end{tikzpicture}",
  },
];

export const TIKZ_LIBRARY_CHIPS: { label: string; line: string }[] = [
  { label: "arrows.meta", line: "\\usetikzlibrary{arrows.meta}" },
  { label: "positioning", line: "\\usetikzlibrary{positioning}" },
  { label: "calc", line: "\\usetikzlibrary{calc}" },
  { label: "matrix", line: "\\usetikzlibrary{matrix}" },
  { label: "shapes", line: "\\usetikzlibrary{shapes.geometric,shapes.symbols}" },
  { label: "fit", line: "\\usetikzlibrary{fit,backgrounds}" },
  { label: "decorations", line: "\\usetikzlibrary{decorations.pathmorphing,decorations.markings}" },
  { label: "intersections", line: "\\usetikzlibrary{intersections}" },
  { label: "patterns", line: "\\usetikzlibrary{patterns.meta}" },
  { label: "trees + mindmap", line: "\\usetikzlibrary{trees,mindmap}" },
  { label: "automata", line: "\\usetikzlibrary{automata}" },
  { label: "chains", line: "\\usetikzlibrary{chains}" },
  { label: "shadows", line: "\\usetikzlibrary{shadows}" },
  { label: "angles + quotes", line: "\\usetikzlibrary{angles,quotes}" },
  { label: "3d", line: "\\usetikzlibrary{3d}" },
  { label: "petri", line: "\\usetikzlibrary{petri}" },
  { label: "knots (spath3)", line: "\\usepackage{spath3}\\usetikzlibrary{knots}" },
  { label: "circuitikz", line: "\\usepackage{circuitikz}" },
  { label: "chemfig", line: "\\usepackage{chemfig}" },
  { label: "pgfplots", line: "\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}" },
  { label: "pgfplots fillbetween", line: "\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}\\usepgfplotslibrary{fillbetween}" },
  { label: "forest", line: "\\usepackage{forest}" },
  { label: "tikz-cd", line: "\\usepackage{tikz-cd}" },
  { label: "quantikz", line: "\\usepackage{quantikz}" },
  { label: "tikz-3dplot", line: "\\usepackage{tikz-3dplot}" },
  { label: "tikz-feynman", line: "\\usepackage{tikz-feynman}" },
  { label: "zx-calculus", line: "\\usepackage{zx-calculus}" },
  { label: "dynkin-diagrams", line: "\\usepackage{dynkin-diagrams}" },
  { label: "braids", line: "\\usepackage{braids}" },
  { label: "venndiagram", line: "\\usepackage{venndiagram}" },
  { label: "neuralnetwork", line: "\\usepackage{neuralnetwork}" },
  { label: "chronology", line: "\\usepackage{chronology}" },
  { label: "siunitx", line: "\\usepackage{siunitx}" },
  { label: "physics", line: "\\usepackage{physics}" },
];

export const TIKZ_TEMPLATES: { id: string; label: string; source: string }[] = [
  {
    id: "blank-canvas",
    label: "Blank canvas",
    source: "\\begin{tikzpicture}\n  % Draw here.\n\\end{tikzpicture}",
  },
  {
    id: "labeled-arrow",
    label: "Labeled arrow",
    source: "\\usetikzlibrary{arrows.meta,positioning}\n\\begin{tikzpicture}[node distance=2.4cm]\n  \\node (a) {$A$};\n  \\node (b) [right=of a] {$B$};\n  \\draw[-{Stealth}] (a) -- node[above] {$f$} (b);\n\\end{tikzpicture}",
  },
  {
    id: "commutative-square",
    label: "Commutative square",
    source: "\\usetikzlibrary{arrows.meta,matrix}\n\\begin{tikzpicture}\n  \\matrix (m) [matrix of math nodes, row sep=2em, column sep=2.6em]\n    { A & B \\\\\n      C & D \\\\ };\n  \\draw[-{Stealth}] (m-1-1) -- node[above] {$f$} (m-1-2);\n  \\draw[-{Stealth}] (m-1-1) -- node[left] {$g$} (m-2-1);\n  \\draw[-{Stealth}] (m-1-2) -- node[right] {$h$} (m-2-2);\n  \\draw[-{Stealth}] (m-2-1) -- node[below] {$k$} (m-2-2);\n\\end{tikzpicture}",
  },
  {
    id: "flowchart",
    label: "Flowchart",
    source: "\\usetikzlibrary{arrows.meta,positioning,shapes.geometric}\n\\begin{tikzpicture}[node distance=11mm, every node/.style={draw, rounded corners, minimum width=25mm, minimum height=8mm}]\n  \\node (start) {Start};\n  \\node (next) [below=of start] {Next step};\n  \\draw[-{Stealth}] (start) -- (next);\n\\end{tikzpicture}",
  },
  {
    id: "tikz-cd-diagram",
    label: "tikz-cd diagram",
    source: "\\usepackage{tikz-cd}\n\\begin{tikzcd}\n  A \\arrow[r, \"f\"] \\arrow[d, \"g\"'] & B \\arrow[d, \"h\"] \\\\\n  C \\arrow[r, \"k\"'] & D\n\\end{tikzcd}",
  },
  {
    id: "automaton",
    label: "Automaton",
    source: "\\usetikzlibrary{automata,arrows.meta,positioning}\n\\begin{tikzpicture}[shorten >=1pt, node distance=2.4cm, on grid, >={Stealth}, auto]\n  \\node[state, initial] (q0) {$q_0$};\n  \\node[state, accepting] (q1) [right=of q0] {$q_1$};\n  \\path[->] (q0) edge [bend left] node {$a$} (q1)\n            (q1) edge [bend left] node {$b$} (q0)\n            (q1) edge [loop above] node {$a$} ();\n\\end{tikzpicture}",
  },
  {
    id: "mind-map",
    label: "Mind map",
    source: "\\usetikzlibrary{mindmap}\n\\begin{tikzpicture}[mindmap, concept color=gray!40, every node/.style={concept}]\n  \\node {Topic}\n    child[grow=0] {node {Idea}}\n    child[grow=120] {node {Idea}}\n    child[grow=240] {node {Idea}};\n\\end{tikzpicture}",
  },
  {
    id: "tree--forest",
    label: "Tree (forest)",
    source: "\\usepackage{forest}\n\\begin{forest}\n  for tree={circle, draw, minimum size=7mm, l sep=8mm}\n  [$r$ [$a$ [$c$] [$d$]] [$b$]]\n\\end{forest}",
  },
  {
    id: "bar-chart",
    label: "Bar chart",
    source: "\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}\n\\begin{tikzpicture}\n\\begin{axis}[ybar, width=8cm, height=5cm, symbolic x coords={A,B,C,D}, xtick=data, ymin=0]\n  \\addplot coordinates {(A,3) (B,5) (C,2) (D,4)};\n\\end{axis}\n\\end{tikzpicture}",
  },
  {
    id: "shaded-area",
    label: "Shaded area",
    source: "\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}\\usepgfplotslibrary{fillbetween}\n\\begin{tikzpicture}\n\\begin{axis}[width=8cm, height=5cm, axis lines=middle, xlabel={$x$}, ylabel={$y$}, domain=0:3]\n  \\addplot[name path=f, thick] {x^2/3};\n  \\path[name path=axis] (axis cs:0,0) -- (axis cs:3,0);\n  \\addplot[gray!40] fill between[of=f and axis, soft clip={domain=1:2.5}];\n\\end{axis}\n\\end{tikzpicture}",
  },
  {
    id: "angle-in-a-triangle",
    label: "Angle in a triangle",
    source: "\\usetikzlibrary{angles,quotes}\n\\begin{tikzpicture}\n  \\coordinate[label=left:$A$] (A) at (0,0);\n  \\coordinate[label=right:$B$] (B) at (4,0);\n  \\coordinate[label=above:$C$] (C) at (1,2.5);\n  \\draw (A) -- (B) -- (C) -- cycle;\n  \\pic[draw, \"$\\alpha$\", angle eccentricity=1.5] {angle=B--A--C};\n\\end{tikzpicture}",
  },
  {
    id: "3d-axes",
    label: "3D axes",
    source: "\\usepackage{tikz-3dplot}\n\\tdplotsetmaincoords{70}{110}\n\\begin{tikzpicture}[tdplot_main_coords, scale=2]\n  \\draw[->] (0,0,0) -- (1,0,0) node[anchor=north east] {$x$};\n  \\draw[->] (0,0,0) -- (0,1,0) node[anchor=north west] {$y$};\n  \\draw[->] (0,0,0) -- (0,0,1) node[anchor=south] {$z$};\n  \\draw[thick, ->] (0,0,0) -- (0.6,0.5,0.7) node[anchor=west] {$\\vec v$};\n\\end{tikzpicture}",
  },
  {
    id: "quantum-circuit",
    label: "Quantum circuit",
    source: "\\usepackage{quantikz}\n\\begin{quantikz}\n  \\lstick{$\\ket{0}$} & \\gate{H} & \\ctrl{1} & \\meter{} \\\\\n  \\lstick{$\\ket{0}$} & & \\targ{} & \\meter{}\n\\end{quantikz}",
  },
  {
    id: "feynman-diagram",
    label: "Feynman diagram",
    source: "% Manual vertex positions work with pdflatex; automatic layout needs lualatex.\n\\usepackage{tikz-feynman}\n\\begin{tikzpicture}\n\\begin{feynman}\n  \\vertex (a) at (0,1) {$e^-$};\n  \\vertex (b) at (0,-1) {$e^+$};\n  \\vertex (c) at (1.5,0);\n  \\vertex (d) at (3,0);\n  \\vertex (e) at (4.5,1) {$\\mu^-$};\n  \\vertex (f) at (4.5,-1) {$\\mu^+$};\n  \\diagram* {\n    (a) -- [fermion] (c) -- [fermion] (b),\n    (c) -- [photon, edge label=$\\gamma$] (d),\n    (f) -- [fermion] (d) -- [fermion] (e),\n  };\n\\end{feynman}\n\\end{tikzpicture}",
  },
  {
    id: "venn-diagram",
    label: "Venn diagram",
    source: "\\usepackage{venndiagram}\n\\begin{venndiagram2sets}[labelA={$A$}, labelB={$B$}, shade=gray!40]\n  \\fillACapB\n\\end{venndiagram2sets}",
  },
  {
    id: "neural-network",
    label: "Neural network",
    source: "\\usepackage{neuralnetwork}\n\\begin{neuralnetwork}[height=4]\n  \\inputlayer[count=3, bias=false]\n  \\hiddenlayer[count=4, bias=false] \\linklayers\n  \\outputlayer[count=2] \\linklayers\n\\end{neuralnetwork}",
  },
  {
    id: "timeline",
    label: "Timeline",
    source: "\\usepackage{chronology}\n\\begin{chronology}[10]{1900}{2000}{10cm}\n  \\event{1905}{Relativity}\n  \\event{1925}{Quantum mechanics}\n  \\event{1969}{Moon landing}\n\\end{chronology}",
  },
  {
    id: "braid",
    label: "Braid",
    source: "\\usepackage{braids}\n\\begin{tikzpicture}\n  \\braid[number of strands=3, thick] s_1 s_2^{-1} s_1;\n\\end{tikzpicture}",
  },
];

const FULL_HINT =
  /\\begin\{(tikzpicture|circuitikz|chemfig|forest|axis)\}|\\documentclass|\\usepackage\{|\\usetikzlibrary|\\tikzset|\\draw\b|\\node\b/;

/** True when the source almost certainly needs a real TeX engine, not MathJax. */
export function looksLikeFullLatex(source: string): boolean {
  return FULL_HINT.test(source);
}

/** Prepends a declaration once; duplicate clicks are ignored. */
export function insertLine(source: string, line: string): string {
  if (source.includes(line)) return source;
  return source.trim() ? `${line}\n${source}` : `${line}\n`;
}

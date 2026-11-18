"""Examples, TikZ starters and library chips. Mirrors powerpoint/src/core/snippets.ts
and the TIKZ_* tables at the top of powerpoint/src/taskpane/taskpane.ts."""

WORKSPACES = ("math", "latex", "boxes", "tikz")
WORKSPACE_LABELS = {"math": "Math", "latex": "LaTeX", "boxes": "Boxes", "tikz": "TikZ"}
WORKSPACE_HINTS = {
    "math": "Equations and aligned math. Compiled with your local TeX.",
    "latex": "Full LaTeX source. Preamble declarations at the top are handled automatically.",
    "boxes": "Build clean theorem-style boxes. Only the small tcolorbox dependency is added.",
    "tikz": "Write TikZ directly, then add libraries or a starter diagram as needed.",
}

SNIPPETS = [
    {
        "id": "integral",
        "label": "Integral",
        "workspace": "math",
        "source": "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}",
    },
    {
        "id": "matrix",
        "label": "Matrix",
        "workspace": "math",
        "source": "\\begin{pmatrix}\n  a & b \\\\\n  c & d\n\\end{pmatrix}\n\\begin{pmatrix} x \\\\ y \\end{pmatrix}\n=\n"
        "\\begin{pmatrix} ax+by \\\\ cx+dy \\end{pmatrix}",
    },
    {
        "id": "align",
        "label": "Aligned steps",
        "workspace": "math",
        "source": "\\begin{aligned}\n  (a+b)^2\n    &= (a+b)(a+b) \\\\\n    &= a^2 + 2ab + b^2\n\\end{aligned}",
    },
    {
        "id": "cases",
        "label": "Cases",
        "workspace": "math",
        "source": "|x| = \\begin{cases}\n  x & x \\ge 0 \\\\\n  -x & x < 0\n\\end{cases}",
    },
    {
        "id": "quadratic",
        "label": "Quadratic formula",
        "workspace": "math",
        "source": "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
    },
    {
        "id": "units",
        "label": "Units (siunitx)",
        "workspace": "latex",
        "source": "\\usepackage{siunitx}\n$g = \\qty{9.81}{\\metre\\per\\second\\squared}$",
    },
    {
        "id": "physics",
        "label": "Physics notation",
        "workspace": "latex",
        "source": "\\usepackage{physics}\n$\\dv{f}{x} \\quad \\pdv{u}{t} \\quad \\ket{\\psi} \\quad \\expval{H}$",
    },
    {
        "id": "tikz-arrow",
        "label": "TikZ arrow",
        "workspace": "tikz",
        "source": "\\usetikzlibrary{arrows.meta,positioning}\n\\begin{tikzpicture}[node distance=2.2cm, auto]\n"
        "  \\node (A) {$A$};\n  \\node (B) [right=of A] {$B$};\n  \\draw[->] (A) -- node {$f$} (B);\n\\end{tikzpicture}",
    },
    {
        "id": "commutative",
        "label": "Comm. square",
        "workspace": "tikz",
        "source": "\\usetikzlibrary{matrix,arrows.meta}\n\\begin{tikzpicture}\n"
        "  \\matrix (m) [matrix of math nodes, row sep=2em, column sep=2.5em]\n    { A & B \\\\\n      C & D \\\\};\n"
        "  \\draw[-{Stealth}] (m-1-1) -- node[above] {$f$} (m-1-2);\n"
        "  \\draw[-{Stealth}] (m-1-1) -- node[left] {$g$} (m-2-1);\n"
        "  \\draw[-{Stealth}] (m-1-2) -- node[right] {$h$} (m-2-2);\n"
        "  \\draw[-{Stealth}] (m-2-1) -- node[below] {$k$} (m-2-2);\n\\end{tikzpicture}",
    },
    {
        "id": "circuit",
        "label": "Circuit",
        "workspace": "tikz",
        "source": "\\usepackage{circuitikz}\n\\begin{circuitikz}[american]\n  \\draw (0,0) to[V, v=$V$] (0,2)\n"
        "        to[R, l=$R$] (3,2)\n        to[C, l=$C$] (3,0)\n        -- (0,0);\n\\end{circuitikz}",
    },
    {
        "id": "chemfig",
        "label": "Molecule",
        "workspace": "latex",
        "source": "\\usepackage{chemfig}\n\\chemfig{H-C(-[2]H)(-[6]H)-C(-[2]H)(-[6]H)-OH}",
    },
    {
        "id": "pgfplots",
        "label": "Plot",
        "workspace": "tikz",
        "source": "\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}\n\\begin{tikzpicture}\n"
        "\\begin{axis}[width=8cm, height=5cm, xlabel={$x$}, ylabel={$y$}, grid=major]\n"
        "  \\addplot[domain=-2:2, samples=80] {x^2};\n\\end{axis}\n\\end{tikzpicture}",
    },
]

TIKZ_LIBRARY_CHIPS = [
    ("arrows.meta", "\\usetikzlibrary{arrows.meta}"),
    ("positioning", "\\usetikzlibrary{positioning}"),
    ("calc", "\\usetikzlibrary{calc}"),
    ("matrix", "\\usetikzlibrary{matrix}"),
    ("shapes", "\\usetikzlibrary{shapes.geometric,shapes.symbols}"),
    ("fit", "\\usetikzlibrary{fit,backgrounds}"),
    ("decorations", "\\usetikzlibrary{decorations.pathmorphing,decorations.markings}"),
    ("intersections", "\\usetikzlibrary{intersections}"),
    ("patterns", "\\usetikzlibrary{patterns.meta}"),
    ("trees + mindmap", "\\usetikzlibrary{trees,mindmap}"),
    ("automata", "\\usetikzlibrary{automata}"),
    ("chains", "\\usetikzlibrary{chains}"),
    ("shadows", "\\usetikzlibrary{shadows}"),
    ("angles + quotes", "\\usetikzlibrary{angles,quotes}"),
    ("3d", "\\usetikzlibrary{3d}"),
    ("petri", "\\usetikzlibrary{petri}"),
    ("knots (spath3)", "\\usepackage{spath3}\\usetikzlibrary{knots}"),
    ("circuitikz", "\\usepackage{circuitikz}"),
    ("chemfig", "\\usepackage{chemfig}"),
    ("pgfplots", "\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}"),
    ("pgfplots fillbetween", "\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}\\usepgfplotslibrary{fillbetween}"),
    ("forest", "\\usepackage{forest}"),
    ("tikz-cd", "\\usepackage{tikz-cd}"),
    ("quantikz", "\\usepackage{quantikz}"),
    ("tikz-3dplot", "\\usepackage{tikz-3dplot}"),
    ("tikz-feynman", "\\usepackage{tikz-feynman}"),
    ("zx-calculus", "\\usepackage{zx-calculus}"),
    ("dynkin-diagrams", "\\usepackage{dynkin-diagrams}"),
    ("braids", "\\usepackage{braids}"),
    ("venndiagram", "\\usepackage{venndiagram}"),
    ("neuralnetwork", "\\usepackage{neuralnetwork}"),
    ("chronology", "\\usepackage{chronology}"),
    ("siunitx", "\\usepackage{siunitx}"),
    ("physics", "\\usepackage{physics}"),
]

TIKZ_TEMPLATES = [
    ("Blank canvas", "\\begin{tikzpicture}\n  % Draw here.\n\\end{tikzpicture}"),
    (
        "Labeled arrow",
        "\\usetikzlibrary{arrows.meta,positioning}\n\\begin{tikzpicture}[node distance=2.4cm]\n  \\node (a) {$A$};\n"
        "  \\node (b) [right=of a] {$B$};\n  \\draw[-{Stealth}] (a) -- node[above] {$f$} (b);\n\\end{tikzpicture}",
    ),
    (
        "Commutative square",
        "\\usetikzlibrary{arrows.meta,matrix}\n\\begin{tikzpicture}\n"
        "  \\matrix (m) [matrix of math nodes, row sep=2em, column sep=2.6em]\n    { A & B \\\\\n      C & D \\\\ };\n"
        "  \\draw[-{Stealth}] (m-1-1) -- node[above] {$f$} (m-1-2);\n"
        "  \\draw[-{Stealth}] (m-1-1) -- node[left] {$g$} (m-2-1);\n"
        "  \\draw[-{Stealth}] (m-1-2) -- node[right] {$h$} (m-2-2);\n"
        "  \\draw[-{Stealth}] (m-2-1) -- node[below] {$k$} (m-2-2);\n\\end{tikzpicture}",
    ),
    (
        "Flowchart",
        "\\usetikzlibrary{arrows.meta,positioning,shapes.geometric}\n"
        "\\begin{tikzpicture}[node distance=11mm, every node/.style={draw, rounded corners, minimum width=25mm, "
        "minimum height=8mm}]\n  \\node (start) {Start};\n  \\node (next) [below=of start] {Next step};\n"
        "  \\draw[-{Stealth}] (start) -- (next);\n\\end{tikzpicture}",
    ),
    (
        "tikz-cd diagram",
        "\\usepackage{tikz-cd}\n\\begin{tikzcd}\n  A \\arrow[r, \"f\"] \\arrow[d, \"g\"'] & B \\arrow[d, \"h\"] \\\\\n"
        "  C \\arrow[r, \"k\"'] & D\n\\end{tikzcd}",
    ),
    (
        "Automaton",
        "\\usetikzlibrary{automata,arrows.meta,positioning}\n"
        "\\begin{tikzpicture}[shorten >=1pt, node distance=2.4cm, on grid, >={Stealth}, auto]\n"
        "  \\node[state, initial] (q0) {$q_0$};\n  \\node[state, accepting] (q1) [right=of q0] {$q_1$};\n"
        "  \\path[->] (q0) edge [bend left] node {$a$} (q1)\n            (q1) edge [bend left] node {$b$} (q0)\n"
        "            (q1) edge [loop above] node {$a$} ();\n\\end{tikzpicture}",
    ),
    (
        "Mind map",
        "\\usetikzlibrary{mindmap}\n\\begin{tikzpicture}[mindmap, concept color=gray!40, every node/.style={concept}]\n"
        "  \\node {Topic}\n    child[grow=0] {node {Idea}}\n    child[grow=120] {node {Idea}}\n"
        "    child[grow=240] {node {Idea}};\n\\end{tikzpicture}",
    ),
    (
        "Tree (forest)",
        "\\usepackage{forest}\n\\begin{forest}\n  for tree={circle, draw, minimum size=7mm, l sep=8mm}\n"
        "  [$r$ [$a$ [$c$] [$d$]] [$b$]]\n\\end{forest}",
    ),
    (
        "Bar chart",
        "\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}\n\\begin{tikzpicture}\n"
        "\\begin{axis}[ybar, width=8cm, height=5cm, symbolic x coords={A,B,C,D}, xtick=data, ymin=0]\n"
        "  \\addplot coordinates {(A,3) (B,5) (C,2) (D,4)};\n\\end{axis}\n\\end{tikzpicture}",
    ),
    (
        "Shaded area",
        "\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}\\usepgfplotslibrary{fillbetween}\n\\begin{tikzpicture}\n"
        "\\begin{axis}[width=8cm, height=5cm, axis lines=middle, xlabel={$x$}, ylabel={$y$}, domain=0:3]\n"
        "  \\addplot[name path=f, thick] {x^2/3};\n  \\path[name path=axis] (axis cs:0,0) -- (axis cs:3,0);\n"
        "  \\addplot[gray!40] fill between[of=f and axis, soft clip={domain=1:2.5}];\n\\end{axis}\n\\end{tikzpicture}",
    ),
    (
        "Angle in a triangle",
        "\\usetikzlibrary{angles,quotes}\n\\begin{tikzpicture}\n"
        "  \\coordinate[label=left:$A$] (A) at (0,0);\n  \\coordinate[label=right:$B$] (B) at (4,0);\n"
        "  \\coordinate[label=above:$C$] (C) at (1,2.5);\n  \\draw (A) -- (B) -- (C) -- cycle;\n"
        "  \\pic[draw, \"$\\alpha$\", angle eccentricity=1.5] {angle=B--A--C};\n\\end{tikzpicture}",
    ),
    (
        "3D axes",
        "\\usepackage{tikz-3dplot}\n\\tdplotsetmaincoords{70}{110}\n\\begin{tikzpicture}[tdplot_main_coords, scale=2]\n"
        "  \\draw[->] (0,0,0) -- (1,0,0) node[anchor=north east] {$x$};\n"
        "  \\draw[->] (0,0,0) -- (0,1,0) node[anchor=north west] {$y$};\n"
        "  \\draw[->] (0,0,0) -- (0,0,1) node[anchor=south] {$z$};\n"
        "  \\draw[thick, ->] (0,0,0) -- (0.6,0.5,0.7) node[anchor=west] {$\\vec v$};\n\\end{tikzpicture}",
    ),
    (
        "Quantum circuit",
        "\\usepackage{quantikz}\n\\begin{quantikz}\n  \\lstick{$\\ket{0}$} & \\gate{H} & \\ctrl{1} & \\meter{} \\\\\n"
        "  \\lstick{$\\ket{0}$} & & \\targ{} & \\meter{}\n\\end{quantikz}",
    ),
    (
        "Feynman diagram",
        "% Manual vertex positions work with pdflatex; automatic layout needs lualatex.\n"
        "\\usepackage{tikz-feynman}\n\\begin{tikzpicture}\n\\begin{feynman}\n"
        "  \\vertex (a) at (0,1) {$e^-$};\n  \\vertex (b) at (0,-1) {$e^+$};\n"
        "  \\vertex (c) at (1.5,0);\n  \\vertex (d) at (3,0);\n"
        "  \\vertex (e) at (4.5,1) {$\\mu^-$};\n  \\vertex (f) at (4.5,-1) {$\\mu^+$};\n"
        "  \\diagram* {\n    (a) -- [fermion] (c) -- [fermion] (b),\n    (c) -- [photon, edge label=$\\gamma$] (d),\n"
        "    (f) -- [fermion] (d) -- [fermion] (e),\n  };\n\\end{feynman}\n\\end{tikzpicture}",
    ),
    (
        "Venn diagram",
        "\\usepackage{venndiagram}\n\\begin{venndiagram2sets}[labelA={$A$}, labelB={$B$}, shade=gray!40]\n"
        "  \\fillACapB\n\\end{venndiagram2sets}",
    ),
    (
        "Neural network",
        "\\usepackage{neuralnetwork}\n\\begin{neuralnetwork}[height=4]\n  \\inputlayer[count=3, bias=false]\n"
        "  \\hiddenlayer[count=4, bias=false] \\linklayers\n  \\outputlayer[count=2] \\linklayers\n\\end{neuralnetwork}",
    ),
    (
        "Timeline",
        "\\usepackage{chronology}\n\\begin{chronology}[10]{1900}{2000}{10cm}\n"
        "  \\event{1905}{Relativity}\n  \\event{1925}{Quantum mechanics}\n  \\event{1969}{Moon landing}\n"
        "\\end{chronology}",
    ),
    (
        "Braid",
        "\\usepackage{braids}\n\\begin{tikzpicture}\n  \\braid[number of strands=3, thick] s_1 s_2^{-1} s_1;\n"
        "\\end{tikzpicture}",
    ),
]


def snippets_for(workspace):
    return [s for s in SNIPPETS if s["workspace"] == workspace]


def insert_line(source, line):
    """Prepends a declaration once; duplicate clicks are ignored."""
    if line in source:
        return source
    return "%s\n%s" % (line, source) if source.strip() else line + "\n"

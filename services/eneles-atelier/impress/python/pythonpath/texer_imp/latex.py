"""LaTeX source handling. A direct port of the helpers in powerpoint/app/server.js.

Keep the regexes in step with server.js: a snippet that renders in
PowerPoint should render identically here.
"""

import re

from . import look

MAX_SOURCE_BYTES = 200 * 1024

_DANGEROUS = [
    re.compile(r"\\write18"),
    re.compile(r"\\immediate\s*\\write18"),
    re.compile(r"\\input\s*\{\s*\|"),
    re.compile(r'\\openin\s*[^=]*=\s*"?\s*\|'),
    re.compile(r"\\directlua"),
    re.compile(r"\\latelua"),
    re.compile(r"\\csname\s+write\\endcsname"),
]


def contains_dangerous_commands(content):
    return any(p.search(content or "") for p in _DANGEROUS)


_PREAMBLE_LINE = re.compile(
    r"^\\(usepackage|usetikzlibrary|pgfplotsset|tdplotsetmaincoords|tikzset|ctikzset|newcommand|"
    r"renewcommand|providecommand|DeclareMathOperator|newtheorem|theoremstyle|newlength|setlength|"
    r"definecolor|colorlet|newtcbox|newtcolorbox|tcbset|newenvironment|renewenvironment|title|author|"
    r"date|hypersetup|geometry)\b"
)


def _brace_delta(line):
    delta = 0
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == "\\":
            # Skip the escaped character, so \{ and \} don't count.
            i += 2
            continue
        if ch == "{":
            delta += 1
        elif ch == "}":
            delta -= 1
        i += 1
    return delta


_USEPACKAGE = re.compile(r"\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}")


def _has_package(name, *texts):
    """True when ``name`` is one of the packages loaded in any of ``texts``.

    Compares whole names from the comma list. A word-boundary regex (what
    powerpoint/ used) treats \\usepackage{tikz-3dplot} as loading "tikz", so tikz
    was never added and tikz-3dplot, which doesn't load it, failed.
    """
    for text in texts:
        for m in _USEPACKAGE.finditer(text or ""):
            if name in (p.strip() for p in m.group(1).split(",")):
                return True
    return False


def build_standalone_latex(source, preamble="", border="2pt", ink=None, font="cm", font_name=""):
    """Wraps a bare snippet in a standalone document.

    Package, macro, theorem, and TikZ setup lines at the top of a snippet are
    hoisted into the generated preamble, including multi-line definitions,
    so pasted theorem-box and TikZ setups work without manual moves. A source
    that already has \\documentclass is returned untouched: its author owns
    the colours and fonts, so the Look doesn't apply.

    ``ink`` sets the colour everything starts in. Text, TikZ strokes,
    chemfig, circuitikz and tikz-cd all inherit it; anything coloured
    explicitly keeps its own colour.
    """
    trimmed = (source or "").strip()
    if "\\documentclass" in trimmed:
        return trimmed

    out = ["\\documentclass[preview,border=%s]{standalone}" % (border or "2pt")]
    for pkg in ("tikz", "xcolor", "amsmath", "amssymb"):
        if not _has_package(pkg, trimmed, preamble):
            out.append("\\usepackage{%s}" % pkg)
    out.extend(look.preamble_lines(ink, font, font_name))

    body = []
    collecting = False
    open_braces = 0
    for raw in trimmed.split("\n"):
        line = raw.strip()
        if collecting:
            out.append(raw)
            open_braces += _brace_delta(raw)
            if open_braces <= 0:
                collecting = False
        elif _PREAMBLE_LINE.match(line):
            out.append(raw)
            open_braces = _brace_delta(raw)
            collecting = open_braces > 0
        else:
            body.append(raw)

    for raw in (preamble or "").split("\n"):
        if raw.strip():
            out.append(raw.strip())

    start = "\\color{texerInk}\n" if ink else ""
    return "%s\n\n\\begin{document}\n%s%s\n\\end{document}" % ("\n".join(out), start, "\n".join(body))


def wrap_math(source, display=True):
    """Turns a Math-workspace expression into a snippet for build_standalone_latex.

    powerpoint/ renders these with MathJax when the font is the default. Here they
    always go through real TeX, so the expression is placed in display (or
    inline) math. The ink comes from the Look, like every other workspace.
    """
    expr = (source or "").strip()
    # Already delimited by the user: leave the delimiters alone.
    if re.match(r"^(\$|\\\[|\\\(|\\begin\{(equation|align|gather|multline)\*?\})", expr):
        return expr
    if display:
        return "$\\displaystyle %s$" % expr
    return "$%s$" % expr


normalize_hex = look.normalize_hex


_FULL_HINT = re.compile(
    r"\\begin\{(tikzpicture|circuitikz|chemfig|forest|axis)\}|\\documentclass|\\usepackage\{|"
    r"\\usetikzlibrary|\\tikzset|\\draw\b|\\node\b"
)
_TIKZ_HINT = re.compile(r"\\begin\{tikzpicture\}|\\tikz(?:set|picture)?\b|\\draw\b|\\node\b")


def looks_like_full_latex(source):
    """True when the source is a document/diagram, not a bare math expression."""
    return bool(_FULL_HINT.search(source or ""))


def looks_like_tikz(source):
    return bool(_TIKZ_HINT.search(source or ""))


_ERROR_PATTERNS = [
    re.compile(r"^!"),
    re.compile(r"^\./.*:\d+:"),
    re.compile(r"^[^\s:]+\.tex:\d+:"),
    re.compile(r"LaTeX Error", re.I),
    re.compile(r"Package .* Error", re.I),
    re.compile(r"File .* not found", re.I),
    re.compile(r"Emergency stop|Fatal error", re.I),
]
_LINE_REF = re.compile(r"^l\.\d+")


def extract_errors(log):
    errors = []
    for raw in (log or "").split("\n"):
        t = raw.strip()
        if not t:
            continue
        if any(p.search(t) for p in _ERROR_PATTERNS) or (_LINE_REF.match(t) and len(t) < 120):
            if t not in errors:
                errors.append(t)
    return errors

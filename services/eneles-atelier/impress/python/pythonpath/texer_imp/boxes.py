"""Theorem-style box builder. Port of buildBoxSource in powerpoint/ (keep the two
in step with powerpoint/src/core/boxes.ts).

The label is free text ("Conjecture", "Claim", anything). The built-in
presets are just quick picks for a label + accent; users can save their
own presets (label, style, accent, fill) in the library.
"""

from . import look
from .look import normalize_hex

# label -> default accent
BUILTIN_PRESETS = (
    ("Theorem", "222B82"),
    ("Lemma", "A5410D"),
    ("Proposition", "222B82"),
    ("Corollary", "39558B"),
    ("Definition", "17636C"),
    ("Conjecture", "7A2E8A"),
    ("Claim", "8A5A00"),
    ("Axiom", "1F5F99"),
    ("Remark", "5A6270"),
    ("Example", "366D43"),
    ("Note", "5A6270"),
)
BOX_TYPES = tuple(p[0] for p in BUILTIN_PRESETS)
BOX_ACCENTS = dict(BUILTIN_PRESETS)
DEFAULT_ACCENT = "222B82"

STYLES = (
    ("bar", "Left bar"),
    ("frame", "Frame"),
    ("rounded", "Rounded"),
    ("titlebar", "Title bar"),
    ("plain", "Plain"),
)
STYLE_IDS = tuple(s[0] for s in STYLES)

# "%" is a percentage of the *slide* width, not of \linewidth as in the
# first powerpoint/ version. Boxes are inserted at the same Size % as equations, so
# their text matches; the TeX width is worked back from where the box lands.
WIDTH_UNITS = ("%", "cm", "mm", "in", "pt")
WIDTH_UNIT_LABELS = ("% of slide", "cm", "mm", "in", "pt")
MIN_BOX_PERCENT = 5
MAX_BOX_PERCENT = 100
FILL_WEIGHT = 0.90  # how far the fill is mixed from the accent toward the paper


def _clamp(value, lo, hi, fallback):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return fallback
    if v != v:  # NaN
        return fallback
    return min(hi, max(lo, v))


def _trim(value):
    return ("%.4f" % value).rstrip("0").rstrip(".")


def default_accent(label):
    return BOX_ACCENTS.get((label or "").strip(), DEFAULT_ACCENT)


def slide_width_inches(width, unit, slide_width_in):
    """Where the box should land on the slide, in inches."""
    try:
        raw = float(width)
    except (TypeError, ValueError):
        raw = 0
    if raw <= 0:
        raw, unit = 60, "%"
    return {
        "mm": raw / 25.4,
        "cm": raw / 2.54,
        "in": raw,
        "pt": raw / 72.0,
    }.get(unit, slide_width_in * _clamp(raw, MIN_BOX_PERCENT, MAX_BOX_PERCENT, 60) / 100.0)


def width_expression(width, unit, slide_width_in=11.02, size_percent=250):
    """TeX dimension for the minipage, so that the box lands at the requested
    slide width once inserted at size_percent of its natural size."""
    scale = max(0.1, float(size_percent or 100) / 100.0)
    return "%sin" % _trim(slide_width_inches(width, unit, slide_width_in) / scale)


def colors(accent, fill, paper):
    """(accent, fill, title-bar text) actually used, all 6-digit hex.

    The accent is nudged until it reads on the paper, so a navy Theorem
    still works on a dark slide. An empty fill means "tint of the accent
    toward the paper", which is near-white on a light slide and a dark
    tint on a dark one.
    """
    paper = normalize_hex(paper, "FFFFFF")
    a = look.readable_on(normalize_hex(accent, DEFAULT_ACCENT), paper)
    f = normalize_hex(fill) or look.mix(a, paper, FILL_WEIGHT)
    return a, f, look.text_on(a)


def heading_text(label, number, title):
    head = " ".join(x for x in ((label or "").strip(), (number or "").strip()) if x)
    title = (title or "").strip()
    return head, title


def build_box_source(label="Theorem", number="1", title="", content="", width=60, unit="%",
                     style="bar", accent=None, fill=None, paper="#FFFFFF",
                     slide_width_in=11.02, size_percent=250):
    style = style if style in STYLE_IDS else "bar"
    label = (label or "").strip() or "Theorem"
    accent_hex, fill_hex, title_text = colors(accent or default_accent(label), fill, paper)
    head, title = heading_text(label, number, title)

    options = [
        "  enhanced,",
        "  colback=texerBoxBackground,",
        "  coltext=texerInk,",
        "  width=\\linewidth,",
        "  left=4mm, right=4mm, top=3.2mm, bottom=3.2mm,",
        "  before skip=0pt, after skip=0pt,",
    ]
    body_heading = True
    if style == "bar":
        options += ["  frame hidden,", "  sharp corners,", "  borderline west={1.25mm}{0pt}{texerBoxAccent},"]
    elif style == "frame":
        options += ["  sharp corners,", "  colframe=texerBoxAccent,", "  boxrule=0.5mm,"]
    elif style == "rounded":
        options += ["  arc=2.5mm,", "  colframe=texerBoxAccent,", "  boxrule=0.5mm,"]
    elif style == "titlebar":
        options += [
            "  sharp corners,",
            "  colframe=texerBoxAccent,",
            "  colbacktitle=texerBoxAccent,",
            "  coltitle=texerBoxTitleText,",
            "  boxrule=0.5mm,",
            "  fonttitle=\\bfseries,",
            "  title={%s%s}," % (head, (": " + title) if title else ""),
        ]
        body_heading = False
    else:  # plain
        options += ["  frame hidden,", "  sharp corners,"]

    lines = [
        "\\usepackage[most]{tcolorbox}",
        # The Look normally defines texerInk; this keeps a pasted box
        # compiling on its own too.
        "\\providecolor{texerInk}{HTML}{171717}",
        "\\definecolor{texerBoxAccent}{HTML}{%s}" % accent_hex,
        "\\definecolor{texerBoxBackground}{HTML}{%s}" % fill_hex,
        "\\definecolor{texerBoxTitleText}{HTML}{%s}" % title_text,
        # The tcolorbox sits in a minipage of the requested width and is sized
        # to \linewidth inside it; otherwise standalone's preview crop measures
        # the full-width paragraph and every box comes out the same width.
        "\\begin{minipage}{%s}" % width_expression(width, unit, slide_width_in, size_percent),
        "\\begin{tcolorbox}[",
    ] + options + ["]"]
    if body_heading:
        heading = "{\\color{texerBoxAccent}\\bfseries %s}" % head
        if title:
            heading += " {\\color{texerBoxAccent}%s}" % title
        lines.append("%s\\\\[1.2mm]" % heading)
    lines += [
        (content or "").strip() or "% Write the statement here. Inline math such as $f\\colon A \\to B$ is supported.",
        "\\end{tcolorbox}",
        "\\end{minipage}",
    ]
    return "\n".join(lines)


def build_from_fields(fields, paper, slide_width_in, size_percent):
    """build_box_source from the dict stored in an object's metadata."""
    return build_box_source(
        fields.get("label") or fields.get("type") or "Theorem",
        fields.get("number", ""),
        fields.get("title", ""),
        fields.get("content", ""),
        fields.get("width", 60),
        fields.get("unit", "%"),
        fields.get("style", "bar"),
        fields.get("accent"),
        fields.get("fill"),
        paper,
        slide_width_in,
        size_percent,
    )


def next_number(existing_numbers):
    """The number after the highest numeric one already used (1 if none)."""
    best = 0
    for n in existing_numbers:
        try:
            best = max(best, int(str(n).strip()))
        except ValueError:
            pass
    return str(best + 1)

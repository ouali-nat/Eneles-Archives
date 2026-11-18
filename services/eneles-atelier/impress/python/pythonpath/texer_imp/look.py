"""The global Look: slide preset, ink, paper and font.

One set of colours for every workspace. powerpoint/ used to tie the ink to the
task pane's own light/dark theme and only applied it in the Math tab, so
TikZ and boxes were always black and toggling the pane theme silently
recoloured equations. Here the Look is about the *slide*, never the window.

Keep this in step with powerpoint/src/core/look.ts.
"""

import re

PRESETS = {
    # name: (ink, paper)
    "light": ("#171717", "#FFFFFF"),
    "dark": ("#F5F5F5", "#1F1F1F"),
}
PRESET_LABELS = (("light", "Light slide"), ("dark", "Dark slide"), ("custom", "Custom"))

# id, label, preamble lines, needs a Unicode engine (xelatex/lualatex)
FONTS = (
    ("cm", "Computer Modern (default)", (), False),
    ("lm", "Latin Modern", ("\\usepackage[T1]{fontenc}", "\\usepackage{lmodern}"), False),
    ("palatino", "Palatino", ("\\usepackage{newpxtext,newpxmath}",), False),
    ("times", "Times", ("\\usepackage{newtxtext,newtxmath}",), False),
    ("libertine", "Libertine", ("\\usepackage{libertine}", "\\usepackage[libertine]{newtxmath}"), False),
    ("sans", "Sans serif", ("\\usepackage{sansmathfonts}", "\\renewcommand{\\familydefault}{\\sfdefault}"), False),
    ("system", "System font...", None, True),
)
FONT_IDS = tuple(f[0] for f in FONTS)


def normalize_hex(value, fallback=None):
    m = re.match(r"^#?([0-9a-fA-F]{6})$", (value or "").strip())
    return m.group(1).upper() if m else fallback


def _rgb(hex6):
    return tuple(int(hex6[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, weight):
    """a moved ``weight`` of the way toward b. Hex in, 6-digit hex out."""
    ra, rb = _rgb(normalize_hex(a, "000000")), _rgb(normalize_hex(b, "FFFFFF"))
    return "".join("%02X" % int(round(x + (y - x) * weight)) for x, y in zip(ra, rb))


def luminance(hex_value):
    def channel(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(c) for c in _rgb(normalize_hex(hex_value, "000000")))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def is_dark(hex_value):
    return luminance(hex_value) < 0.18


def readable_on(color, paper, minimum=3.0):
    """``color`` nudged toward white or black until it reads on ``paper``.

    A navy theorem accent is fine on a white slide and invisible on a dark
    one; this keeps the hue and fixes the contrast.
    """
    target = "FFFFFF" if is_dark(paper) else "000000"
    c = normalize_hex(color, "000000")
    for step in range(11):
        candidate = mix(c, target, step / 10.0)
        if contrast(candidate, paper) >= minimum:
            return candidate
    return target


def text_on(fill):
    """Black or white, whichever reads better on ``fill`` (title bars)."""
    return "FFFFFF" if contrast("FFFFFF", fill) >= contrast("111111", fill) else "111111"


def resolve(settings):
    """(ink, paper) as 6-digit hex for the current preset."""
    preset = settings.get("slidePreset", "light")
    if preset in PRESETS:
        ink, paper = PRESETS[preset]
    else:
        ink, paper = settings.get("ink"), settings.get("paper")
    return normalize_hex(ink, "171717"), normalize_hex(paper, "FFFFFF")


def font_lines(font, font_name=""):
    """Preamble lines for a font choice. Unknown ids fall back to the default."""
    for fid, _label, lines, _unicode in FONTS:
        if fid != font:
            continue
        if fid == "system":
            name = re.sub(r"[{}\\%#$&^_~]", "", (font_name or "").strip())
            if not name:
                return ()
            # mathastext makes math letters and digits use the text font,
            # which is the point of picking the slide's font.
            return ("\\usepackage{fontspec}", "\\setmainfont{%s}" % name, "\\setsansfont{%s}" % name,
                    "\\usepackage[italic]{mathastext}")
        return lines
    return ()


def needs_unicode_engine(font, font_name=""):
    return font == "system" and bool((font_name or "").strip())


def preamble_lines(ink=None, font="cm", font_name=""):
    """Everything the Look adds to a wrapped snippet's preamble."""
    lines = list(font_lines(font, font_name))
    if ink:
        lines.append("\\definecolor{texerInk}{HTML}{%s}" % normalize_hex(ink, "171717"))
        # pgfplots draws its axis frame and ticks in hard-coded black, so the
        # ink alone would leave a black frame around an otherwise white plot.
        lines.append("\\AtBeginDocument{\\ifdefined\\pgfplotsset\\pgfplotsset{every axis/.append style="
                     "{axis line style={texerInk},tick style={texerInk}}}\\fi}")
    return lines

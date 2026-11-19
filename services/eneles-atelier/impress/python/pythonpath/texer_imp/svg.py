"""SVG size parsing.

powerpoint/'s svg-utils.ts mostly exists to flatten SVG for PowerPoint's fussy
importer. LibreOffice paints dvisvgm/pdftocairo output as-is, so all that
survives here is reading the natural size TeX produced.
"""

import re

_UNIT_TO_PT = {
    "pt": 1.0,
    "px": 0.75,  # CSS px, 96/in
    "": 0.75,
    "in": 72.0,
    "cm": 72.0 / 2.54,
    "mm": 72.0 / 25.4,
    "bp": 72.0 / 72.0,
    "pc": 12.0,
}

PT_TO_HMM = 2540.0 / 72.0  # 1/100 mm per point


def _root_tag(svg_text):
    m = re.search(r"<svg\b[^>]*>", svg_text or "", re.S)
    return m.group(0) if m else ""


def _length_pt(tag, name):
    m = re.search(r'\s%s\s*=\s*["\']\s*([\d.]+)\s*([a-z]*)\s*["\']' % name, tag, re.I)
    if not m:
        return None
    unit = m.group(2).lower()
    if unit not in _UNIT_TO_PT:
        return None
    return float(m.group(1)) * _UNIT_TO_PT[unit]


def natural_size_pt(svg_text):
    """(width_pt, height_pt) of the SVG as TeX laid it out.

    dvisvgm and pdftocairo both write width/height in pt. Falls back to the
    viewBox (interpreted as pt, which is what both tools use for user units).
    """
    tag = _root_tag(svg_text)
    w = _length_pt(tag, "width")
    h = _length_pt(tag, "height")
    if w and h:
        return w, h
    m = re.search(r'viewBox\s*=\s*["\']([^"\']+)["\']', tag, re.I)
    if m:
        parts = [float(x) for x in re.split(r"[\s,]+", m.group(1).strip()) if x]
        if len(parts) == 4 and parts[2] > 0 and parts[3] > 0:
            return parts[2], parts[3]
    return 100.0, 100.0


def pdf_size_pt(pdf_bytes):
    """First page MediaBox size of a PDF, enough for standalone's one-page output."""
    m = re.search(rb"/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]", pdf_bytes or b"")
    if not m:
        return 100.0, 100.0
    x0, y0, x1, y1 = (float(v) for v in m.groups())
    return abs(x1 - x0) or 100.0, abs(y1 - y0) or 100.0

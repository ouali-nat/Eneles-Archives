"""UNO side of inserting a render. Replaces powerpoint/src/core/office-insert.ts.

PowerPoint only offers "put this picture at the selection". Here the shape
is created directly on the current draw page, so it can also be tagged with
its LaTeX source and later replaced in place, which is how re-editing works.
"""

import json

import uno
import unohelper
from com.sun.star.awt import Point, Size
from com.sun.star.io import XInputStream, XSeekable

from .svg import PT_TO_HMM

TAG_TITLE = "TeXeR"
# Kept in the shape's UserDefinedAttributes, which ODF stores as a foreign
# attribute and round-trips through save/reload. The export only writes
# attributes with a prefix and namespace, hence "texer:meta".
META_ATTR = "texer:meta"
META_NAMESPACE = "urn:texer:imp:1"


class _BytesInputStream(unohelper.Base, XInputStream, XSeekable):
    """Feeds raw bytes to GraphicProvider without a temp file."""

    def __init__(self, data):
        self._data = data
        self._pos = 0

    def readBytes(self, _ignored, count):
        chunk = self._data[self._pos:self._pos + count]
        self._pos += len(chunk)
        return len(chunk), uno.ByteSequence(chunk)

    def readSomeBytes(self, ignored, count):
        return self.readBytes(ignored, count)

    def skipBytes(self, count):
        self._pos = min(len(self._data), self._pos + count)

    def available(self):
        return len(self._data) - self._pos

    def closeInput(self):
        pass

    def seek(self, pos):
        self._pos = max(0, min(len(self._data), pos))

    def getPosition(self):
        return self._pos

    def getLength(self):
        return len(self._data)


def _prop(name, value):
    p = uno.createUnoStruct("com.sun.star.beans.PropertyValue")
    p.Name = name
    p.Value = value
    return p


def load_graphic(ctx, data, mime):
    """bytes -> XGraphic. SVG stays a vector; PDF becomes LibreOffice's PDF graphic."""
    provider = ctx.ServiceManager.createInstanceWithContext("com.sun.star.graphic.GraphicProvider", ctx)
    graphic = provider.queryGraphic((
        _prop("InputStream", _BytesInputStream(data)),
        _prop("MimeType", mime),
    ))
    if graphic is None:
        raise RuntimeError("LibreOffice could not read the rendered %s." % mime)
    return graphic


def is_draw_like(doc):
    return doc is not None and (
        doc.supportsService("com.sun.star.presentation.PresentationDocument")
        or doc.supportsService("com.sun.star.drawing.DrawingDocument")
    )


def current_page(doc):
    return doc.getCurrentController().getCurrentPage()


def _single_selected_shape(doc):
    try:
        sel = doc.getCurrentController().getSelection()
    except Exception:
        return None
    if sel is None:
        return None
    if hasattr(sel, "getCount"):
        if sel.getCount() != 1:
            return None
        sel = sel.getByIndex(0)
    return sel if hasattr(sel, "supportsService") and sel.supportsService("com.sun.star.drawing.Shape") else None


def read_meta(shape):
    """The metadata dict a TeXeR shape was tagged with, or None for any other shape."""
    if shape is None:
        return None
    try:
        attrs = shape.UserDefinedAttributes
        if attrs is not None and attrs.hasByName(META_ATTR):
            return json.loads(attrs.getByName(META_ATTR).Value)
    except Exception:
        pass
    # Fallback for a file whose attributes were stripped by another app:
    # the source is still the alt text and the workspace is in the name.
    try:
        if shape.Title == TAG_TITLE and shape.Description:
            meta = {"source": shape.Description}
            parts = (shape.Name or "").split()
            if len(parts) == 2 and parts[0] == TAG_TITLE:
                meta["workspace"] = parts[1]
            return meta
    except Exception:
        pass
    return None


def selected_texer_shape(doc):
    """(shape, meta) when exactly one TeXeR shape is selected, else (None, None)."""
    if not is_draw_like(doc):
        return None, None
    shape = _single_selected_shape(doc)
    meta = read_meta(shape)
    return (shape, meta) if meta else (None, None)


def _tag(shape, meta):
    shape.Title = TAG_TITLE
    shape.Description = meta.get("source", "")
    shape.Name = "TeXeR %s" % meta.get("workspace", "")
    try:
        attrs = shape.UserDefinedAttributes
        data = uno.createUnoStruct("com.sun.star.xml.AttributeData")
        data.Type = "CDATA"
        data.Value = json.dumps(meta, separators=(",", ":"))
        data.Namespace = META_NAMESPACE
        if attrs.hasByName(META_ATTR):
            attrs.replaceByName(META_ATTR, data)
        else:
            attrs.insertByName(META_ATTR, data)
        shape.UserDefinedAttributes = attrs
    except Exception:
        pass  # Title/Description still let read_meta recover the source.


def size_from_pt(width_pt, height_pt, settings, target_width_in=None):
    """Shape size in 1/100 mm.

    Default ("natural"): TeX's own size x sizePercent, so equations stay
    consistent with each other. "width" mode, and Boxes (target_width_in),
    pin the width like powerpoint/ does.
    """
    if target_width_in is None and settings.get("sizeMode") == "width":
        target_width_in = float(settings.get("insertWidthIn") or 3)
    if target_width_in:
        w = target_width_in * 72.0 * PT_TO_HMM
        h = w * (height_pt / width_pt if width_pt else 1)
    else:
        factor = float(settings.get("sizePercent") or 100) / 100.0
        w = width_pt * PT_TO_HMM * factor
        h = height_pt * PT_TO_HMM * factor
    return max(1, int(round(w))), max(1, int(round(h)))


def _page_of(shape):
    """The draw page a shape lives on (it may not be the current slide)."""
    try:
        parent = shape.getParent()
        if parent is not None and hasattr(parent, "getCount"):
            return parent
    except Exception:
        pass
    return None


def all_texer_shapes(doc):
    """[(page, shape, meta)] for every TeXeR object, slide by slide."""
    out = []
    pages = doc.getDrawPages()
    for p in range(pages.getCount()):
        page = pages.getByIndex(p)
        for i in range(page.getCount()):
            shape = page.getByIndex(i)
            meta = read_meta(shape)
            if meta:
                out.append((page, shape, meta))
    return out


def box_numbers(doc, label, exclude=None):
    """Numbers already used by boxes with this label, anywhere in the document."""
    numbers = []
    for _page, shape, meta in all_texer_shapes(doc):
        box = meta.get("box")
        if exclude is not None and shape == exclude:
            continue
        if meta.get("workspace") == "boxes" and isinstance(box, dict) and box.get("label") == label:
            numbers.append(box.get("number", ""))
    return numbers


def export_png(ctx, graphic, path, width_px):
    """Writes the graphic as a PNG ``width_px`` wide, using LibreOffice's own renderer."""
    filter_ = ctx.ServiceManager.createInstanceWithContext("com.sun.star.drawing.GraphicExportFilter", ctx)
    desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
    # The export filter works on shapes, so draw the graphic into a hidden
    # scratch Draw document at a size giving the requested pixel width.
    doc = desktop.loadComponentFromURL("private:factory/sdraw", "_blank", 0, (_prop("Hidden", True),))
    try:
        page = doc.getDrawPages().getByIndex(0)
        shape = doc.createInstance("com.sun.star.drawing.GraphicObjectShape")
        page.add(shape)
        shape.Graphic = graphic
        size = graphic.Size100thMM if hasattr(graphic, "Size100thMM") else None
        w = size.Width if size and size.Width > 0 else 10000
        h = size.Height if size and size.Height > 0 else 10000
        shape.setSize(Size(w, h))
        filter_.setSourceDocument(shape)
        data = uno.Any("[]com.sun.star.beans.PropertyValue", (
            _prop("PixelWidth", int(width_px)),
            _prop("PixelHeight", int(round(width_px * h / float(w)))),
        ))
        uno.invoke(filter_, "filter", ((
            _prop("URL", uno.systemPathToFileUrl(path)),
            _prop("MediaType", "image/png"),
            _prop("FilterData", data),
        ),))
    finally:
        doc.close(True)


CASCADE_HMM = 500  # 5 mm


def _free_centred_position(page, width, height):
    """Top-left for a new shape centred on the slide, nudged down-right
    while another shape already sits at that centre. Without this, a run of
    inserts stacks exactly on top of each other and hides the earlier ones."""
    centres = set()
    for i in range(page.getCount()):
        try:
            s = page.getByIndex(i)
            p, z = s.getPosition(), s.getSize()
            centres.add(((p.X + z.Width // 2) // 100, (p.Y + z.Height // 2) // 100))  # 1 mm grid
        except Exception:
            pass
    cx, cy = page.Width // 2, page.Height // 2
    for _ in range(20):
        if (cx // 100, cy // 100) not in centres:
            break
        cx += CASCADE_HMM
        cy += CASCADE_HMM
    return max(0, cx - width // 2), max(0, cy - height // 2)


def insert_or_replace(doc, graphic, size_hmm, meta, replace=None, select=True):
    """Puts the graphic on the current slide, centred, or swaps it into ``replace``.

    Replacing keeps the old shape's position and the ratio by which the
    user resized it by hand, so a tweak to the source doesn't undo layout work.
    """
    width, height = size_hmm
    page = _page_of(replace) if replace is not None else None
    page = page or current_page(doc)
    shape = doc.createInstance("com.sun.star.drawing.GraphicObjectShape")

    if replace is not None:
        old_pos = replace.getPosition()
        old_size = replace.getSize()
        old_meta = read_meta(replace) or {}
        old_w = old_meta.get("insertedWidth")
        if old_w:
            ratio = old_size.Width / float(old_w)
            width, height = int(round(width * ratio)), int(round(height * ratio))
        meta["insertedWidth"] = size_hmm[0]
        page.add(shape)
        shape.Graphic = graphic
        shape.setSize(Size(width, height))
        shape.setPosition(Point(old_pos.X, old_pos.Y))
        page.remove(replace)
    else:
        meta["insertedWidth"] = width
        x, y = _free_centred_position(page, width, height)
        page.add(shape)
        shape.Graphic = graphic
        shape.setSize(Size(width, height))
        shape.setPosition(Point(x, y))

    _tag(shape, meta)
    if replace is not None and select:
        # Keep editing the same object: tweak, Replace, tweak, Replace.
        # A fresh insert is deliberately left unselected; otherwise the
        # window flips to "Replace selected" and the next equation typed
        # would overwrite this one instead of being added beside it.
        try:
            doc.getCurrentController().select(shape)
        except Exception:
            pass
    return shape

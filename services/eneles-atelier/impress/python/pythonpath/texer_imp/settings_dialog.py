"""Modal Settings dialog. The Settings tab of powerpoint/'s task pane, plus the
backend choice that only exists here (local TeX vs. the helper).

The Look (slide preset, ink, paper, font) lives in the main window, because
it's used all the time; this dialog holds the rarely-touched things.
"""

import traceback

import uno
import unohelper
from com.sun.star.awt import XActionListener

from . import backend

BACKENDS = (("auto", "Automatic"), ("direct", "Local TeX only"), ("helper", "Helper only (snap/flatpak)"))
SIZE_MODES = (("natural", "TeX size x Size %"), ("width", "Fixed width"))
FONT_MODES = (("path", "Outlines"), ("embed", "WOFF fonts"))


class _Action(unohelper.Base, XActionListener):
    def __init__(self, fn):
        self.fn = fn

    def actionPerformed(self, ev):
        try:
            self.fn()
        except Exception:
            traceback.print_exc()

    def disposing(self, ev):
        pass


def _parse_float(text, fallback):
    try:
        return float(str(text).strip().replace(",", "."))
    except ValueError:
        return fallback


def run_settings_dialog(ctx, parent_peer, settings, store=None):
    """Shows the dialog; returns the updated settings dict, or None on Cancel.
    Deleting a box preset (via ``store``) takes effect immediately."""
    smgr = ctx.ServiceManager
    dm = smgr.createInstanceWithContext("com.sun.star.awt.UnoControlDialogModel", ctx)
    dm.Width, dm.Height, dm.Title = 260, 296, "TeXeR Settings"

    def add(kind, name, x, y, w, h, **props):
        m = dm.createInstance("com.sun.star.awt.UnoControl%sModel" % kind)
        m.Name = name
        m.PositionX, m.PositionY, m.Width, m.Height = x, y, w, h
        for k, v in props.items():
            setattr(m, k, v)
        dm.insertByName(name, m)
        return m

    def label(name, y, text):
        add("FixedText", name, 6, y + 3, 76, 10, Label=text)

    y = 6
    label("pre_lbl", y, "Extra preamble")
    add("Edit", "preamble", 84, y, 170, 36, MultiLine=True, VScroll=True, Text=settings["extraPreamble"],
        HelpText="Added to every render, e.g. \\usetikzlibrary{arrows.meta} or your macros")
    y += 42
    label("border_lbl", y, "Crop border")
    add("Edit", "border", 84, y, 50, 14, Text=settings["border"])
    y += 18
    label("font_lbl", y, "SVG fonts")
    add("ListBox", "fontmode", 84, y, 80, 14, Dropdown=True, StringItemList=tuple(v for _, v in FONT_MODES))
    y += 18
    label("sysfont_lbl", y, "System font name")
    add("Edit", "sysfont", 84, y, 130, 14, Text=settings.get("fontName", ""),
        HelpText="Used when Font is “System font” (compiled with XeLaTeX)")
    y += 22
    label("sizing_lbl", y, "Sizing")
    add("ListBox", "sizemode", 84, y, 100, 14, Dropdown=True, StringItemList=tuple(v for _, v in SIZE_MODES))
    y += 18
    label("width_lbl", y, "Fixed width (in)")
    add("Edit", "width", 84, y, 50, 14, Text=str(settings["insertWidthIn"]))
    y += 22
    label("backend_lbl", y, "Compile with")
    add("ListBox", "backend", 84, y, 120, 14, Dropdown=True, StringItemList=tuple(v for _, v in BACKENDS))
    y += 18
    label("bin_lbl", y, "TeX bin folder")
    add("Edit", "bindir", 84, y, 130, 14, Text=settings["texBinDir"], HelpText="Only if pdflatex isn't found automatically")
    add("Button", "browse", 216, y, 38, 14, Label="Browse...")
    y += 18
    label("helper_lbl", y, "Helper URL")
    add("Edit", "helper", 84, y, 130, 14, Text=settings["helperUrl"])
    y += 18
    add("Button", "check", 84, y, 70, 14, Label="Check TeX")
    add("FixedText", "check_status", 6, y + 17, 248, 20, MultiLine=True)
    y += 40
    label("presets_lbl", y, "Box presets")
    presets = store.load_box_presets() if store else []
    add("ListBox", "presets", 84, y, 130, 14, Dropdown=True,
        StringItemList=tuple(p["name"] for p in presets) or ("(none saved)",))
    add("Button", "preset_del", 216, y, 38, 14, Label="Delete", Enabled=bool(presets))
    add("Button", "ok", 150, 276, 50, 14, Label="OK", PushButtonType=1, DefaultButton=True)
    add("Button", "cancel", 204, 276, 50, 14, Label="Cancel", PushButtonType=2)

    def select(name, pairs, value):
        keys = [k for k, _ in pairs]
        dm.getByName(name).SelectedItems = (keys.index(value) if value in keys else 0,)

    def selected(name, pairs):
        sel = dm.getByName(name).SelectedItems
        return pairs[sel[0]][0] if sel else pairs[0][0]

    select("fontmode", FONT_MODES, settings["fontMode"])
    select("sizemode", SIZE_MODES, settings["sizeMode"])
    select("backend", BACKENDS, settings["backend"])
    if presets:
        dm.getByName("presets").SelectedItems = (0,)

    dlg = smgr.createInstanceWithContext("com.sun.star.awt.UnoControlDialog", ctx)
    dlg.setModel(dm)
    toolkit = smgr.createInstanceWithContext("com.sun.star.awt.Toolkit", ctx)
    dlg.createPeer(toolkit, parent_peer)

    def collect():
        out = dict(settings)
        out["extraPreamble"] = dm.getByName("preamble").Text
        out["border"] = dm.getByName("border").Text.strip() or "2pt"
        out["fontMode"] = selected("fontmode", FONT_MODES)
        out["fontName"] = dm.getByName("sysfont").Text.strip()
        if out.get("font") == "system" and not out["fontName"]:
            out["font"] = "cm"  # no name, no system font
        out["sizeMode"] = selected("sizemode", SIZE_MODES)
        out["insertWidthIn"] = min(40.0, max(0.25, _parse_float(dm.getByName("width").Text, settings["insertWidthIn"])))
        out["backend"] = selected("backend", BACKENDS)
        out["texBinDir"] = dm.getByName("bindir").Text.strip()
        out["helperUrl"] = dm.getByName("helper").Text.strip() or "http://127.0.0.1:47823"
        return out

    def check():
        status = dm.getByName("check_status")
        status.Label = "Checking..."
        st = backend.status(collect())
        status.Label = st["message"]
        status.TextColor = 0x2E7D32 if st["backend"] else 0xC0392B

    def browse():
        picker = smgr.createInstanceWithContext("com.sun.star.ui.dialogs.FolderPicker", ctx)
        if picker.execute() == 1:
            dm.getByName("bindir").Text = uno.fileUrlToSystemPath(picker.getDirectory())

    def delete_preset():
        sel = dm.getByName("presets").SelectedItems
        names = list(dm.getByName("presets").StringItemList)
        if not store or not sel or not presets:
            return
        remaining = store.remove_box_preset(names[sel[0]])
        dm.getByName("presets").StringItemList = tuple(p["name"] for p in remaining) or ("(none saved)",)
        dm.getByName("presets").SelectedItems = (0,)
        dm.getByName("preset_del").Enabled = bool(remaining)
        del presets[:]
        presets.extend(remaining)

    dlg.getControl("check").addActionListener(_Action(check))
    dlg.getControl("browse").addActionListener(_Action(browse))
    dlg.getControl("preset_del").addActionListener(_Action(delete_preset))

    try:
        if dlg.execute() == 1:
            return collect()
        return None
    finally:
        dlg.dispose()

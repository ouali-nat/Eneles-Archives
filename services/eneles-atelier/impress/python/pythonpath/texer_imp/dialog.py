"""The TeXeR window: a non-modal UNO dialog. Replaces powerpoint/src/taskpane/.

Layout, in dialog units (left column = editing, right column = output):

    [Math][LaTeX][Boxes][TikZ]                 | status pill
    [Examples v]          [Save snippet...]    | Preview
    Source (multi-line)                        | [ image on the paper colour ]
    workspace tools (display / box / tikz)     | [Recent renders v]
    Slide [Light v] Ink [] Paper [] Font [v]   | [ list ]
    Size [250]%  Engine [pdflatex v]           |
    [Render] [Insert] [Edit selected]          | [Delete][Export v][Re-render all][Settings]
    status line

The Look row is global: it applies to every workspace, and it describes the
slide, not this window. Compiles run on a worker thread. Results come back to
the UI thread through com.sun.star.awt.AsyncCallback; the worker never
touches a control.
"""

import os
import threading
import traceback

import uno
import unohelper
from com.sun.star.awt import (XActionListener, XCallback, XItemListener, XKeyListener, XTextListener,
                              XTopWindowListener)
from com.sun.star.awt import Rectangle
from com.sun.star.datatransfer import XTransferable
from com.sun.star.view import XSelectionChangeListener

from . import backend, boxes, insert, latex, look, snippets, store, svg

KEY_RETURN = 1280
MOD_SHIFT = 1
MOD_CTRL = 2  # MOD1: Ctrl, or Cmd on macOS

ERR = 0xC0392B
OK_GREEN = 0x2E7D32
MUTED = 0x6B6B6B

FONT_MONO = "Liberation Mono;DejaVu Sans Mono;Consolas;Menlo;Courier New"
SAVED_MARK = "★ "  # marks saved snippets / presets in a list
ENGINES = ("pdflatex", "xelatex", "lualatex")
LIST_MODES = ("Recent renders", "Saved snippets")

EXPORT_SVG, EXPORT_PDF, EXPORT_PNG, COPY_SOURCE = 1, 2, 3, 4

_WINDOW = None  # the one open TeXeR window; a strong ref keeps it alive


def open_window(ctx):
    """Entry point from the toolbar/menu. Re-uses an open window, re-bound to
    whichever document is active now."""
    global _WINDOW
    desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
    frame = desktop.getCurrentFrame()
    if frame is None:
        return
    if _WINDOW is not None and _WINDOW.alive:
        _WINDOW.bind(frame)
        _WINDOW.dialog.setVisible(True)
        _WINDOW.dialog.setFocus()
        return
    _WINDOW = TexerWindow(ctx, frame)


# ── tiny listener adapters ──────────────────────────────────────────────

class _Action(unohelper.Base, XActionListener):
    def __init__(self, fn):
        self.fn = fn

    def actionPerformed(self, ev):
        _guard(self.fn)

    def disposing(self, ev):
        pass


class _Item(unohelper.Base, XItemListener):
    def __init__(self, fn):
        self.fn = fn

    def itemStateChanged(self, ev):
        _guard(self.fn)

    def disposing(self, ev):
        pass


class _Text(unohelper.Base, XTextListener):
    def __init__(self, fn):
        self.fn = fn

    def textChanged(self, ev):
        _guard(self.fn)

    def disposing(self, ev):
        pass


class _Keys(unohelper.Base, XKeyListener):
    def __init__(self, fn):
        self.fn = fn

    def keyPressed(self, ev):
        if ev.KeyCode == KEY_RETURN and ev.Modifiers & MOD_CTRL:
            _guard(lambda: self.fn(bool(ev.Modifiers & MOD_SHIFT)))

    def keyReleased(self, ev):
        pass

    def disposing(self, ev):
        pass


class _TopWindow(unohelper.Base, XTopWindowListener):
    def __init__(self, on_close):
        self.on_close = on_close

    def windowClosing(self, ev):
        _guard(self.on_close)

    def windowOpened(self, ev):
        pass

    def windowClosed(self, ev):
        pass

    def windowMinimized(self, ev):
        pass

    def windowNormalized(self, ev):
        pass

    def windowActivated(self, ev):
        pass

    def windowDeactivated(self, ev):
        pass

    def disposing(self, ev):
        pass


class _Selection(unohelper.Base, XSelectionChangeListener):
    def __init__(self, fn):
        self.fn = fn

    def selectionChanged(self, ev):
        _guard(self.fn)

    def disposing(self, ev):
        pass


class _Callback(unohelper.Base, XCallback):
    def __init__(self, fn):
        self.fn = fn

    def notify(self, data):
        _guard(self.fn)


class _TextTransferable(unohelper.Base, XTransferable):
    """Plain text for the system clipboard."""

    MIME = "text/plain;charset=utf-16"

    def __init__(self, text):
        self.text = text

    def getTransferData(self, flavor):
        return self.text

    def getTransferDataFlavors(self):
        f = uno.createUnoStruct("com.sun.star.datatransfer.DataFlavor")
        f.MimeType = self.MIME
        f.HumanPresentableName = "Unicode text"
        f.DataType = uno.getTypeByName("string")
        return (f,)

    def isDataFlavorSupported(self, flavor):
        return flavor.MimeType == self.MIME


def _guard(fn):
    # An exception escaping a UNO listener is swallowed (or worse) by the
    # bridge, so log it where it can be found and keep the window usable.
    try:
        fn()
    except Exception:
        traceback.print_exc()
        if _WINDOW is not None and _WINDOW.alive:
            try:
                _WINDOW.set_status("Unexpected error: %s" % traceback.format_exc().strip().splitlines()[-1], "err")
            except Exception:
                pass


def _prop(name, value):
    p = uno.createUnoStruct("com.sun.star.beans.PropertyValue")
    p.Name = name
    p.Value = value
    return p


def _hex_to_int(value, fallback=0x171717):
    h = look.normalize_hex(value)
    return int(h, 16) if h else fallback


def _int_to_hex(value):
    return "#%06X" % (int(value) & 0xFFFFFF)


def _profile_dir(ctx):
    subst = ctx.ServiceManager.createInstanceWithContext("com.sun.star.util.PathSubstitution", ctx)
    url = subst.substituteVariables("$(user)", True)
    return os.path.join(uno.fileUrlToSystemPath(url), "texer-imp")


def prompt(ctx, parent_peer, title, label, default=""):
    """A one-line modal text prompt. Returns the text, or None on Cancel."""
    smgr = ctx.ServiceManager
    dm = smgr.createInstanceWithContext("com.sun.star.awt.UnoControlDialogModel", ctx)
    dm.Width, dm.Height, dm.Title = 200, 62, title

    def add(kind, name, x, y, w, h, **props):
        m = dm.createInstance("com.sun.star.awt.UnoControl%sModel" % kind)
        m.Name = name
        m.PositionX, m.PositionY, m.Width, m.Height = x, y, w, h
        for k, v in props.items():
            setattr(m, k, v)
        dm.insertByName(name, m)

    add("FixedText", "lbl", 6, 6, 188, 10, Label=label)
    add("Edit", "text", 6, 18, 188, 14, Text=default)
    add("Button", "ok", 90, 42, 50, 14, Label="OK", PushButtonType=1, DefaultButton=True)
    add("Button", "cancel", 144, 42, 50, 14, Label="Cancel", PushButtonType=2)
    dlg = smgr.createInstanceWithContext("com.sun.star.awt.UnoControlDialog", ctx)
    dlg.setModel(dm)
    dlg.createPeer(smgr.createInstanceWithContext("com.sun.star.awt.Toolkit", ctx), parent_peer)
    try:
        if dlg.execute() == 1:
            return dm.getByName("text").Text.strip()
        return None
    finally:
        dlg.dispose()


# ── the window ──────────────────────────────────────────────────────────

class TexerWindow(object):
    WIDTH = 462
    HEIGHT = 330
    LEFT_W = 234
    RIGHT_X = 248
    RIGHT_W = 208

    def __init__(self, ctx, frame):
        self.ctx = ctx
        self.smgr = ctx.ServiceManager
        self.store = store.Store(_profile_dir(ctx))
        self.settings = self.store.load_settings()
        self.drafts = self.store.load_drafts()
        self.workspace = self.settings["workspace"]
        self.alive = True
        self.busy = False
        self.insert_after_render = False
        self.insert_count = 0
        self.rerender_done = 0
        self.last = None  # {"key", "graphic", "size_pt", "meta", "svg", "pdf"}
        self.box_dirty = False
        self.last_box_source = ""
        self.box_fill = ""  # "" = automatic tint toward the paper
        self.loading = False  # suppresses listeners while filling controls
        self.list_mode = 0
        self.frame = None
        self.controller = None
        self.doc = None
        self.selected_shape = None
        # The object loaded with Edit selected. Only it can be replaced:
        # merely having some TeXeR object selected must never turn the next
        # insert into an overwrite.
        self.editing_shape = None
        self.selection_listener = _Selection(self.on_selection_changed)
        self.backend_status = None
        self.async_cb = self.smgr.createInstanceWithContext("com.sun.star.awt.AsyncCallback", ctx)

        self._build()
        self.bind(frame)
        self._apply_look_controls()
        self._load_workspace(self.workspace)
        self.refresh_list()
        self.probe_backend()

        # A TeXeR shape already selected when the window opens: edit it.
        shape, meta = insert.selected_texer_shape(self.doc)
        if meta:
            self.load_meta(meta)
            self.editing_shape = shape
            self.on_selection_changed()

    # ── construction ──
    def _build(self):
        dm = self.smgr.createInstanceWithContext("com.sun.star.awt.UnoControlDialogModel", self.ctx)
        dm.Width = self.WIDTH
        dm.Height = self.HEIGHT
        dm.Title = "TeXeR"
        self.dm = dm

        L = self.LEFT_W
        RX = self.RIGHT_X
        RW = self.RIGHT_W

        x = 6
        for ws in snippets.WORKSPACES:
            self._add("Button", "ws_" + ws, x, 6, 36, 14, Label=snippets.WORKSPACE_LABELS[ws], Toggle=True,
                      HelpText=snippets.WORKSPACE_HINTS[ws])
            x += 38
        self._add("FixedText", "pill", RX, 8, RW, 10, Label="Checking TeX...", Align=2, TextColor=MUTED)

        self._add("ListBox", "examples", 6, 24, 150, 14, Dropdown=True, LineCount=16)
        self._add("Button", "save_snippet", 160, 24, L + 6 - 160, 14, Label="Save snippet...",
                  HelpText="Keep the current source in your saved snippets")
        self._add("Edit", "source", 6, 42, L, 88, MultiLine=True, VScroll=True, HScroll=False, FontName=FONT_MONO)

        # Workspace tool areas, all at y=136..226, only one visible at a time.
        ty = 136
        # math
        self._add("CheckBox", "display", 6, ty + 2, 120, 12, Label="Display style")
        # latex
        self._add("FixedText", "latex_note", 6, ty, L, 30, MultiLine=True, TextColor=MUTED,
                  Label="Snippets are wrapped in a standalone document. \\usepackage, \\usetikzlibrary and "
                        "\\newcommand lines at the top move into the preamble. A source with "
                        "\\documentclass is compiled as-is, without the Look.")
        # boxes
        self._add("FixedText", "box_type_lbl", 6, ty + 3, 22, 10, Label="Type")
        self._add("ComboBox", "box_type", 28, ty, 80, 14, Dropdown=True, LineCount=14, Autocomplete=False,
                  HelpText="Pick a preset or type any label (Conjecture, Claim, ...)")
        self._add("FixedText", "box_number_lbl", 112, ty + 3, 14, 10, Label="No.")
        self._add("Edit", "box_number", 126, ty, 20, 14, Text="1")
        self._add("CheckBox", "box_auto", 148, ty + 2, 26, 12, Label="Auto",
                  HelpText="Number boxes with the same label in order across the document")
        self._add("ListBox", "box_style", 176, ty, L + 6 - 176, 14, Dropdown=True,
                  StringItemList=tuple(s[1] for s in boxes.STYLES))
        self._add("FixedText", "box_title_lbl", 6, ty + 21, 22, 10, Label="Title")
        self._add("Edit", "box_title", 28, ty + 18, 100, 14)
        self._add("FixedText", "box_accent_lbl", 132, ty + 21, 24, 10, Label="Accent")
        self._add("Button", "box_accent", 156, ty + 18, 18, 14, Label="", HelpText="Accent colour")
        self._add("FixedText", "box_fill_lbl", 178, ty + 21, 12, 10, Label="Fill")
        self._add("Button", "box_fill", 192, ty + 18, 18, 14, Label="", HelpText="Background fill")
        self._add("Button", "box_fill_auto", 212, ty + 18, L + 6 - 212, 14, Label="Auto",
                  HelpText="Tint the accent toward the slide's paper colour")
        self._add("FixedText", "box_width_lbl", 6, ty + 39, 22, 10, Label="Width")
        self._add("NumericField", "box_width", 28, ty + 36, 34, 14, Value=60, ValueMin=1, ValueMax=1000,
                  DecimalAccuracy=1, Spin=True, StrictFormat=True)
        self._add("ListBox", "box_unit", 64, ty + 36, 52, 14, Dropdown=True, StringItemList=boxes.WIDTH_UNIT_LABELS)
        self._add("Button", "box_save", 120, ty + 36, 56, 14, Label="Save style...",
                  HelpText="Save this label, style and colours as a preset")
        self._add("Button", "box_build", 180, ty + 36, L + 6 - 180, 14, Label="Regenerate",
                  HelpText="Rebuild the source from these fields (overwrites hand edits)")
        self._add("Edit", "box_content", 6, ty + 54, L, 34, MultiLine=True, VScroll=True, FontName=FONT_MONO,
                  HelpText="Statement; $...$ math works here")
        # tikz
        self._add("FixedText", "tikz_starter_lbl", 6, ty + 3, 36, 10, Label="Starter")
        self._add("ListBox", "tikz_starter", 44, ty, 140, 14, Dropdown=True, LineCount=16,
                  StringItemList=tuple(["Choose a starter..."] + [t[0] for t in snippets.TIKZ_TEMPLATES]))
        self._add("FixedText", "tikz_lib_lbl", 6, ty + 21, 36, 10, Label="Library")
        self._add("ListBox", "tikz_lib", 44, ty + 18, 140, 14, Dropdown=True, LineCount=16,
                  StringItemList=tuple(c[0] for c in snippets.TIKZ_LIBRARY_CHIPS))
        self._add("Button", "tikz_add", 188, ty + 18, L + 6 - 188, 14, Label="Add",
                  HelpText="Add the declaration to the top of the source (once)")

        ly = 232
        self._add("FixedText", "preset_lbl", 6, ly + 3, 22, 10, Label="Slide")
        self._add("ListBox", "preset", 28, ly, 62, 14, Dropdown=True, StringItemList=tuple(p[1] for p in look.PRESET_LABELS),
                  HelpText="Colours for the slide you're inserting onto (not this window)")
        self._add("FixedText", "ink_lbl", 94, ly + 3, 14, 10, Label="Ink")
        self._add("Button", "ink", 108, ly, 18, 14, Label="", HelpText="Text and line colour, every workspace")
        self._add("FixedText", "paper_lbl", 130, ly + 3, 24, 10, Label="Paper")
        self._add("Button", "paper", 154, ly, 18, 14, Label="", HelpText="The slide's background colour")
        self._add("ListBox", "font", 176, ly, L + 6 - 176, 14, Dropdown=True, LineCount=8,
                  StringItemList=tuple(f[1] for f in look.FONTS), HelpText="Font for text and math")

        sy = 250
        self._add("FixedText", "size_lbl", 6, sy + 3, 20, 10, Label="Size")
        self._add("NumericField", "size", 28, sy, 40, 14, ValueMin=10, ValueMax=2000, DecimalAccuracy=0,
                  Spin=True, ValueStep=10, StrictFormat=True)
        self._add("FixedText", "size_pct", 70, sy + 3, 8, 10, Label="%")
        self._add("FixedText", "engine_lbl", 94, sy + 3, 28, 10, Label="Engine")
        self._add("ListBox", "engine", 124, sy, 60, 14, Dropdown=True, StringItemList=ENGINES)

        by = 270
        self._add("Button", "render", 6, by, 56, 16, Label="Render", DefaultButton=True, HelpText="Ctrl+Enter")
        self._add("Button", "insert", 66, by, 78, 16, Label="Insert", HelpText="Ctrl+Shift+Enter")
        self._add("Button", "edit_sel", 148, by, L + 6 - 148, 16, Label="Edit selected", Enabled=False,
                  HelpText="Load the selected TeXeR object's source")
        self._add("FixedText", "status", 6, 290, L, 34, MultiLine=True, TextColor=MUTED)

        self._add("FixedText", "preview_lbl", RX, 24, RW, 10, Label="Preview")
        self._add("ImageControl", "preview", RX, 36, RW, 120, ScaleImage=True, ScaleMode=1,
                  BackgroundColor=0xFFFFFF, Border=1)
        self._add("ListBox", "list_mode", RX, 162, RW, 14, Dropdown=True, StringItemList=LIST_MODES)
        self._add("ListBox", "recents", RX, 180, RW, 86, HelpText="Double-click to load")
        self._add("Button", "recent_del", RX, by, 40, 16, Label="Delete")
        self._add("Button", "export", RX + 42, by, 50, 16, Label="Export ▾",
                  HelpText="Save the last render as SVG, PDF or PNG, or copy its source")
        self._add("Button", "rerender", RX + 94, by, 64, 16, Label="Re-render all",
                  HelpText="Re-render every TeXeR object in this document with the current Look")
        self._add("Button", "settings", RX + 160, by, RW - 160, 16, Label="Settings...")

        dlg = self.smgr.createInstanceWithContext("com.sun.star.awt.UnoControlDialog", self.ctx)
        dlg.setModel(dm)
        self.dialog = dlg

        c = dlg.getControl
        for ws in snippets.WORKSPACES:
            c("ws_" + ws).addActionListener(_Action(lambda w=ws: self.switch_workspace(w)))
        c("examples").addItemListener(_Item(self.on_example))
        c("save_snippet").addActionListener(_Action(self.save_snippet))
        c("source").addTextListener(_Text(self.on_source_changed))
        c("source").addKeyListener(_Keys(self.on_hotkey))
        c("display").addItemListener(_Item(self.on_settings_controls))
        c("box_type").addItemListener(_Item(self.on_box_type_picked))
        c("box_type").addTextListener(_Text(self.on_box_field_changed))
        for name in ("box_number", "box_title", "box_content"):
            c(name).addTextListener(_Text(self.on_box_field_changed))
        c("box_width").addTextListener(_Text(self.on_box_field_changed))
        c("box_auto").addItemListener(_Item(self.on_box_auto))
        c("box_style").addItemListener(_Item(self.on_box_field_changed))
        c("box_unit").addItemListener(_Item(self.on_box_field_changed))
        c("box_accent").addActionListener(_Action(self.pick_box_accent))
        c("box_fill").addActionListener(_Action(self.pick_box_fill))
        c("box_fill_auto").addActionListener(_Action(self.reset_box_fill))
        c("box_save").addActionListener(_Action(self.save_box_preset))
        c("box_build").addActionListener(_Action(self.regenerate_box))
        c("tikz_starter").addItemListener(_Item(self.on_tikz_starter))
        c("tikz_add").addActionListener(_Action(self.on_tikz_add))
        c("preset").addItemListener(_Item(self.on_preset))
        c("ink").addActionListener(_Action(lambda: self.pick_look_color("ink")))
        c("paper").addActionListener(_Action(lambda: self.pick_look_color("paper")))
        c("font").addItemListener(_Item(self.on_font))
        c("size").addTextListener(_Text(self.on_size_changed))
        c("engine").addItemListener(_Item(self.on_settings_controls))
        c("render").addActionListener(_Action(self.render))
        c("insert").addActionListener(_Action(self.insert))
        c("edit_sel").addActionListener(_Action(self.edit_selected))
        c("list_mode").addItemListener(_Item(self.on_list_mode))
        c("recents").addActionListener(_Action(self.load_list_item))  # fires on double-click
        c("recent_del").addActionListener(_Action(self.delete_list_item))
        c("export").addActionListener(_Action(self.show_export_menu))
        c("rerender").addActionListener(_Action(self.rerender_all))
        c("settings").addActionListener(_Action(self.open_settings))

        self.loading = True
        try:
            self._m("display").State = 1 if self.settings["displayMath"] else 0
            self._m("size").Value = float(self.settings["sizePercent"])
            self._select("engine", self.settings["engine"])
            self._fill_box_types()
            self._m("box_type").Text = "Theorem"
            self._m("box_auto").State = 1 if self.settings["boxAutoNumber"] else 0
            self._m("box_number").Enabled = not self.settings["boxAutoNumber"]
            self._m("box_style").SelectedItems = (0,)
            self._m("box_unit").SelectedItems = (0,)
            self._m("box_accent").BackgroundColor = int(boxes.default_accent("Theorem"), 16)
            self._m("tikz_starter").SelectedItems = (0,)
            self._m("tikz_lib").SelectedItems = (0,)
            self._m("list_mode").SelectedItems = (0,)
        finally:
            self.loading = False
        self._show_box_fill()

    def _add(self, kind, name, x, y, w, h, **props):
        m = self.dm.createInstance("com.sun.star.awt.UnoControl%sModel" % kind)
        m.Name = name
        m.PositionX, m.PositionY, m.Width, m.Height = x, y, w, h
        for k, v in props.items():
            setattr(m, k, v)
        self.dm.insertByName(name, m)
        return m

    def _m(self, name):
        return self.dm.getByName(name)

    def _select(self, name, value):
        items = list(self._m(name).StringItemList)
        if value in items:
            self._m(name).SelectedItems = (items.index(value),)

    def _selected(self, name):
        sel = self._m(name).SelectedItems
        return sel[0] if sel else -1

    def _number(self, name, fallback):
        """A NumericField's value as typed. The model's Value only catches up
        when the field loses focus, which is too late for live updates."""
        try:
            return float(self.dialog.getControl(name).getText().strip().replace(",", "."))
        except (ValueError, AttributeError):
            return fallback

    # ── document binding ──
    def bind(self, frame):
        """(Re)attaches to a document window: parent, selection listener, button labels."""
        if self.controller is not None:
            try:
                self.controller.removeSelectionChangeListener(self.selection_listener)
            except Exception:
                pass
        self.frame = frame
        self.controller = frame.getController()
        self.doc = self.controller.getModel() if self.controller else None
        if self.dialog.getPeer() is None:
            toolkit = self.smgr.createInstanceWithContext("com.sun.star.awt.Toolkit", self.ctx)
            self.dialog.createPeer(toolkit, frame.getContainerWindow())
            self.dialog.addTopWindowListener(_TopWindow(self.close))
            self.dialog.setVisible(True)
        try:
            self.controller.addSelectionChangeListener(self.selection_listener)
        except Exception:
            pass
        self.on_selection_changed()

    def close(self):
        self.alive = False
        try:
            self._stash_draft()
            self.store.save_drafts(self.drafts)
            self.store.save_settings(self.settings)
        except Exception:
            pass
        try:
            if self.controller is not None:
                self.controller.removeSelectionChangeListener(self.selection_listener)
        except Exception:
            pass
        self.dialog.setVisible(False)
        self.dialog.dispose()

    def on_selection_changed(self):
        if not self.alive:
            return
        try:
            shape, meta = insert.selected_texer_shape(self.doc)
        except Exception:
            shape, meta = None, None
        self.selected_shape = shape
        editing = bool(meta) and self.editing_shape is not None and shape == self.editing_shape
        self._m("edit_sel").Enabled = bool(meta) and not editing
        self._m("insert").Label = "Replace selected" if editing else "Insert"

    def _is_editing_selection(self):
        shape, meta = insert.selected_texer_shape(self.doc)
        return bool(meta) and self.editing_shape is not None and shape == self.editing_shape

    def _end_editing(self):
        """New content was loaded: the next Insert adds a new object."""
        if self.editing_shape is not None:
            self.editing_shape = None
            self.on_selection_changed()

    # ── the Look (global) ──
    def _apply_look_controls(self):
        """Shows the current Look in its controls and on the preview."""
        ink, paper = look.resolve(self.settings)
        self.loading = True
        try:
            keys = [p[0] for p in look.PRESET_LABELS]
            preset = self.settings["slidePreset"]
            self._m("preset").SelectedItems = (keys.index(preset) if preset in keys else 0,)
            self._m("ink").BackgroundColor = int(ink, 16)
            self._m("paper").BackgroundColor = int(paper, 16)
            self._m("font").SelectedItems = (look.FONT_IDS.index(self.settings["font"])
                                             if self.settings["font"] in look.FONT_IDS else 0,)
            self._m("preview").BackgroundColor = int(paper, 16)
        finally:
            self.loading = False
        self._show_box_fill()

    def _look_changed(self):
        self.store.save_settings(self.settings)
        self._apply_look_controls()
        # Box colours are baked into the generated source (fill tint, readable
        # accent), so a new paper means new box source.
        if self.workspace == "boxes" and not self.box_dirty:
            self.regenerate_box()
        self.set_status("Look changed. Render to see it; Re-render all updates objects already on slides.")

    def on_preset(self):
        if self.loading:
            return
        idx = self._selected("preset")
        if idx < 0:
            return
        preset = look.PRESET_LABELS[idx][0]
        if preset == "custom":
            # Start Custom from whatever is showing, so nothing jumps.
            ink, paper = look.resolve(self.settings)
            self.settings.update(ink="#" + ink, paper="#" + paper)
        self.settings["slidePreset"] = preset
        self._look_changed()

    def pick_look_color(self, which):
        ink, paper = look.resolve(self.settings)
        color = self._pick_color(int(ink if which == "ink" else paper, 16))
        if color is None:
            return
        # Editing either colour makes the look Custom, keeping the other one.
        self.settings.update(slidePreset="custom", ink="#" + ink, paper="#" + paper)
        self.settings[which] = _int_to_hex(color)
        self._look_changed()

    def on_font(self):
        if self.loading:
            return
        idx = self._selected("font")
        if idx < 0:
            return
        font = look.FONT_IDS[idx]
        if font == "system":
            name = prompt(self.ctx, self.dialog.getPeer(), "System font",
                          "Font name, exactly as installed (e.g. Fira Sans). Uses XeLaTeX.",
                          self.settings.get("fontName", ""))
            if not name:
                self._apply_look_controls()  # back to the previous font
                return
            self.settings["fontName"] = name
        self.settings["font"] = font
        self._look_changed()

    def _pick_color(self, current):
        try:
            picker = self.smgr.createInstanceWithArgumentsAndContext(
                "com.sun.star.ui.dialogs.ColorPicker", (self.dialog.getPeer(),), self.ctx)
            picker.setPropertyValues((_prop("Color", int(current)),))
            if picker.execute() != 1:
                return None
            for p in picker.getPropertyValues():
                if p.Name == "Color":
                    return int(p.Value) & 0xFFFFFF
        except Exception:
            traceback.print_exc()
            self.set_status("The colour picker is unavailable in this LibreOffice build.", "err")
        return None

    # ── workspaces and drafts ──
    def _stash_draft(self):
        self.drafts[self.workspace] = self._m("source").Text

    def switch_workspace(self, ws, carry_source=None, keep_editing=False):
        if not keep_editing:
            self._end_editing()
        if ws != self.workspace:
            self._stash_draft()
            self.store.save_drafts(self.drafts)
        self._load_workspace(ws)
        if carry_source is not None:
            self._set_source(carry_source)

    def _load_workspace(self, ws):
        self.workspace = ws
        self.settings["workspace"] = ws
        self.loading = True
        try:
            for w in snippets.WORKSPACES:
                self._m("ws_" + w).State = 1 if w == ws else 0
            self._m("source").Text = self.drafts.get(ws, "")
        finally:
            self.loading = False
        self._fill_examples()
        groups = {
            "math": ("display",),
            "latex": ("latex_note",),
            "boxes": ("box_type_lbl", "box_type", "box_number_lbl", "box_number", "box_auto", "box_style",
                      "box_title_lbl", "box_title", "box_accent_lbl", "box_accent", "box_fill_lbl", "box_fill",
                      "box_fill_auto", "box_width_lbl", "box_width", "box_unit", "box_save", "box_build",
                      "box_content"),
            "tikz": ("tikz_starter_lbl", "tikz_starter", "tikz_lib_lbl", "tikz_lib", "tikz_add"),
        }
        for w, names in groups.items():
            for n in names:
                self.dialog.getControl(n).setVisible(w == ws)
        if ws == "boxes":
            # A restored draft that differs from what the fields generate was
            # edited by hand; keep it until the user asks to regenerate.
            text = self._m("source").Text
            self.box_dirty = bool(text.strip()) and text != self._box_source()
            if not self.box_dirty:
                self.regenerate_box()

    def _fill_examples(self):
        self.example_items = [("builtin", s) for s in snippets.snippets_for(self.workspace)]
        self.example_items += [("saved", s) for s in self.store.load_snippets() if s.get("workspace") == self.workspace]
        labels = ["Examples"] + [(SAVED_MARK if kind == "saved" else "") + s["label"] for kind, s in self.example_items]
        self.loading = True
        try:
            self._m("examples").StringItemList = tuple(labels)
            self._m("examples").SelectedItems = (0,)
            self._m("examples").Enabled = bool(self.example_items)
        finally:
            self.loading = False

    def _set_source(self, text):
        self.loading = True
        try:
            self._m("source").Text = text
        finally:
            self.loading = False
        self.drafts[self.workspace] = text
        if self.workspace == "boxes":
            self.last_box_source = text
            self.box_dirty = False

    def on_source_changed(self):
        if self.loading:
            return
        text = self._m("source").Text
        self.drafts[self.workspace] = text
        if self.workspace == "boxes" and text != self.last_box_source:
            self.box_dirty = True

    def on_example(self):
        if self.loading:
            return
        idx = self._selected("examples")
        if idx <= 0 or idx > len(self.example_items):
            return
        self._end_editing()
        self._set_source(self.example_items[idx - 1][1]["source"])
        self.loading = True
        self._m("examples").SelectedItems = (0,)
        self.loading = False

    def save_snippet(self):
        source = self._m("source").Text.strip()
        if not source:
            self.set_status("Nothing to save yet.", "err")
            return
        name = prompt(self.ctx, self.dialog.getPeer(), "Save snippet", "Name for this snippet:",
                      " ".join(source.split())[:40])
        if not name:
            return
        self.store.save_snippet(name, self.workspace, source)
        self._fill_examples()
        self.refresh_list()
        self.set_status("Saved “%s”. It's in Examples for this workspace and under Saved snippets." % name, "ok")

    def on_hotkey(self, shift):
        if shift:
            self.insert()
        else:
            self.render()

    def on_settings_controls(self):
        if self.loading:
            return
        self.settings["displayMath"] = bool(self._m("display").State)
        idx = self._selected("engine")
        if idx >= 0:
            self.settings["engine"] = ENGINES[idx]
        self.store.save_settings(self.settings)

    def on_size_changed(self):
        if self.loading:
            return
        value = int(self._number("size", 0))
        if value < 10 or value > 2000:
            return
        self.settings["sizePercent"] = value
        self.store.save_settings(self.settings)
        # Box width is worked back from the size, so the box source depends on it.
        if self.workspace == "boxes" and not self.box_dirty:
            self.regenerate_box()

    # ── boxes ──
    def _fill_box_types(self):
        self.box_presets = self.store.load_box_presets()
        items = list(boxes.BOX_TYPES) + [SAVED_MARK + p["name"] for p in self.box_presets]
        self._m("box_type").StringItemList = tuple(items)

    def _box_label(self):
        text = self._m("box_type").Text.strip()
        if text.startswith(SAVED_MARK.strip()):
            # The preset entry itself is still showing: use its label.
            name = text[len(SAVED_MARK.strip()):].strip()
            for p in self.box_presets:
                if p["name"] == name:
                    return p.get("label") or name
        return text or "Theorem"

    def _box_fields(self, number=None):
        s = self._selected("box_style")
        u = self._selected("box_unit")
        return {
            "label": self._box_label(),
            "number": self._m("box_number").Text if number is None else number,
            "auto": bool(self._m("box_auto").State),
            "title": self._m("box_title").Text,
            "content": self._m("box_content").Text,
            "width": self._number("box_width", 60),
            "unit": boxes.WIDTH_UNITS[u] if u >= 0 else "%",
            "style": boxes.STYLE_IDS[s] if s >= 0 else "bar",
            "accent": _int_to_hex(self._m("box_accent").BackgroundColor),
            "fill": self.box_fill,
        }

    def _slide_width_in(self):
        try:
            return insert.current_page(self.doc).Width / 2540.0
        except Exception:
            return 11.02  # LibreOffice's default 28 cm (16:9) slide

    def _box_source(self, fields=None):
        _ink, paper = look.resolve(self.settings)
        return boxes.build_from_fields(fields or self._box_fields(), paper, self._slide_width_in(),
                                       self.settings["sizePercent"])

    def _auto_number(self, replacing=None, replacing_meta=None):
        """Next free number for this label. Re-editing a box keeps its number."""
        label = self._box_label()
        if replacing_meta and isinstance(replacing_meta.get("box"), dict) \
                and replacing_meta["box"].get("label") == label and replacing_meta["box"].get("number"):
            return replacing_meta["box"]["number"]
        try:
            return boxes.next_number(insert.box_numbers(self.doc, label, exclude=replacing))
        except Exception:
            return "1"

    def _refresh_auto_number(self):
        if self._m("box_auto").State:
            shape = self.editing_shape
            meta = insert.read_meta(shape) if shape is not None else None
            self.loading = True
            try:
                self._m("box_number").Text = self._auto_number(shape, meta)
            finally:
                self.loading = False

    def regenerate_box(self):
        self._refresh_auto_number()
        self._set_source(self._box_source())

    def on_box_field_changed(self):
        if self.loading or self.workspace != "boxes":
            return
        if self.box_dirty:
            self.set_status("Source was edited by hand, so it was left alone. Regenerate to rebuild it.")
            return
        self.regenerate_box()

    def on_box_type_picked(self):
        """A list entry was picked: a built-in label or a saved preset."""
        if self.loading:
            return
        text = self._m("box_type").Text.strip()
        preset = None
        if text.startswith(SAVED_MARK.strip()):
            name = text[len(SAVED_MARK.strip()):].strip()
            preset = next((p for p in self.box_presets if p["name"] == name), None)
        self.loading = True
        try:
            if preset:
                self._m("box_type").Text = preset.get("label") or preset["name"]
                if preset.get("style") in boxes.STYLE_IDS:
                    self._m("box_style").SelectedItems = (boxes.STYLE_IDS.index(preset["style"]),)
                self._m("box_accent").BackgroundColor = _hex_to_int(preset.get("accent"), 0x222B82)
                self.box_fill = preset.get("fill") or ""
            elif text in boxes.BOX_ACCENTS:
                self._m("box_accent").BackgroundColor = int(boxes.BOX_ACCENTS[text], 16)
        finally:
            self.loading = False
        self._show_box_fill()
        self.on_box_field_changed()

    def on_box_auto(self):
        if self.loading:
            return
        auto = bool(self._m("box_auto").State)
        self.settings["boxAutoNumber"] = auto
        self.store.save_settings(self.settings)
        self._m("box_number").Enabled = not auto
        self.on_box_field_changed()

    def pick_box_accent(self):
        color = self._pick_color(self._m("box_accent").BackgroundColor)
        if color is not None:
            self._m("box_accent").BackgroundColor = color
            self._show_box_fill()
            self.on_box_field_changed()

    def pick_box_fill(self):
        current = int(self._effective_fill(), 16)
        color = self._pick_color(current)
        if color is not None:
            self.box_fill = _int_to_hex(color)
            self._show_box_fill()
            self.on_box_field_changed()

    def reset_box_fill(self):
        self.box_fill = ""
        self._show_box_fill()
        self.on_box_field_changed()

    def _effective_fill(self):
        _ink, paper = look.resolve(self.settings)
        _a, fill, _t = boxes.colors(_int_to_hex(self._m("box_accent").BackgroundColor), self.box_fill, paper)
        return fill

    def _show_box_fill(self):
        self._m("box_fill").BackgroundColor = int(self._effective_fill(), 16)
        self._m("box_fill_auto").Enabled = bool(self.box_fill)

    def save_box_preset(self):
        f = self._box_fields()
        name = prompt(self.ctx, self.dialog.getPeer(), "Save box style",
                      "Preset name (saves label, style and colours):", f["label"])
        if not name:
            return
        self.store.save_box_preset({"name": name, "label": f["label"], "style": f["style"],
                                    "accent": f["accent"], "fill": f["fill"]})
        self.loading = True
        try:
            self._fill_box_types()
        finally:
            self.loading = False
        self.set_status("Saved box style “%s”. Pick it from Type." % name, "ok")

    # ── tikz ──
    def on_tikz_starter(self):
        if self.loading:
            return
        idx = self._selected("tikz_starter")
        if idx <= 0:
            return
        self._end_editing()
        self._set_source(snippets.TIKZ_TEMPLATES[idx - 1][1])
        self.loading = True
        self._m("tikz_starter").SelectedItems = (0,)
        self.loading = False

    def on_tikz_add(self):
        idx = self._selected("tikz_lib")
        if idx < 0:
            return
        self._set_source(snippets.insert_line(self._m("source").Text, snippets.TIKZ_LIBRARY_CHIPS[idx][1]))

    # ── status ──
    def set_status(self, message, kind=""):
        m = self._m("status")
        m.Label = message
        m.TextColor = {"err": ERR, "ok": OK_GREEN}.get(kind, MUTED)

    def probe_backend(self):
        settings = dict(self.settings)

        def work():
            st = backend.status(settings)
            self._post(lambda: self._show_backend(st))

        threading.Thread(target=work, daemon=True).start()

    def _show_backend(self, st):
        self.backend_status = st
        m = self._m("pill")
        if st["backend"]:
            m.Label = "TeX ready (%s)" % ("local" if st["backend"] == "direct" else "helper")
            m.TextColor = OK_GREEN
        else:
            m.Label = "No TeX found"
            m.TextColor = ERR
            self.set_status(st["message"], "err")
        m.HelpText = st["message"]

    def _post(self, fn):
        """Runs fn on the UI thread."""
        if self.alive:
            self.async_cb.addCallback(_Callback(lambda: fn() if self.alive else None), None)

    # ── render ──
    def _compile_inputs(self):
        """(source as typed, the TeX actually compiled, metadata) for the current state."""
        ws = self.workspace
        if ws == "boxes" and not self.box_dirty:
            # Auto numbers and the Look can change between edits; rebuild now.
            self.regenerate_box()
        source = self._m("source").Text.strip()
        if ws == "math" and latex.looks_like_full_latex(source):
            # Same courtesy as powerpoint/: this needs a document, not an expression.
            target = "tikz" if latex.looks_like_tikz(source) else "latex"
            self.switch_workspace(target, carry_source=source)
            self.set_status("That isn't a bare expression, so it moved to %s." % snippets.WORKSPACE_LABELS[target], "ok")
            ws = target
        tex_source = latex.wrap_math(source, self.settings["displayMath"]) if ws == "math" else source
        meta = {
            "source": source,
            "workspace": ws,
            "engine": self.settings["engine"],
            "displayMath": self.settings["displayMath"],
        }
        if ws == "boxes":
            meta["box"] = self._box_fields()
            meta["boxEdited"] = self.box_dirty
        return source, tex_source, meta

    def _render_key(self, tex_source):
        s = self.settings
        return (tex_source, s["engine"], s["extraPreamble"], s["border"], s["fontMode"], s["texBinDir"],
                s["backend"], look.resolve(s), s["font"], s["fontName"])

    def render(self, then_insert=False):
        if self.busy:
            self.insert_after_render = self.insert_after_render or then_insert
            return
        source, tex_source, meta = self._compile_inputs()
        if not source:
            self.set_status("Type some LaTeX first.", "err")
            return
        self.busy = True
        self.insert_after_render = then_insert
        self._m("render").Enabled = False
        self.set_status("Compiling with %s..." % self.settings["engine"])
        settings = dict(self.settings)
        key = self._render_key(tex_source)

        def work():
            try:
                result = backend.compile_svg(settings, tex_source, settings["extraPreamble"])
                error = None
            except backend.BackendError as e:
                result, error = None, str(e)
            except Exception as e:
                traceback.print_exc()
                result, error = None, "Compile failed: %s" % e
            self._post(lambda: self._render_done(key, meta, result, error))

        threading.Thread(target=work, daemon=True).start()

    def _render_done(self, key, meta, result, error):
        then_insert = self.insert_after_render
        self.insert_after_render = False
        try:
            self._finish_render(key, meta, result, error, then_insert)
        finally:
            # Last, so nothing observes "idle" before the status and preview are set.
            self._m("render").Enabled = True
            self.busy = False

    def _graphic_for(self, result):
        """(XGraphic, natural size in pt, mime) for a successful compile."""
        if result.get("svg"):
            return (insert.load_graphic(self.ctx, result["svg"].encode("utf-8"), "image/svg+xml"),
                    svg.natural_size_pt(result["svg"]), "image/svg+xml")
        return (insert.load_graphic(self.ctx, result["pdf"], "application/pdf"),
                svg.pdf_size_pt(result["pdf"]), "application/pdf")

    def _finish_render(self, key, meta, result, error, then_insert):
        if error:
            self.set_status(error, "err")
            return
        if not result.get("success"):
            errs = result.get("errors") or ["Compile failed."]
            self.set_status("\n".join(errs[:4]), "err")
            return

        graphic, size_pt, mime = self._graphic_for(result)
        self._m("preview").Graphic = graphic
        self.last = {"key": key, "graphic": graphic, "size_pt": size_pt, "meta": meta,
                     "svg": result.get("svg"), "pdf": result.get("pdf")}

        self.store.record_history(meta["source"], meta["workspace"])
        self.refresh_list()
        notes = []
        if mime == "application/pdf":
            notes.append("PDF; no SVG tool worked")
        if result.get("engine") and result["engine"] != self.settings["engine"]:
            notes.append("used %s for the system font" % result["engine"])
        self.set_status("Compiled in %d ms via %s%s." % (
            result.get("duration", 0), "helper" if result.get("backend") == "helper" else (result.get("tool") or "TeX"),
            (" (%s)" % "; ".join(notes)) if notes else ""), "ok")
        if then_insert:
            self._do_insert()

    # ── insert ──
    def insert(self):
        source, tex_source, _meta = self._compile_inputs()
        if self.last is not None and self.last["key"] == self._render_key(tex_source):
            self._do_insert()
        else:
            self.render(then_insert=True)

    def _size_for(self, meta, size_pt):
        settings = self.settings
        if meta["workspace"] == "boxes":
            # A box's width is already baked into its TeX; never stretch it.
            settings = dict(settings, sizeMode="natural")
        return insert.size_from_pt(size_pt[0], size_pt[1], settings)

    def _do_insert(self):
        if not insert.is_draw_like(self.doc):
            self.set_status("Open an Impress or Draw document to insert. (Writer support is planned.)", "err")
            return
        size = self._size_for(self.last["meta"], self.last["size_pt"])
        replacing = self._is_editing_selection()
        new_shape = insert.insert_or_replace(self.doc, self.last["graphic"], size, dict(self.last["meta"]),
                                             replace=self.editing_shape if replacing else None)
        if replacing:
            self.editing_shape = new_shape  # keep editing the same object
        self.insert_count += 1
        self.on_selection_changed()
        self.set_status("Replaced the object you're editing." if replacing else "Inserted on the current slide.", "ok")

    def edit_selected(self):
        shape, meta = insert.selected_texer_shape(self.doc)
        if not meta:
            self.set_status("Select a TeXeR object on the slide first.", "err")
            return
        self.load_meta(meta)
        self.editing_shape = shape
        self.on_selection_changed()
        self.set_status("Editing the selected object. Change it, then Replace selected.", "ok")

    def load_meta(self, meta):
        source = meta.get("source", "")
        ws = meta.get("workspace") if meta.get("workspace") in snippets.WORKSPACES else (
            "tikz" if latex.looks_like_tikz(source) else "latex" if latex.looks_like_full_latex(source) else "math")
        self.loading = True
        try:
            if meta.get("engine") in ENGINES:
                self.settings["engine"] = meta["engine"]
                self._select("engine", meta["engine"])
            if "displayMath" in meta:
                self.settings["displayMath"] = bool(meta["displayMath"])
                self._m("display").State = 1 if meta["displayMath"] else 0
            box = meta.get("box")
            if isinstance(box, dict):
                self._m("box_type").Text = str(box.get("label") or box.get("type") or "Theorem")
                self._m("box_number").Text = str(box.get("number", ""))
                self._m("box_auto").State = 1 if box.get("auto") else 0
                self._m("box_number").Enabled = not box.get("auto")
                self._m("box_title").Text = str(box.get("title", ""))
                self._m("box_content").Text = str(box.get("content", ""))
                try:
                    self._m("box_width").Value = float(box.get("width", 60))
                except (TypeError, ValueError):
                    pass
                if box.get("unit") in boxes.WIDTH_UNITS:
                    self._m("box_unit").SelectedItems = (boxes.WIDTH_UNITS.index(box["unit"]),)
                if box.get("style") in boxes.STYLE_IDS:
                    self._m("box_style").SelectedItems = (boxes.STYLE_IDS.index(box["style"]),)
                self._m("box_accent").BackgroundColor = _hex_to_int(box.get("accent"), 0x222B82)
                self.box_fill = box.get("fill") or ""
        finally:
            self.loading = False
        self._show_box_fill()
        self.switch_workspace(ws, carry_source=source, keep_editing=True)
        if ws == "boxes" and meta.get("boxEdited"):
            self.box_dirty = True

    # ── re-render all ──
    def rerender_all(self):
        """Re-renders every TeXeR object in the document with the current Look.

        Each object keeps its own source, workspace, engine and box fields;
        what changes is the ink, paper, font and size settings. Boxes that
        were never hand-edited are rebuilt from their fields so their fill
        and accent follow the new paper too.
        """
        if self.busy:
            return
        if not insert.is_draw_like(self.doc):
            self.set_status("Open an Impress or Draw document first.", "err")
            return
        targets = insert.all_texer_shapes(self.doc)
        if not targets:
            self.set_status("There are no TeXeR objects in this document yet.")
            return
        _ink, paper = look.resolve(self.settings)
        slide_in = self._slide_width_in()
        jobs = []
        for _page, shape, meta in targets:
            source = meta.get("source", "")
            ws = meta.get("workspace", "latex")
            if ws == "math":
                tex = latex.wrap_math(source, meta.get("displayMath", True))
            elif ws == "boxes" and isinstance(meta.get("box"), dict) and not meta.get("boxEdited"):
                tex = boxes.build_from_fields(meta["box"], paper, slide_in, self.settings["sizePercent"])
                meta = dict(meta, source=tex)
            else:
                tex = source
            jobs.append((shape, meta, tex))

        self.busy = True
        self.rerender_done = 0
        self._m("render").Enabled = False
        self._m("rerender").Enabled = False
        self.set_status("Re-rendering %d objects..." % len(jobs))
        settings = dict(self.settings)
        total = len(jobs)

        def work():
            failures = []
            try:
                st = backend.status(settings)
                for i, (shape, meta, tex) in enumerate(jobs):
                    s = dict(settings, engine=meta.get("engine") or settings["engine"])
                    try:
                        result = backend.compile_svg(s, tex, s["extraPreamble"], st=st)
                    except Exception as e:
                        result = {"success": False, "errors": [str(e)]}
                    if result.get("success"):
                        self._post(lambda sh=shape, m=meta, r=result, n=i: self._rerender_one(sh, m, r, n, total))
                    else:
                        failures.append("%s: %s" % (" ".join(meta.get("source", "").split())[:30],
                                                    (result.get("errors") or ["failed"])[0]))
            finally:
                self._post(lambda: self._rerender_finished(total, failures))

        threading.Thread(target=work, daemon=True).start()

    def _rerender_one(self, shape, meta, result, index, total):
        graphic, size_pt, _mime = self._graphic_for(result)
        size = self._size_for(meta, size_pt)
        new_shape = insert.insert_or_replace(self.doc, graphic, size, dict(meta), replace=shape, select=False)
        if self.editing_shape is not None and shape == self.editing_shape:
            self.editing_shape = new_shape
        self.rerender_done += 1
        self.set_status("Re-rendered %d of %d..." % (index + 1, total))

    def _rerender_finished(self, total, failures):
        try:
            if failures:
                self.set_status("Re-rendered %d of %d. Failed:\n%s" % (self.rerender_done, total, "\n".join(failures[:3])), "err")
            else:
                self.set_status("Re-rendered all %d objects with the current Look." % total, "ok")
        finally:
            self._m("render").Enabled = True
            self._m("rerender").Enabled = True
            self.busy = False
            self.on_selection_changed()

    # ── export ──
    def show_export_menu(self):
        menu = self.smgr.createInstanceWithContext("com.sun.star.awt.PopupMenu", self.ctx)
        menu.insertItem(EXPORT_SVG, "Save as SVG...", 0, 0)
        menu.insertItem(EXPORT_PDF, "Save as PDF...", 0, 1)
        menu.insertItem(EXPORT_PNG, "Save as PNG...", 0, 2)
        menu.insertSeparator(3)
        menu.insertItem(COPY_SOURCE, "Copy LaTeX source", 0, 4)
        has = self.last is not None
        menu.enableItem(EXPORT_SVG, bool(has and self.last.get("svg")))
        menu.enableItem(EXPORT_PDF, bool(has and self.last.get("pdf")))
        menu.enableItem(EXPORT_PNG, has)
        menu.enableItem(COPY_SOURCE, bool(self._m("source").Text.strip()))
        # Open just under the button; the control's peer knows its pixel position.
        pos = self.dialog.getControl("export").getPosSize()
        choice = menu.execute(self.dialog.getPeer(), Rectangle(pos.X, pos.Y + pos.Height, 0, 0), 0)
        self.export(choice)

    def export(self, choice, path=None):
        """Runs one export action. ``path`` skips the file picker (tests)."""
        if choice == COPY_SOURCE:
            clip = self.smgr.createInstanceWithContext("com.sun.star.datatransfer.clipboard.SystemClipboard", self.ctx)
            clip.setContents(_TextTransferable(self._m("source").Text), None)
            self.set_status("LaTeX source copied.", "ok")
            return
        if choice not in (EXPORT_SVG, EXPORT_PDF, EXPORT_PNG) or self.last is None:
            return
        ext, label = {EXPORT_SVG: ("svg", "SVG"), EXPORT_PDF: ("pdf", "PDF"), EXPORT_PNG: ("png", "PNG")}[choice]
        path = path or self._ask_save_path(label, ext)
        if not path:
            return
        if choice == EXPORT_SVG:
            with open(path, "w", encoding="utf-8") as f:
                f.write(self.last["svg"])
        elif choice == EXPORT_PDF:
            with open(path, "wb") as f:
                f.write(self.last["pdf"])
        else:
            w_pt = self.last["size_pt"][0] * float(self.settings["sizePercent"]) / 100.0
            # 4x the on-slide size at 96 dpi: crisp, without a huge file.
            insert.export_png(self.ctx, self.last["graphic"], path, max(64, int(round(w_pt / 72.0 * 96 * 4))))
        self.set_status("Saved %s." % path, "ok")

    def _ask_save_path(self, label, ext):
        picker = self.smgr.createInstanceWithContext("com.sun.star.ui.dialogs.FilePicker", self.ctx)
        picker.initialize((10,))  # TemplateDescription.FILESAVE_AUTOEXTENSION
        picker.appendFilter("%s (*.%s)" % (label, ext), "*.%s" % ext)
        picker.setCurrentFilter("%s (*.%s)" % (label, ext))
        picker.setDefaultName("texer.%s" % ext)
        if picker.execute() != 1:
            return None
        files = picker.getSelectedFiles() if hasattr(picker, "getSelectedFiles") else picker.getFiles()
        if not files:
            return None
        path = uno.fileUrlToSystemPath(files[0])
        return path if path.lower().endswith("." + ext) else path + "." + ext

    # ── recents and saved snippets ──
    def on_list_mode(self):
        if self.loading:
            return
        self.list_mode = max(0, self._selected("list_mode"))
        self.refresh_list()

    def refresh_list(self):
        if self.list_mode == 1:
            self.list_items = self.store.load_snippets()
            labels = ["[%s] %s" % (snippets.WORKSPACE_LABELS.get(s.get("workspace"), "?"), s["label"]) for s in self.list_items]
        else:
            self.list_items = self.store.load_history()
            labels = ["[%s] %s" % (snippets.WORKSPACE_LABELS.get(e.get("workspace"), "?"), " ".join(e["source"].split())[:80])
                      for e in self.list_items]
        self._m("recents").StringItemList = tuple(labels)

    # Kept for callers that think in terms of the old Recents-only list.
    @property
    def recents(self):
        return self.store.load_history()

    def load_list_item(self):
        idx = self._selected("recents")
        if 0 <= idx < len(self.list_items):
            e = self.list_items[idx]
            self._end_editing()
            self.switch_workspace(e.get("workspace") if e.get("workspace") in snippets.WORKSPACES else "latex",
                                  carry_source=e["source"])
            self.dialog.getControl("source").setFocus()

    load_recent = load_list_item

    def delete_list_item(self):
        idx = self._selected("recents")
        if not (0 <= idx < len(self.list_items)):
            return
        if self.list_mode == 1:
            self.store.remove_snippet(self.list_items[idx]["id"])
            self._fill_examples()
        else:
            self.store.remove_history(self.list_items[idx]["id"])
        self.refresh_list()

    # ── settings ──
    def open_settings(self):
        from .settings_dialog import run_settings_dialog
        updated = run_settings_dialog(self.ctx, self.dialog.getPeer(), dict(self.settings), self.store)
        if updated is None:
            return
        self.settings = updated
        self.store.save_settings(self.settings)
        self.loading = True
        try:
            self._fill_box_types()  # presets may have been deleted
        finally:
            self.loading = False
        self._apply_look_controls()
        if self.workspace == "boxes" and not self.box_dirty:
            self.regenerate_box()
        self._m("pill").Label = "Checking TeX..."
        self._m("pill").TextColor = MUTED
        self.probe_backend()

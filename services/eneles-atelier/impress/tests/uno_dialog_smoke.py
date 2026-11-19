"""Drives the real TeXeR window against a headless LibreOffice.

    sh impress/tests/run_uno_smoke.sh dialog

1. Installs release/TeXeR-IMP.oxt into a throwaway profile with unopkg, then
   checks the extension's Launcher service registers and opens a window.
2. Builds a TexerWindow in this process. Its UNO calls go over the bridge,
   so every control, listener and AsyncCallback path is exercised for real.
   It then types, renders, inserts, re-edits, replaces, and switches
   workspaces the way a user would.
"""

import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(ROOT, "python", "pythonpath"))

import uno  # noqa: E402
from com.sun.star.connection import NoConnectException  # noqa: E402

PIPE = "texer_imp_dialog_%d" % os.getpid()


def prop(name, value):
    p = uno.createUnoStruct("com.sun.star.beans.PropertyValue")
    p.Name = name
    p.Value = value
    return p


def wait_for(cond, timeout=60, what="condition"):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return
        time.sleep(0.1)
    raise AssertionError("timed out waiting for " + what)


def main():
    program = os.environ["LO_PROGRAM"]
    profile = tempfile.mkdtemp(prefix="texer-imp-dlg-profile-")
    profile_url = uno.systemPathToFileUrl(profile)
    oxt = os.path.abspath(os.path.join(ROOT, "release", "TeXeR-IMP.oxt"))

    out = subprocess.run([os.path.join(program, "unopkg"), "add", "-f", "-env:UserInstallation=" + profile_url, oxt],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print("unopkg add:", out.returncode, out.stdout.decode().strip() or "(quiet)")
    assert out.returncode == 0

    proc = subprocess.Popen([
        os.path.join(program, "soffice"), "--headless", "--norestore", "--nologo", "--nodefault",
        "-env:UserInstallation=" + profile_url, "--accept=pipe,name=%s;urp;" % PIPE,
    ])
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    ctx = None
    for _ in range(120):
        try:
            ctx = resolver.resolve("uno:pipe,name=%s;urp;StarOffice.ComponentContext" % PIPE)
            break
        except NoConnectException:
            time.sleep(0.5)
    assert ctx, "soffice did not come up"

    try:
        smgr = ctx.ServiceManager
        desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
        doc = desktop.loadComponentFromURL("private:factory/simpress", "_blank", 0, ())
        frame = doc.getCurrentController().getFrame()
        frame.activate()

        # 1. The installed extension's own entry point.
        launcher = smgr.createInstanceWithContext("org.texer.imp.Launcher", ctx)
        assert launcher is not None, "Launcher service not registered by the .oxt"
        toolkit = smgr.createInstanceWithContext("com.sun.star.awt.Toolkit", ctx)
        before = toolkit.getTopWindowCount()
        launcher.trigger("open")
        wait_for(lambda: toolkit.getTopWindowCount() > before, 15, "the extension's window")
        print("extension installed; Launcher opened a window (%d -> %d top windows)" % (before, toolkit.getTopWindowCount()))

        # 2. Drive the window code directly.
        from texer_imp import boxes, dialog, insert

        win = dialog.TexerWindow(ctx, frame)
        wait_for(lambda: win.backend_status is not None, 15, "backend probe")
        print("pill:", win._m("pill").Label, "|", win.backend_status["message"])
        assert win.backend_status["backend"], win.backend_status["message"]

        def typed(text):
            win.dialog.getControl("source").setText(text)

        def finish():
            wait_for(lambda: not win.busy, 90, "render")
            return win._m("status").Label

        def texer_shapes():
            page = insert.current_page(doc)
            shapes = [page.getByIndex(i) for i in range(page.getCount())]
            return [s for s in shapes if insert.read_meta(s)]

        def meta(shape):
            return insert.read_meta(shape) or {}

        def inserted(n):
            # The window's own counter, not a shape count: over the bridge the
            # callback thread and this one race, so count only after it's done.
            wait_for(lambda: win.insert_count == n and not win.busy, 90, "insert #%d" % n)

        # Math: render, then insert (no recompile).
        win.switch_workspace("math")
        typed("\\sum_{n=1}^\\infty \\frac{1}{n^2} = \\frac{\\pi^2}{6}")
        win.render()
        status = finish()
        print("math render:", status)
        assert "Compiled" in status, status
        assert win._m("preview").Graphic is not None
        win.insert()
        inserted(1)
        assert len(texer_shapes()) == 1
        print("math insert:", win._m("status").Label)

        # Ctrl+Shift+Enter path: insert straight from new source (render-then-insert).
        typed("a^2 + b^2 = c^2")
        win.on_hotkey(True)
        inserted(2)
        assert len(texer_shapes()) == 2
        print("render+insert in one go: ok")

        # TikZ: example dropdown, library chip, insert.
        win.switch_workspace("tikz")
        ex_labels = list(win._m("examples").StringItemList)
        win._m("examples").SelectedItems = (ex_labels.index("Circuit"),)
        win.on_example()
        assert "circuitikz" in win._m("source").Text
        win._m("tikz_lib").SelectedItems = (0,)
        win.on_tikz_add()
        assert win._m("source").Text.startswith("\\usetikzlibrary{arrows.meta}")
        win.on_tikz_add()  # duplicate click is ignored
        assert win._m("source").Text.count("arrows.meta}") == 1
        win.insert()
        inserted(3)
        assert len(texer_shapes()) == 3
        print("tikz example + chip + insert: ok")

        # Boxes: generated from fields, regenerate on field change, protect hand edits.
        win.switch_workspace("boxes")
        win.dialog.getControl("box_title").setText("Pythagoras")
        win.on_box_field_changed()
        assert "Pythagoras" in win._m("source").Text
        typed(win._m("source").Text + "\n% hand edit")
        win.on_source_changed()
        win.dialog.getControl("box_title").setText("Changed")
        win.on_box_field_changed()
        assert "% hand edit" in win._m("source").Text and "Changed" not in win._m("source").Text
        win.regenerate_box()
        assert "Changed" in win._m("source").Text
        win.insert()
        inserted(4)
        box = [s for s in texer_shapes() if meta(s).get("workspace") == "boxes"][0]
        slide_w = insert.current_page(doc).Width
        print("box width: %.0f%% of slide (field says 60%%)" % (100.0 * box.getSize().Width / slide_w))
        assert abs(box.getSize().Width / float(slide_w) - 0.60) < 0.03

        # Drafts are per workspace.
        win.switch_workspace("math")
        assert win._m("source").Text == "a^2 + b^2 = c^2", win._m("source").Text

        # Math source that is really TikZ moves itself to the TikZ workspace.
        typed("\\begin{tikzpicture}\\draw (0,0) circle (1);\\end{tikzpicture}")
        win.render()
        finish()
        assert win.workspace == "tikz", win.workspace
        print("auto-switch math -> tikz: ok")

        # Re-edit: select the first equation, the window offers Replace.
        first = [s for s in texer_shapes() if "\\sum" in meta(s).get("source", "")][0]
        doc.getCurrentController().select(first)
        win.on_selection_changed()
        # Merely selecting an object must not arm a replace.
        assert win._m("insert").Label == "Insert"
        assert win._m("edit_sel").Enabled
        win.edit_selected()
        assert win._m("insert").Label == "Replace selected"
        assert win.workspace == "math" and "\\sum" in win._m("source").Text
        pos = first.getPosition()
        typed("\\prod_{p} \\frac{1}{1-p^{-s}} = \\zeta(s)")
        win.insert()
        inserted(5)
        replaced = [s for s in texer_shapes() if "zeta" in meta(s).get("source", "")][0]
        assert len(texer_shapes()) == 4
        assert (replaced.getPosition().X, replaced.getPosition().Y) == (pos.X, pos.Y)
        print("edit selected + replace in place: ok")

        # Errors surface in the status line.
        win.switch_workspace("latex")
        typed("\\undefinedcommand")
        win.render()
        status = finish()
        print("error status:", status.splitlines()[0])
        assert "Undefined control sequence" in status

        # Recents recorded and loadable.
        assert len(win.recents) >= 4
        win._m("recents").SelectedItems = (0,)
        win.load_recent()

        # The first box was auto-numbered.
        first_box = [meta(s) for s in texer_shapes() if meta(s).get("workspace") == "boxes"][0]
        assert first_box["box"]["number"] == "1" and first_box["box"]["auto"], first_box["box"]

        # Saved snippets show up in Examples for their workspace.
        win.store.save_snippet("My integral", "math", "\\oint_C f(z)\\,dz = 0")
        win.switch_workspace("math")
        labels = list(win._m("examples").StringItemList)
        assert dialog.SAVED_MARK + "My integral" in labels, labels
        win._m("examples").SelectedItems = (labels.index(dialog.SAVED_MARK + "My integral"),)
        win.on_example()
        assert "\\oint" in win._m("source").Text
        win.list_mode = 1
        win.refresh_list()
        assert any("My integral" in x for x in win._m("recents").StringItemList)
        print("saved snippet -> Examples + Saved list: ok")

        # Custom label + saved box preset + auto numbering continues per label.
        win.store.save_box_preset({"name": "Conj", "label": "Conjecture", "style": "rounded",
                                   "accent": "#7A2E8A", "fill": ""})
        win.switch_workspace("boxes")
        win._fill_box_types()
        win._m("box_type").Text = dialog.SAVED_MARK + "Conj"
        win.on_box_type_picked()
        assert win._m("box_type").Text == "Conjecture"
        assert boxes.STYLE_IDS[win._selected("box_style")] == "rounded"
        win.dialog.getControl("box_title").setText("Twin primes")
        win.on_box_field_changed()
        assert "Conjecture 1" in win._m("source").Text and "arc=2.5mm" in win._m("source").Text
        win.insert()
        inserted(6)
        win._m("box_type").Text = "Theorem"
        win.on_box_field_changed()
        assert "Theorem 2" in win._m("source").Text, win._m("source").Text
        win.insert()
        inserted(7)
        assert len(texer_shapes()) == 6, "a new box replaced an object instead of being added"
        print("custom label, preset, auto numbers (Conjecture 1, Theorem 2): ok")

        # Exports of the last render.
        out_dir = os.path.join(HERE, "out")
        os.makedirs(out_dir, exist_ok=True)
        for choice, ext in ((dialog.EXPORT_SVG, "svg"), (dialog.EXPORT_PDF, "pdf"), (dialog.EXPORT_PNG, "png")):
            path = os.path.join(out_dir, "export." + ext)
            if os.path.exists(path):
                os.remove(path)
            win.export(choice, path)
            assert os.path.getsize(path) > 200, (ext, os.path.getsize(path))
        with open(os.path.join(out_dir, "export.png"), "rb") as f:
            assert f.read(8) == b"\x89PNG\r\n\x1a\n"
        print("export SVG/PDF/PNG: ok")

        # Dark slide: switch the Look, re-render everything already placed.
        try:
            bg = doc.createInstance("com.sun.star.drawing.Background")
            bg.FillStyle = uno.Enum("com.sun.star.drawing.FillStyle", "SOLID")
            bg.FillColor = 0x1F1F1F
            insert.current_page(doc).Background = bg
        except Exception as e:
            print("(could not darken the slide background for the picture: %s)" % e)
        win._m("preset").SelectedItems = (1,)
        win.on_preset()
        assert win.settings["slidePreset"] == "dark"
        assert win._m("preview").BackgroundColor == 0x1F1F1F
        count = len(texer_shapes())
        positions = sorted((s.getPosition().X, s.getPosition().Y) for s in texer_shapes())
        win.rerender_all()
        wait_for(lambda: not win.busy, 180, "re-render all")
        print("re-render all:", win._m("status").Label)
        assert win.rerender_done == count, (win.rerender_done, count)
        assert len(texer_shapes()) == count
        assert sorted((s.getPosition().X, s.getPosition().Y) for s in texer_shapes()) == positions
        dark_box = [meta(s) for s in texer_shapes() if meta(s).get("workspace") == "boxes"][0]
        fill_hex = boxes.colors(dark_box["box"]["accent"], "", "1F1F1F")[1]
        assert fill_hex in dark_box["source"], "box not rebuilt for the dark paper"
        print("dark Look + re-render all kept %d objects in place: ok" % count)

        # Persisted state survives a new window.
        win.close()
        win2 = dialog.TexerWindow(ctx, frame)
        assert win2.drafts["math"], "drafts not persisted"
        win2.close()

        out_dir = os.path.join(HERE, "out")
        os.makedirs(out_dir, exist_ok=True)
        png = os.path.join(out_dir, "dialog.png")
        doc.storeToURL(uno.systemPathToFileUrl(png), (
            prop("FilterName", "impress_png_Export"),
            prop("FilterData", uno.Any("[]com.sun.star.beans.PropertyValue",
                                       (prop("PixelWidth", 1600), prop("PixelHeight", 900)))),
        ))
        doc.close(True)
        print("OK: dialog flow passed; slide exported to", png)
    finally:
        try:
            desktop.terminate()
        except Exception:
            pass
        try:
            proc.wait(timeout=15)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    main()

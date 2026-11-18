"""Headless end-to-end check of the insert path inside a real LibreOffice.

Must run under LibreOffice's own Python (it needs `uno`). Via the runner:

    sh impress/tests/run_uno_smoke.sh

It starts a headless soffice, makes a new Impress document, compiles three
renders through texer_imp.backend (direct, or the helper for a snap),
inserts them, replaces one in place, saves .odp, reloads it, checks the
TeXeR metadata survived, and exports a PNG of the slide to tests/out/.
"""

import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "python", "pythonpath"))

import uno  # noqa: E402
from com.sun.star.connection import NoConnectException  # noqa: E402

from texer_imp import backend, boxes, insert, latex, snippets, svg  # noqa: E402

OUT = os.path.join(HERE, "out")
PIPE = "texer_imp_smoke_%d" % os.getpid()


def prop(name, value):
    p = uno.createUnoStruct("com.sun.star.beans.PropertyValue")
    p.Name = name
    p.Value = value
    return p


def start_office():
    profile = tempfile.mkdtemp(prefix="texer-imp-profile-")
    soffice = os.environ.get("SOFFICE", "soffice")
    proc = subprocess.Popen([
        soffice, "--headless", "--invisible", "--norestore", "--nologo", "--nodefault",
        "-env:UserInstallation=" + uno.systemPathToFileUrl(profile),
        "--accept=pipe,name=%s;urp;" % PIPE,
    ])
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    for _ in range(120):
        try:
            ctx = resolver.resolve("uno:pipe,name=%s;urp;StarOffice.ComponentContext" % PIPE)
            return proc, ctx
        except NoConnectException:
            time.sleep(0.5)
    proc.kill()
    raise SystemExit("soffice did not come up")


def render(settings, workspace, source):
    tex_source = latex.wrap_math(source, True) if workspace == "math" else source
    r = backend.compile_svg(settings, tex_source, "")
    assert r["success"] and r["svg"], r["errors"]
    return r


def main():
    os.makedirs(OUT, exist_ok=True)
    # A previous run killed mid-way leaves .~lock files that make the store fail.
    for name in os.listdir(OUT):
        if name.startswith((".~lock", "smoke.")):
            os.remove(os.path.join(OUT, name))
    settings = {
        "backend": os.environ.get("TEXER_BACKEND", "auto"),
        "helperUrl": os.environ.get("TEXER_HELPER_URL", "http://127.0.0.1:47823"),
        "engine": "pdflatex",
        "sizeMode": "natural",
        "sizePercent": 250,
        "insertWidthIn": 3,
    }
    st = backend.status(settings)
    print("backend:", st["message"])
    assert st["backend"], st["message"]

    proc, ctx = start_office()
    try:
        desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
        doc = desktop.loadComponentFromURL("private:factory/simpress", "_blank", 0, (prop("Hidden", True),))
        assert insert.is_draw_like(doc)

        inserted = []
        slide_in = insert.current_page(doc).Width / 2540.0
        cases = [
            ("math", next(x for x in snippets.SNIPPETS if x["workspace"] == "math")["source"]),
            ("tikz", next(x for x in snippets.SNIPPETS if x["workspace"] == "tikz")["source"]),
            ("boxes", boxes.build_box_source("Theorem", "1", "Pythagoras", "$a^2+b^2=c^2$", 60, "%",
                                             slide_width_in=slide_in, size_percent=settings["sizePercent"])),
        ]
        for workspace, source in cases:
            t = time.time()
            r = render(settings, workspace, source)
            graphic = insert.load_graphic(ctx, r["svg"].encode("utf-8"), "image/svg+xml")
            w_pt, h_pt = svg.natural_size_pt(r["svg"])
            size = insert.size_from_pt(w_pt, h_pt, settings)
            shape = insert.insert_or_replace(doc, graphic, size, {"source": source, "workspace": workspace})
            print("inserted %-5s %5dms via %s/%s, size %s" % (workspace, (time.time() - t) * 1000, r["backend"], r["tool"], size))
            inserted.append(shape)

        # Spread them out so the PNG is readable.
        from com.sun.star.awt import Point
        y = 800
        for s in inserted:
            s.setPosition(Point(1000, y))
            y += s.getSize().Height + 600

        # Replace the equation in place after a manual resize: position and
        # the user's scale factor must survive.
        eq = inserted[0]
        eq.setSize(uno.createUnoStruct("com.sun.star.awt.Size", eq.getSize().Width * 2, eq.getSize().Height * 2))
        pos_before = eq.getPosition()
        r = render(settings, "math", "e^{i\\pi} + 1 = 0")
        g = insert.load_graphic(ctx, r["svg"].encode("utf-8"), "image/svg+xml")
        nat = insert.size_from_pt(*svg.natural_size_pt(r["svg"]), settings=settings)
        new_eq = insert.insert_or_replace(doc, g, nat, {"source": "e^{i\\pi} + 1 = 0", "workspace": "math"}, replace=eq)
        assert new_eq.getPosition().X == pos_before.X and new_eq.getPosition().Y == pos_before.Y
        assert abs(new_eq.getSize().Width - nat[0] * 2) <= 2, (new_eq.getSize().Width, nat[0] * 2)
        print("replace kept position and 2x manual scale")

        # PDF fallback path.
        g_pdf = insert.load_graphic(ctx, r["pdf"], "application/pdf")
        assert g_pdf is not None
        print("PDF graphic loads")

        # A new slide also carries the layout's empty title/subtitle placeholders.
        page = insert.current_page(doc)
        texer_count = sum(1 for i in range(page.getCount()) if insert.read_meta(page.getByIndex(i)))
        assert texer_count == 3, texer_count

        odp = os.path.join(OUT, "smoke.odp")
        doc.storeToURL(uno.systemPathToFileUrl(odp), (prop("FilterName", "impress8"),))
        png = os.path.join(OUT, "smoke.png")
        doc.storeToURL(uno.systemPathToFileUrl(png), (
            prop("FilterName", "impress_png_Export"),
            prop("FilterData", uno.Any("[]com.sun.star.beans.PropertyValue", (prop("PixelWidth", 1600), prop("PixelHeight", 900)))),
        ))
        doc.close(True)

        doc2 = desktop.loadComponentFromURL(uno.systemPathToFileUrl(odp), "_blank", 0, (prop("Hidden", True),))
        page2 = doc2.getDrawPages().getByIndex(0)
        metas = [m for m in (insert.read_meta(page2.getByIndex(i)) for i in range(page2.getCount())) if m]
        workspaces = sorted(m.get("workspace", "?") for m in metas)
        print("after reload:", workspaces)
        assert workspaces == ["boxes", "math", "tikz"], metas
        assert any(m.get("source") == "e^{i\\pi} + 1 = 0" for m in metas)
        doc2.close(True)
        print("OK: wrote", odp, "and", png)
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

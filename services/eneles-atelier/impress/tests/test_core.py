"""Pure-Python tests for the UNO-free core. Runs against the real TeX on PATH.

    python3 -m unittest discover -s impress/tests -v

Compile tests are skipped when no TeX engine is installed.
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python", "pythonpath"))

from texer_imp import boxes, latex, look, snippets, store, svg  # noqa: E402
from texer_imp import compile as tex  # noqa: E402

HAVE_TEX = bool(tex.detect_environment()["engines"])


class LatexTests(unittest.TestCase):
    def test_wraps_bare_snippet_and_hoists_preamble(self):
        out = latex.build_standalone_latex("\\usetikzlibrary{calc}\n\\begin{tikzpicture}\\end{tikzpicture}")
        head, body = out.split("\\begin{document}")
        self.assertIn("\\documentclass[preview,border=2pt]{standalone}", head)
        self.assertIn("\\usetikzlibrary{calc}", head)
        self.assertNotIn("usetikzlibrary", body)

    def test_multiline_definition_is_hoisted_whole(self):
        src = "\\newcommand{\\foo}{%\n  bar\n}\n$\\foo$"
        head, body = latex.build_standalone_latex(src).split("\\begin{document}")
        self.assertIn("  bar", head)
        self.assertIn("$\\foo$", body)

    def test_escaped_braces_dont_unbalance_hoisting(self):
        # powerpoint/'s braceDelta compares a char against "\\\\" (two chars), so it
        # never skips escapes; \{ in a macro would swallow the body there.
        src = "\\newcommand{\\lb}{\\{}\n$\\lb x$"
        head, body = latex.build_standalone_latex(src).split("\\begin{document}")
        self.assertIn("\\newcommand{\\lb}{\\{}", head)
        self.assertIn("$\\lb x$", body)

    def test_full_document_untouched(self):
        doc = "\\documentclass{article}\\begin{document}x\\end{document}"
        self.assertEqual(latex.build_standalone_latex(doc), doc)

    def test_does_not_duplicate_packages(self):
        out = latex.build_standalone_latex("\\usepackage{amsmath}\n$x$")
        self.assertEqual(out.count("{amsmath}"), 1)

    def test_dangerous_commands(self):
        for bad in ("\\write18{rm -rf}", "\\immediate\\write18{x}", "\\input{|ls}", "\\directlua{}", "\\latelua{}"):
            self.assertTrue(latex.contains_dangerous_commands(bad), bad)
        self.assertFalse(latex.contains_dangerous_commands("\\input{foo}"))

    def test_wrap_math(self):
        self.assertEqual(latex.wrap_math("x", True), "$\\displaystyle x$")
        self.assertEqual(latex.wrap_math("x", False), "$x$")
        self.assertEqual(latex.wrap_math("\\[x\\]", True), "\\[x\\]")

    def test_classifiers(self):
        self.assertTrue(latex.looks_like_full_latex("\\begin{tikzpicture}"))
        self.assertFalse(latex.looks_like_full_latex("\\frac{a}{b}"))
        self.assertTrue(latex.looks_like_tikz("\\draw (0,0) -- (1,1);"))

    def test_extract_errors(self):
        log = "foo\n! Undefined control sequence.\nl.5 \\bad\n./main.tex:5: oops\n! Undefined control sequence.\n"
        self.assertEqual(latex.extract_errors(log), ["! Undefined control sequence.", "l.5 \\bad", "./main.tex:5: oops"])


class BoxTests(unittest.TestCase):
    def test_tint(self):
        self.assertEqual(look.mix("000000", "FFFFFF", 0.94), "F0F0F0")
        self.assertEqual(look.mix("FFFFFF", "FFFFFF", 0.94), "FFFFFF")

    def test_width_expression_works_back_from_slide_width(self):
        # 50% of a 10in slide = 5in on the slide; inserted at 250% -> 2in in TeX.
        self.assertEqual(boxes.width_expression(50, "%", 10, 250), "2in")
        self.assertEqual(boxes.width_expression(5, "in", 10, 100), "5in")
        self.assertEqual(boxes.width_expression(9999, "%", 10, 100), "10in")  # capped at the slide
        self.assertEqual(boxes.width_expression("junk", "%", 10, 100), "6in")  # default 60%

    def test_source_uses_type_accent(self):
        src = boxes.build_box_source("Lemma", "2", "Title", "Body")
        self.assertIn("{HTML}{A5410D}", src)
        self.assertIn("Lemma 2", src)
        self.assertIn("Body", src)

    def test_slide_width_inches(self):
        self.assertAlmostEqual(boxes.slide_width_inches(2.54, "cm", 10), 1.0)
        self.assertAlmostEqual(boxes.slide_width_inches(50, "%", 4), 2.0)


class SvgTests(unittest.TestCase):
    def test_pt_size(self):
        s = "<svg version='1.1' width='42.5pt' height='10pt' viewBox='0 0 1 1'>"
        self.assertEqual(svg.natural_size_pt(s), (42.5, 10.0))

    def test_viewbox_fallback(self):
        self.assertEqual(svg.natural_size_pt('<svg viewBox="0 0 20 30">'), (20.0, 30.0))

    def test_pdf_size(self):
        self.assertEqual(svg.pdf_size_pt(b"<< /MediaBox [0 0 42.5 10] >>"), (42.5, 10.0))


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = store.Store(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_settings_roundtrip_and_validation(self):
        s = self.store.load_settings()
        self.assertEqual(s, store.DEFAULT_SETTINGS)
        s.update(engine="nonsense", sizePercent=150, displayMath="yes")
        self.store.save_settings(s)
        loaded = self.store.load_settings()
        self.assertEqual(loaded["engine"], "pdflatex")
        self.assertEqual(loaded["sizePercent"], 150)
        self.assertIs(loaded["displayMath"], True)

    def test_history_dedupes_and_caps(self):
        for i in range(store.MAX_HISTORY + 5):
            self.store.record_history("x%d" % i, "math")
        entries = self.store.record_history("x3", "math")
        self.assertEqual(entries[0]["source"], "x3")
        self.assertEqual(len(entries), store.MAX_HISTORY)
        self.assertEqual(sum(1 for e in entries if e["source"] == "x3"), 1)
        self.assertEqual(len(self.store.remove_history(entries[0]["id"])), store.MAX_HISTORY - 1)


class LookTests(unittest.TestCase):
    def test_presets_resolve(self):
        self.assertEqual(look.resolve({"slidePreset": "light"}), ("171717", "FFFFFF"))
        self.assertEqual(look.resolve({"slidePreset": "dark"}), ("F5F5F5", "1F1F1F"))
        self.assertEqual(look.resolve({"slidePreset": "custom", "ink": "#ff0000", "paper": "#000000"}), ("FF0000", "000000"))
        self.assertEqual(look.resolve({"slidePreset": "custom", "ink": "junk"}), ("171717", "FFFFFF"))

    def test_readable_on_dark_paper(self):
        navy = "222B82"
        self.assertLess(look.contrast(navy, "1F1F1F"), 3)
        fixed = look.readable_on(navy, "1F1F1F")
        self.assertGreaterEqual(look.contrast(fixed, "1F1F1F"), 3)
        self.assertEqual(look.readable_on(navy, "FFFFFF"), navy)  # already fine on white

    def test_ink_and_font_injected_only_into_wrapped_snippets(self):
        out = latex.build_standalone_latex("$x$", ink="#C03030", font="palatino")
        head, body = out.split("\\begin{document}")
        self.assertIn("\\definecolor{texerInk}{HTML}{C03030}", head)
        self.assertIn("newpxmath", head)
        self.assertTrue(body.lstrip().startswith("\\color{texerInk}"))
        doc = "\\documentclass{article}\\begin{document}x\\end{document}"
        self.assertEqual(latex.build_standalone_latex(doc, ink="#C03030", font="times"), doc)

    def test_default_font_adds_nothing(self):
        self.assertEqual(look.font_lines("cm"), ())
        self.assertEqual(look.font_lines("system", ""), ())
        self.assertIn("\\setmainfont{Fira Sans}", look.font_lines("system", "Fira Sans"))
        self.assertNotIn("}", look.font_lines("system", "Evil}\\input{x")[1][len("\\setmainfont{"):-1])

    def test_package_match_is_whole_name(self):
        out = latex.build_standalone_latex("\\usepackage{tikz-3dplot}\n\\tikz\\draw (0,0)--(1,0);")
        self.assertIn("\\usepackage{tikz}", out)
        out = latex.build_standalone_latex("\\usepackage{amsmath,tikz}\nx")
        self.assertEqual(out.count("{tikz}"), 0)  # only the user's own load, in the list


class BoxStyleTests(unittest.TestCase):
    def test_free_label_and_default_accent(self):
        src = boxes.build_box_source("Conjecture", "3", "Goldbach", "Every even n > 2 ...")
        self.assertIn("Conjecture 3", src)
        self.assertIn("{HTML}{7A2E8A}", src)
        src = boxes.build_box_source("My Thing", "", "", "x")
        self.assertIn("My Thing", src)
        self.assertIn("{HTML}{%s}" % boxes.DEFAULT_ACCENT, src)

    def test_titlebar_moves_heading_into_title(self):
        src = boxes.build_box_source("Lemma", "2", "Zorn", "x", style="titlebar")
        self.assertIn("title={Lemma 2: Zorn}", src)
        self.assertNotIn("\\bfseries Lemma", src)

    def test_fill_follows_paper(self):
        _a, light_fill, _t = boxes.colors("222B82", "", "FFFFFF")
        _a, dark_fill, _t = boxes.colors("222B82", "", "1F1F1F")
        self.assertTrue(look.luminance(light_fill) > 0.7 > look.luminance(dark_fill))
        self.assertEqual(boxes.colors("222B82", "#123456", "FFFFFF")[1], "123456")

    def test_next_number(self):
        self.assertEqual(boxes.next_number([]), "1")
        self.assertEqual(boxes.next_number(["1", "3", "A", ""]), "4")

    def test_from_fields_accepts_old_metadata(self):
        src = boxes.build_from_fields({"type": "Lemma", "number": "1"}, "FFFFFF", 10, 250)
        self.assertIn("Lemma 1", src)


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = store.Store(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_old_math_colour_becomes_custom_look(self):
        self.store._write("settings.json", {"mathColor": "#C03030"})
        s = self.store.load_settings()
        self.assertEqual((s["slidePreset"], s["ink"]), ("custom", "#C03030"))
        self.store._write("settings.json", {"mathColor": "#171717"})
        self.assertEqual(self.store.load_settings()["slidePreset"], "light")

    def test_snippets(self):
        self.store.save_snippet("A", "math", "x")
        self.store.save_snippet("A", "math", "y")  # same label overwrites
        items = self.store.save_snippet("B", "tikz", "z")
        self.assertEqual([i["label"] for i in items], ["B", "A"])
        self.assertEqual(self.store.load_snippets()[1]["source"], "y")
        self.assertEqual(len(self.store.remove_snippet(items[0]["id"])), 1)

    def test_box_presets(self):
        self.store.save_box_preset({"name": "Conj", "label": "Conjecture", "style": "rounded", "accent": "#7A2E8A", "fill": ""})
        self.assertEqual(self.store.load_box_presets()[0]["style"], "rounded")
        self.assertEqual(self.store.remove_box_preset("Conj"), [])


@unittest.skipUnless(HAVE_TEX, "no TeX engine on PATH")
class LookCompileTests(unittest.TestCase):
    def test_every_font_compiles(self):
        for fid, _label, _lines, _u in look.FONTS:
            with self.subTest(fid):
                r = tex.compile_svg("Text $\\int_0^1 x^2\\,dx$", ink="#171717", font=fid, font_name="DejaVu Sans")
                self.assertTrue(r["success"], r["errors"])
                if fid == "system":
                    self.assertEqual(r["engine"], "xelatex")

    def test_ink_reaches_the_svg(self):
        r = tex.compile_svg("\\tikz\\draw (0,0) -- (1,0); $x$", ink="#C03030")
        self.assertIn("c03030", r["svg"].lower())

    def test_every_library_chip_compiles(self):
        for label, line in snippets.TIKZ_LIBRARY_CHIPS:
            with self.subTest(label):
                r = tex.compile_svg(line + "\n\\tikz\\draw (0,0)--(1,0);")
                self.assertTrue(r["success"], r["errors"])

    def test_every_box_style_on_dark_paper(self):
        for style in boxes.STYLE_IDS:
            with self.subTest(style):
                src = boxes.build_box_source("Conjecture", "1", "T", "$x$", style=style, paper="#1F1F1F")
                r = tex.compile_svg(src, ink="#F5F5F5")
                self.assertTrue(r["success"], r["errors"])


@unittest.skipUnless(HAVE_TEX, "no TeX engine on PATH")
class CompileTests(unittest.TestCase):
    def assertCompiles(self, source, **kw):
        r = tex.compile_svg(source, **kw)
        self.assertTrue(r["success"], r["errors"])
        self.assertTrue(r["svg"] and "<svg" in r["svg"], r["errors"])
        self.assertTrue(r["pdf"].startswith(b"%PDF"))
        w, h = svg.natural_size_pt(r["svg"])
        self.assertGreater(w, 1)
        self.assertGreater(h, 1)
        return r

    def test_math(self):
        self.assertCompiles(latex.wrap_math("\\int_0^1 x^2\\,dx", True), ink="#171717")

    def test_every_example(self):
        for snip in snippets.SNIPPETS:
            with self.subTest(snip["id"]):
                src = snip["source"]
                if snip["workspace"] == "math":
                    src = latex.wrap_math(src)
                self.assertCompiles(src)

    def test_every_tikz_template(self):
        for label, src in snippets.TIKZ_TEMPLATES:
            with self.subTest(label):
                self.assertCompiles(src)

    def test_box(self):
        r = self.assertCompiles(boxes.build_box_source("Theorem", "1", "Pythagoras", "$a^2+b^2=c^2$", 50, "%",
                                                          slide_width_in=10, size_percent=250))
        # 2in of TeX width (+2pt crop border each side) = 148pt.
        self.assertAlmostEqual(svg.natural_size_pt(r["svg"])[0], 148, delta=2)

    def test_pdftocairo_fallback(self):
        env = tex.detect_environment()
        if not env["hasPdftocairo"]:
            self.skipTest("no pdftocairo")
        orig = tex.detect_environment
        tex.detect_environment = lambda bin_dir=None: dict(orig(bin_dir), hasDvisvgm=False)
        try:
            r = self.assertCompiles(latex.wrap_math("e^{i\\pi}+1=0"))
            self.assertEqual(r["tool"], "pdftocairo")
        finally:
            tex.detect_environment = orig

    def test_forbidden(self):
        r = tex.compile_svg("\\immediate\\write18{touch /tmp/pwned}")
        self.assertFalse(r["success"])
        self.assertIn("Forbidden", r["errors"][0])

    def test_broken_source_reports_error(self):
        r = tex.compile_svg("$\\undefinedmacro$")
        self.assertFalse(r["success"])
        self.assertTrue(any("Undefined control sequence" in e for e in r["errors"]), r["errors"])

    def test_bad_engine(self):
        self.assertFalse(tex.compile_svg("x", engine="bash")["success"])


if __name__ == "__main__":
    unittest.main()

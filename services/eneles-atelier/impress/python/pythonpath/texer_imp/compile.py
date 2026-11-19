"""TeX -> PDF -> SVG. A port of the compile route in powerpoint/app/server.js.

Runs whatever pdflatex/xelatex/lualatex is installed on this machine, then
converts the PDF to a cropped SVG with dvisvgm, falling back to pdftocairo.
The fallback matters: dvisvgm's --pdf mode depends on Ghostscript and has
been broken against Ghostscript >= 10.01, which is exactly what several
TeX Live releases ship. See convert_pdf_to_svg.

No UNO imports here. The extension calls this directly, and the helper
(helper/texer_imp_helper.py) calls it on behalf of a sandboxed LibreOffice.
"""

import glob
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from . import latex, look

ENGINES = ("pdflatex", "xelatex", "lualatex")
JOB_TIMEOUT_S = 45
SVG_TIMEOUT_S = 20

# One compile at a time per process. TeX is CPU-bound and the UI only ever
# has one render in flight; the helper raises this via set_max_concurrent.
_slots = threading.BoundedSemaphore(1)


def set_max_concurrent(n):
    global _slots
    _slots = threading.BoundedSemaphore(max(1, int(n)))


def _candidate_dirs():
    """Folders TeX usually lives in that may be missing from PATH.

    GUI apps on macOS don't inherit the login shell's PATH, and on Linux a
    desktop launcher often doesn't either, so pdflatex can be installed and
    working in a terminal yet invisible to LibreOffice.
    """
    dirs = []
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA", "")
        program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        dirs += sorted(glob.glob(r"C:\texlive\*\bin\windows"), reverse=True)
        dirs += sorted(glob.glob(r"C:\texlive\*\bin\win32"), reverse=True)
        dirs += [
            os.path.join(local, "Programs", "MiKTeX", "miktex", "bin", "x64"),
            os.path.join(program_files, "MiKTeX", "miktex", "bin", "x64"),
        ]
    else:
        dirs += ["/Library/TeX/texbin"]
        dirs += sorted(glob.glob("/usr/local/texlive/*/bin/*"), reverse=True)
        dirs += sorted(glob.glob(os.path.expanduser("~/texlive/*/bin/*")), reverse=True)
        dirs += ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", os.path.expanduser("~/bin")]
    return [d for d in dirs if d and os.path.isdir(d)]


def search_path(bin_dir=None):
    parts = []
    if bin_dir:
        parts.append(os.path.expanduser(bin_dir))
    parts += os.environ.get("PATH", "").split(os.pathsep)
    parts += _candidate_dirs()
    seen = []
    for p in parts:
        if p and p not in seen:
            seen.append(p)
    return os.pathsep.join(seen)


def find_tool(name, bin_dir=None):
    return shutil.which(name, path=search_path(bin_dir))


def detect_environment(bin_dir=None):
    engines = {e: find_tool(e, bin_dir) for e in ENGINES}
    dvisvgm = find_tool("dvisvgm", bin_dir)
    pdftocairo = find_tool("pdftocairo", bin_dir)
    return {
        "ok": True,
        "engines": [e for e in ENGINES if engines[e]],
        "paths": {k: v for k, v in list(engines.items()) + [("dvisvgm", dvisvgm), ("pdftocairo", pdftocairo)] if v},
        "svgTool": "dvisvgm" if dvisvgm else ("pdftocairo" if pdftocairo else None),
        "hasDvisvgm": bool(dvisvgm),
        "hasPdftocairo": bool(pdftocairo),
    }


def _child_env(bin_dir):
    env = dict(os.environ)
    env["PATH"] = search_path(bin_dir)
    # LibreOffice can leave its own library/Python paths in the environment;
    # they have no business inside a TeX run and can break poppler/lua.
    for key in ("PYTHONHOME", "PYTHONPATH"):
        env.pop(key, None)
    ld = env.get("LD_LIBRARY_PATH", "")
    if "libreoffice" in ld.lower() or "/snap/" in ld:
        env.pop("LD_LIBRARY_PATH", None)
    return env


def _run(cmd, cwd, timeout, env):
    kwargs = {}
    if sys.platform == "win32":
        # No console window flashing up on every render.
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            **kwargs
        )
        return proc.returncode, proc.stdout.decode("utf-8", "replace")
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b"").decode("utf-8", "replace")
        return 124, out + "\n[TeXeR] Timed out after %ss." % timeout
    except OSError as e:
        return 127, "[TeXeR] Could not run %s: %s" % (cmd[0], e)


def _svg_command(tool, paths, pdf_path, svg_path, font_mode):
    if tool == "dvisvgm":
        fonts = "--font-format=woff" if font_mode == "embed" else "--no-fonts"
        return [paths["dvisvgm"], "--pdf", fonts, "-o", svg_path, pdf_path]
    return [paths["pdftocairo"], "-svg", pdf_path, svg_path]


def convert_pdf_to_svg(pdf_path, svg_path, env_info, font_mode, cwd, env):
    """Tries dvisvgm, then pdftocairo. Returns (tool or None, combined log)."""
    combined = ""
    for tool, available in (("dvisvgm", env_info["hasDvisvgm"]), ("pdftocairo", env_info["hasPdftocairo"])):
        if not available:
            continue
        code, log = _run(_svg_command(tool, env_info["paths"], pdf_path, svg_path, font_mode), cwd, SVG_TIMEOUT_S, env)
        combined += "\n--- %s ---\n%s" % (tool, log)
        if code == 0 and os.path.exists(svg_path) and os.path.getsize(svg_path) > 0:
            return tool, combined
        try:
            os.remove(svg_path)
        except OSError:
            pass
    return None, combined


def _fail(errors, log="", started=None):
    return {
        "success": False,
        "svg": None,
        "pdf": None,
        "tool": None,
        "log": log,
        "errors": errors,
        "duration": int((time.time() - started) * 1000) if started else 0,
    }


def compile_svg(source, engine="pdflatex", preamble="", border="2pt", font_mode="path", bin_dir=None,
                ink=None, font="cm", font_name=""):
    """Compiles a snippet or full document.

    Returns a dict shaped like ppt's CompileSvgResult, plus ``pdf`` (bytes)
    so the caller can fall back to inserting the PDF (or export it), and
    ``tool`` naming the converter that produced the SVG. ``engine`` in the
    result is the engine actually used: a system font needs fontspec, so
    pdflatex is swapped for xelatex.
    """
    started = time.time()
    if engine not in ENGINES:
        return _fail(["Invalid engine: %s" % engine])
    if font not in look.FONT_IDS:
        font = "cm"
    if engine == "pdflatex" and look.needs_unicode_engine(font, font_name):
        engine = "xelatex"
    if not source or not source.strip():
        return _fail(["No LaTeX source provided"])
    if len(source.encode("utf-8")) > latex.MAX_SOURCE_BYTES:
        return _fail(["Source exceeds 200KB limit"])
    if latex.contains_dangerous_commands(source) or latex.contains_dangerous_commands(preamble):
        return _fail(["Forbidden LaTeX command detected: shell-escape commands are not allowed"])

    env_info = detect_environment(bin_dir)
    if engine not in env_info["engines"]:
        return _fail([
            "%s was not found. Installed engines detected: %s. Install TeX Live or MiKTeX, "
            "or set the TeX bin folder in TeXeR Settings."
            % (engine, ", ".join(env_info["engines"]) or "none")
        ])

    with _slots:
        work_dir = os.path.join(tempfile.gettempdir(), "texer-imp-jobs", uuid.uuid4().hex)
        os.makedirs(work_dir)
        try:
            env = _child_env(bin_dir)
            with open(os.path.join(work_dir, "main.tex"), "w", encoding="utf-8") as f:
                f.write(latex.build_standalone_latex(source, preamble=preamble, border=border,
                                                     ink=ink, font=font, font_name=font_name))

            args = [
                env_info["paths"][engine],
                "-interaction=nonstopmode",
                "-halt-on-error",
                "-file-line-error",
                "-no-shell-escape",
            ]
            if engine in ("xelatex", "lualatex"):
                args.append("-shell-restricted")
            args.append("main.tex")

            last_log = ""
            for _ in range(2):
                code, last_log = _run(args, work_dir, JOB_TIMEOUT_S, env)
                if code != 0 or "rerun" not in last_log.lower():
                    break

            pdf_path = os.path.join(work_dir, "main.pdf")
            if not os.path.exists(pdf_path):
                errors = latex.extract_errors(last_log)
                if not errors and last_log.strip():
                    errors = ["Compilation failed. Last log lines:\n" + "\n".join(last_log.strip().split("\n")[-15:])]
                return _fail(errors or ["Compilation failed."], last_log, started)

            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()

            svg_text = None
            tool = None
            if env_info["svgTool"]:
                svg_path = os.path.join(work_dir, "main.svg")
                tool, conv_log = convert_pdf_to_svg(pdf_path, svg_path, env_info, font_mode, work_dir, env)
                last_log += conv_log
                if tool:
                    with open(svg_path, "r", encoding="utf-8") as f:
                        svg_text = f.read()

            return {
                "success": True,
                "svg": svg_text,
                "pdf": pdf_bytes,
                "tool": tool,
                "engine": engine,
                "log": last_log,
                # Not fatal: the caller can still insert the PDF.
                "errors": [] if svg_text else ["PDF compiled but SVG conversion failed; inserting the PDF instead."],
                "duration": int((time.time() - started) * 1000),
            }
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)


def clean_stale_jobs(max_age_s=3600):
    root = os.path.join(tempfile.gettempdir(), "texer-imp-jobs")
    if not os.path.isdir(root):
        return
    now = time.time()
    for name in os.listdir(root):
        p = os.path.join(root, name)
        try:
            if now - os.path.getmtime(p) > max_age_s:
                shutil.rmtree(p, ignore_errors=True)
        except OSError:
            pass

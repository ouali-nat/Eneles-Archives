"""Chooses where a compile runs: in-process (direct) or via the helper.

Direct is the normal case. Sandboxed LibreOffice builds (snap, flatpak)
can't see the host's TeX at all, so they fall back to the loopback helper
in helper/texer_imp_helper.py, which runs the very same compile module
outside the sandbox. See PLAN.md section 2.
"""

import base64
import json
import os
import urllib.error
import urllib.request

from . import compile as tex
from . import look

CLIENT_HEADER = "X-TeXeR-Client"
CLIENT_VALUE = "texer-imp"
HELPER_HINT = "python3 TeXeR-IMP-helper.pyz"


class BackendError(Exception):
    pass


def is_sandboxed():
    return bool(os.environ.get("SNAP") or os.environ.get("FLATPAK_ID") or os.path.exists("/.flatpak-info"))


def _no_proxy_opener():
    # A desktop proxy setting must never route a loopback call elsewhere.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _helper_request(url, path, payload=None, timeout=60):
    data = None
    headers = {CLIENT_HEADER: CLIENT_VALUE}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url.rstrip("/") + path, data=data, headers=headers)
    try:
        with _no_proxy_opener().open(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except ValueError:
            raise BackendError("TeXeR helper returned HTTP %s" % e.code)
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise BackendError("Could not reach the TeXeR helper at %s (%s)" % (url, getattr(e, "reason", e)))


def helper_health(url, timeout=2):
    try:
        return _helper_request(url, "/health", timeout=timeout)
    except BackendError:
        return None


def status(settings):
    """Which backend a render will use right now, and whether it can work.

    Returns {"backend": "direct"|"helper"|None, "env": health dict or None, "message": str}.
    """
    choice = settings.get("backend", "auto")
    if choice in ("auto", "direct"):
        env = tex.detect_environment(settings.get("texBinDir") or None)
        if env["engines"]:
            return {"backend": "direct", "env": env, "message": _describe(env, "local TeX")}
        if choice == "direct":
            return {"backend": None, "env": env, "message": "No TeX engine found. Install TeX Live/MiKTeX or set the TeX bin folder."}
    health = helper_health(settings.get("helperUrl") or "http://127.0.0.1:47823")
    if health and health.get("engines"):
        return {"backend": "helper", "env": health, "message": _describe(health, "TeXeR helper")}
    if is_sandboxed():
        msg = ("This LibreOffice is sandboxed (snap/flatpak) and can't see your TeX. "
               "Start the helper outside it: %s" % HELPER_HINT)
    else:
        msg = "No TeX engine found. Install TeX Live/MiKTeX, set the TeX bin folder, or run the helper."
    return {"backend": None, "env": health, "message": msg}


def _describe(env, where):
    return "%s: %s · %s" % (where, ", ".join(env.get("engines") or []) or "no engines", env.get("svgTool") or "no SVG tool")


def compile_svg(settings, source, preamble, st=None):
    """Compiles via whichever backend is available, with the current Look.
    Same result shape as tex.compile_svg. Pass ``st`` (from status()) to
    skip re-probing when compiling many objects in a row."""
    st = st or status(settings)
    if st["backend"] is None:
        raise BackendError(st["message"])
    ink, _paper = look.resolve(settings)
    args = {
        "source": source,
        "engine": settings.get("engine", "pdflatex"),
        "preamble": preamble,
        "border": settings.get("border") or "2pt",
        "fontMode": settings.get("fontMode", "path"),
        "ink": ink,
        "font": settings.get("font", "cm"),
        "fontName": settings.get("fontName", ""),
    }
    if st["backend"] == "direct":
        result = tex.compile_svg(
            args["source"], args["engine"], args["preamble"], args["border"], args["fontMode"],
            bin_dir=settings.get("texBinDir") or None,
            ink=args["ink"], font=args["font"], font_name=args["fontName"],
        )
    else:
        result = _helper_request(settings.get("helperUrl") or "http://127.0.0.1:47823", "/compile", args, timeout=90)
        pdf_b64 = result.get("pdf")
        result["pdf"] = base64.b64decode(pdf_b64) if pdf_b64 else None
    result["backend"] = st["backend"]
    return result

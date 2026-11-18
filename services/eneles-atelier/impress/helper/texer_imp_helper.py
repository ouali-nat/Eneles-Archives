#!/usr/bin/env python3
"""TeXeR IMP helper: a loopback compile server for sandboxed LibreOffice.

Only needed when LibreOffice is a snap or flatpak, which can't see the
host's TeX installation. Run this *outside* the sandbox:

    python3 TeXeR-IMP-helper.pyz            # serve on 127.0.0.1:47823
    python3 TeXeR-IMP-helper.pyz --check    # print what TeX it can see, exit

It runs the exact compile module the extension uses (texer_imp.compile), so
there's no second implementation to drift. Stdlib only.

No token, deliberately (a snap can't read ~/.texer-imp to share one).
Instead every request must:
  - arrive on 127.0.0.1 with Host 127.0.0.1:<port> or localhost:<port>
    (defeats DNS rebinding),
  - carry no Origin header (browsers always send one cross-origin; the
    extension never does),
  - for /compile, be Content-Type: application/json with X-TeXeR-Client set,
    which a browser could only send after a CORS preflight we never answer.
"""

import argparse
import base64
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
# Running from the source tree: the package lives in python/pythonpath.
# Running as the .pyz: it sits next to __main__.py, already importable.
for candidate in (os.path.join(HERE, "..", "python", "pythonpath"), HERE):
    if os.path.isdir(os.path.join(candidate, "texer_imp")):
        sys.path.insert(0, os.path.abspath(candidate))
        break

from texer_imp import __version__  # noqa: E402
from texer_imp import compile as tex  # noqa: E402

DEFAULT_PORT = int(os.environ.get("TEXER_IMP_PORT", "47823"))
MAX_BODY = 1024 * 1024
CLIENT_HEADER = "X-TeXeR-Client"


class Handler(BaseHTTPRequestHandler):
    server_version = "TeXeR-IMP-helper/" + __version__
    bin_dir = None

    def log_message(self, fmt, *args):
        sys.stderr.write("[texer-imp-helper] %s\n" % (fmt % args))

    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _guard(self):
        port = self.server.server_address[1]
        host = (self.headers.get("Host") or "").lower()
        if host not in ("127.0.0.1:%d" % port, "localhost:%d" % port):
            self._send(403, {"success": False, "errors": ["Bad Host header."]})
            return False
        if self.headers.get("Origin") is not None:
            self._send(403, {"success": False, "errors": ["Browser requests are not accepted."]})
            return False
        return True

    def do_OPTIONS(self):
        # Never answer a CORS preflight: that's what keeps web pages out.
        self._send(403, {"success": False, "errors": ["No CORS."]})

    def do_GET(self):
        if not self._guard():
            return
        if self.path == "/health":
            env = tex.detect_environment(self.bin_dir)
            env.pop("paths", None)
            env["version"] = __version__
            return self._send(200, env)
        self._send(404, {"success": False, "errors": ["Not found."]})

    def do_POST(self):
        if not self._guard():
            return
        if self.path != "/compile":
            return self._send(404, {"success": False, "errors": ["Not found."]})
        if not (self.headers.get("Content-Type") or "").startswith("application/json") or not self.headers.get(CLIENT_HEADER):
            return self._send(400, {"success": False, "errors": ["Missing client headers."]})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_BODY:
            return self._send(413, {"success": False, "errors": ["Body missing or too large."]})
        try:
            req = json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError:
            return self._send(400, {"success": False, "errors": ["Body is not JSON."]})
        if not isinstance(req, dict):
            return self._send(400, {"success": False, "errors": ["Body must be an object."]})

        result = tex.compile_svg(
            str(req.get("source") or ""),
            engine=str(req.get("engine") or "pdflatex"),
            preamble=str(req.get("preamble") or ""),
            border=str(req.get("border") or "2pt"),
            font_mode=str(req.get("fontMode") or "path"),
            bin_dir=self.bin_dir,
            ink=str(req.get("ink") or "") or None,
            font=str(req.get("font") or "cm"),
            font_name=str(req.get("fontName") or ""),
        )
        pdf = result.get("pdf")
        result["pdf"] = base64.b64encode(pdf).decode("ascii") if pdf else None
        self._send(200, result)


def main(argv=None):
    ap = argparse.ArgumentParser(description="TeXeR IMP loopback compile helper")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--tex-bin", default=os.environ.get("TEXER_IMP_TEX_BIN") or None,
                    help="folder containing pdflatex, if it isn't on PATH")
    ap.add_argument("--check", action="store_true", help="print the detected TeX environment and exit")
    args = ap.parse_args(argv)

    env = tex.detect_environment(args.tex_bin)
    print("[texer-imp-helper] TeXeR IMP helper %s" % __version__)
    print("[texer-imp-helper] TeX engines: %s" % (", ".join(env["engines"]) or "NONE (install TeX Live or MiKTeX)"))
    print("[texer-imp-helper] SVG tool:    %s" % (env["svgTool"] or "NONE (dvisvgm ships with TeX Live/MiKTeX)"))
    if args.check:
        return 0 if env["engines"] else 1

    tex.clean_stale_jobs()
    tex.set_max_concurrent(2)
    Handler.bin_dir = args.tex_bin
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as e:
        print("[texer-imp-helper] Could not listen on 127.0.0.1:%d (%s). Is another helper already running?"
              % (args.port, e), file=sys.stderr)
        return 1
    server.daemon_threads = True
    print("[texer-imp-helper] Listening on http://127.0.0.1:%d  (Ctrl+C to stop)" % args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        threading.Thread(target=server.shutdown, daemon=True).start()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

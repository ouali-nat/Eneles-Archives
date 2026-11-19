"""Helper server: request guards and a compile round-trip through backend.py."""

import http.client
import json
import os
import sys
import threading
import unittest
from http.server import ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "python", "pythonpath"))
sys.path.insert(0, os.path.join(ROOT, "helper"))

import texer_imp_helper as helper  # noqa: E402
from texer_imp import backend, latex  # noqa: E402
from texer_imp import compile as tex  # noqa: E402


class HelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), helper.Handler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=60)
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        data = json.loads(resp.read().decode("utf-8"))
        conn.close()
        return resp.status, data

    def test_health(self):
        status, data = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertIn("engines", data)
        self.assertNotIn("paths", data)

    def test_rejects_browser_origin(self):
        status, _ = self.request("GET", "/health", headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 403)

    def test_rejects_rebound_host(self):
        status, _ = self.request("GET", "/health", headers={"Host": "evil.example:%d" % self.port})
        self.assertEqual(status, 403)

    def test_rejects_simple_cross_site_post(self):
        # What an HTML form could send without a preflight.
        status, _ = self.request("POST", "/compile", body="source=x", headers={"Content-Type": "text/plain"})
        self.assertEqual(status, 400)

    def test_never_answers_preflight(self):
        status, _ = self.request("OPTIONS", "/compile")
        self.assertEqual(status, 403)

    @unittest.skipUnless(tex.detect_environment()["engines"], "no TeX engine on PATH")
    def test_backend_roundtrip_via_helper(self):
        settings = {"backend": "helper", "helperUrl": "http://127.0.0.1:%d" % self.port, "engine": "pdflatex"}
        self.assertEqual(backend.status(settings)["backend"], "helper")
        r = backend.compile_svg(settings, latex.wrap_math("a^2+b^2=c^2"), "")
        self.assertTrue(r["success"], r["errors"])
        self.assertEqual(r["backend"], "helper")
        self.assertIn("<svg", r["svg"])
        self.assertTrue(r["pdf"].startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()

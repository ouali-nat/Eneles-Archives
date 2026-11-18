#!/usr/bin/env python3
"""Builds the distributables into impress/release/:

  TeXeR-IMP.oxt          the LibreOffice extension (double-click to install)
  TeXeR-IMP-helper.pyz   the loopback helper, only needed for snap/flatpak
  install-helper.sh      installs the helper as a systemd --user service
  texer-imp-helper.service

    python3 impress/scripts/build.py
"""

import os
import re
import shutil
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RELEASE = os.path.join(ROOT, "release")
PKG = os.path.join(ROOT, "python", "pythonpath", "texer_imp")

OXT_ENTRIES = [
    "description.xml",
    "description",
    "META-INF",
    "registry",
    "python",
    "assets/icons",
    "LICENSE",
]
# The helper runs outside LibreOffice, so it gets only the UNO-free modules.
HELPER_MODULES = ["__init__.py", "look.py", "latex.py", "compile.py"]


def fail(msg):
    print("[build] " + msg, file=sys.stderr)
    sys.exit(1)


def read_version():
    with open(os.path.join(PKG, "__init__.py"), encoding="utf-8") as f:
        pkg_version = re.search(r'__version__\s*=\s*"([^"]+)"', f.read()).group(1)
    with open(os.path.join(ROOT, "description.xml"), encoding="utf-8") as f:
        desc_version = re.search(r'<version value="([^"]+)"', f.read()).group(1)
    if pkg_version != desc_version:
        fail("Version mismatch: texer_imp/__init__.py says %s, description.xml says %s." % (pkg_version, desc_version))
    return pkg_version


def walk(rel):
    full = os.path.join(ROOT, rel)
    if os.path.isfile(full):
        yield rel
        return
    for dirpath, dirnames, filenames in os.walk(full):
        dirnames[:] = sorted(d for d in dirnames if d != "__pycache__")
        for name in sorted(filenames):
            if name.endswith((".pyc", ".pyo")) or name.startswith("."):
                continue
            yield os.path.relpath(os.path.join(dirpath, name), ROOT).replace(os.sep, "/")


def build_oxt(path):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for entry in OXT_ENTRIES:
            if not os.path.exists(os.path.join(ROOT, entry)):
                fail("Missing %s" % entry)
            for rel in walk(entry):
                z.write(os.path.join(ROOT, rel), rel)


def build_pyz(path):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(ROOT, "helper", "texer_imp_helper.py"), "__main__.py")
        for name in HELPER_MODULES:
            z.write(os.path.join(PKG, name), "texer_imp/" + name)
    # A zipapp is just a zip with a shebang line in front.
    with open(path, "rb") as f:
        data = f.read()
    with open(path, "wb") as f:
        f.write(b"#!/usr/bin/env python3\n" + data)
    os.chmod(path, 0o755)


def main():
    version = read_version()
    os.makedirs(RELEASE, exist_ok=True)
    oxt = os.path.join(RELEASE, "TeXeR-IMP.oxt")
    pyz = os.path.join(RELEASE, "TeXeR-IMP-helper.pyz")
    build_oxt(oxt)
    build_pyz(pyz)
    for name in ("install-helper.sh", "texer-imp-helper.service"):
        shutil.copy(os.path.join(ROOT, "helper", name), os.path.join(RELEASE, name))
    print("[build] TeXeR IMP %s" % version)
    for p in (oxt, pyz):
        print("[build]   %s (%d KB)" % (os.path.relpath(p, ROOT), os.path.getsize(p) // 1024))


if __name__ == "__main__":
    main()

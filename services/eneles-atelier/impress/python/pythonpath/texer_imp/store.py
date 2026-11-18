"""Settings, drafts and history as JSON files.

powerpoint/ keeps these in the task pane's localStorage. Here they live in a
folder the caller chooses: the extension passes the LibreOffice user
profile ($(user)/texer-imp), which is writable even inside the snap.
"""

import json
import os
import random
import string
import time

DEFAULT_SETTINGS = {
    "engine": "pdflatex",
    "fontMode": "path",
    "border": "2pt",
    "extraPreamble": "",
    "workspace": "math",
    "displayMath": True,
    # The Look (see look.py): one ink/paper/font for every workspace.
    "slidePreset": "light",
    "ink": "#171717",
    "paper": "#FFFFFF",
    "font": "cm",
    "fontName": "",
    "boxAutoNumber": True,
    # "natural": TeX's own size x sizePercent. "width": fixed insertWidthIn.
    "sizeMode": "natural",
    "sizePercent": 250,
    "insertWidthIn": 3.0,
    "texBinDir": "",
    "helperUrl": "http://127.0.0.1:47823",
    # "auto": direct if TeX is reachable, else the helper.
    "backend": "auto",
}

ENUMS = {
    "engine": ("pdflatex", "xelatex", "lualatex"),
    "fontMode": ("path", "embed"),
    "workspace": ("math", "latex", "boxes", "tikz"),
    "sizeMode": ("natural", "width"),
    "backend": ("auto", "direct", "helper"),
    "slidePreset": ("light", "dark", "custom"),
    "font": ("cm", "lm", "palatino", "times", "libertine", "sans", "system"),
}

# Inks the 0.1 Math-only colour picker started from. Anything else was a
# deliberate choice and becomes a Custom look on upgrade.
_DEFAULT_MATH_INKS = ("#171717", "#1A1A1A", "#F5F5F5")

MAX_HISTORY = 30
MAX_SNIPPETS = 100


class Store(object):
    def __init__(self, folder):
        self.folder = folder
        try:
            os.makedirs(folder, exist_ok=True)
        except OSError:
            pass

    def _path(self, name):
        return os.path.join(self.folder, name)

    def _read(self, name, fallback):
        try:
            with open(self._path(name), "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return fallback

    def _write(self, name, data):
        tmp = self._path(name + ".tmp")
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=1)
            os.replace(tmp, self._path(name))
        except OSError:
            pass  # best-effort, same as localStorage in powerpoint/

    # ── settings ──
    def load_settings(self):
        raw = self._read("settings.json", {})
        out = dict(DEFAULT_SETTINGS)
        if isinstance(raw, dict):
            for key, default in DEFAULT_SETTINGS.items():
                if key not in raw:
                    continue
                value = raw[key]
                # Spread-merging would let a stale enum value survive (see
                # powerpoint/src/core/settings.ts), so validate types and enums.
                if key in ENUMS and value not in ENUMS[key]:
                    continue
                if isinstance(default, bool):
                    if isinstance(value, bool):
                        out[key] = value
                elif isinstance(default, (int, float)):
                    if isinstance(value, (int, float)) and not isinstance(value, bool):
                        out[key] = value
                elif isinstance(value, str):
                    out[key] = value
            old_ink = raw.get("mathColor")
            if "slidePreset" not in raw and isinstance(old_ink, str) and old_ink.upper() not in _DEFAULT_MATH_INKS:
                out.update(slidePreset="custom", ink=old_ink, paper="#FFFFFF")
        return out

    def save_settings(self, settings):
        self._write("settings.json", settings)

    # ── per-workspace drafts ──
    def load_drafts(self):
        raw = self._read("drafts.json", {})
        return {k: raw.get(k, "") if isinstance(raw, dict) and isinstance(raw.get(k), str) else ""
                for k in ENUMS["workspace"]}

    def save_drafts(self, drafts):
        self._write("drafts.json", drafts)

    # ── history ──
    def load_history(self):
        raw = self._read("history.json", [])
        return [e for e in raw if isinstance(e, dict) and isinstance(e.get("source"), str)] if isinstance(raw, list) else []

    def record_history(self, source, workspace):
        """De-dupes on source+workspace (bumps to the top). Newest is index 0."""
        entries = self.load_history()
        existing = next((e for e in entries if e["source"] == source and e.get("workspace") == workspace), None)
        if existing:
            entries.remove(existing)
            existing["createdAt"] = int(time.time() * 1000)
            entry = existing
        else:
            entry = {
                "id": _new_id(),
                "source": source,
                "workspace": workspace,
                "createdAt": int(time.time() * 1000),
            }
        entries.insert(0, entry)
        entries = entries[:MAX_HISTORY]
        self._write("history.json", entries)
        return entries

    def remove_history(self, entry_id):
        entries = [e for e in self.load_history() if e.get("id") != entry_id]
        self._write("history.json", entries)
        return entries

    # ── library: saved snippets and box presets ──
    def _load_library(self):
        raw = self._read("library.json", {})
        return raw if isinstance(raw, dict) else {}

    def load_snippets(self):
        items = self._load_library().get("snippets", [])
        return [s for s in items if isinstance(s, dict) and isinstance(s.get("source"), str)
                and isinstance(s.get("label"), str)] if isinstance(items, list) else []

    def save_snippet(self, label, workspace, source):
        """Adds a snippet, or overwrites the one with the same label."""
        lib = self._load_library()
        items = [s for s in self.load_snippets() if s["label"] != label]
        items.insert(0, {"id": _new_id(), "label": label, "workspace": workspace, "source": source})
        lib["snippets"] = items[:MAX_SNIPPETS]
        self._write("library.json", lib)
        return lib["snippets"]

    def remove_snippet(self, snippet_id):
        lib = self._load_library()
        lib["snippets"] = [s for s in self.load_snippets() if s.get("id") != snippet_id]
        self._write("library.json", lib)
        return lib["snippets"]

    def load_box_presets(self):
        items = self._load_library().get("boxPresets", [])
        return [p for p in items if isinstance(p, dict) and isinstance(p.get("name"), str)] if isinstance(items, list) else []

    def save_box_preset(self, preset):
        """preset: {name, label, style, accent, fill}. Same name overwrites."""
        lib = self._load_library()
        items = [p for p in self.load_box_presets() if p["name"] != preset["name"]]
        items.append(dict(preset))
        lib["boxPresets"] = items
        self._write("library.json", lib)
        return items

    def remove_box_preset(self, name):
        lib = self._load_library()
        lib["boxPresets"] = [p for p in self.load_box_presets() if p["name"] != name]
        self._write("library.json", lib)
        return lib["boxPresets"]


def _new_id():
    return "%d-%s" % (time.time() * 1000, "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6)))

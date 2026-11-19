# TeXeR IMP: plan

LaTeX for LibreOffice Impress (and Draw), the sibling of `../ppt`. The same
idea: render with the TeX already installed on the machine, then drop the
result on the slide. No cloud and no account.

This file covers why it's built the way it is, what's done, and what's next.
`README.md` covers using it.

---

## 1. What carries over from `powerpoint/` and what doesn't

| `powerpoint/` piece | In `impress/` |
|---|---|
| `app/server.js` compile logic: `buildStandaloneLatex`, dangerous-command filter, 2-pass engine run, dvisvgm → pdftocairo fallback, `extractErrors` | **Ported 1:1 to Python** (`texer_imp/latex.py`, `texer_imp/compile.py`). Same regexes, same behaviour, same Ghostscript workaround. |
| `src/core/snippets.ts`, TikZ chips/templates, box builder (`buildBoxSource`, `tintFromAccent`) | **Ported** (`texer_imp/snippets.py`, `texer_imp/boxes.py`). |
| `src/core/history.ts`, `settings.ts` (localStorage) | **Ported** to JSON files in the LibreOffice user profile (`$(user)/texer-imp/`). |
| `src/core/office-insert.ts` (Office.js `setSelectedDataAsync`) | **Replaced** by UNO: `GraphicObjectShape` on the current draw page (`texer_imp/insert.py`). |
| `src/core/svg-utils.ts` (`prepareSvgForOffice`: flatten `<use>`, bake currentColor, PNG rasterise) | **Mostly unnecessary.** LibreOffice imports dvisvgm/pdftocairo SVG natively and keeps it as a vector. Only size parsing survives (`texer_imp/svg.py`). |
| Task pane HTML/CSS (`taskpane.html/ts/css`) | **Replaced** by a native non-modal UNO dialog (`texer_imp/dialog.py`). LibreOffice has no embedded web view for extensions. |
| MathJax "Quick math" | **Dropped for v1.** No browser engine. The Math workspace goes through real TeX instead (pdflatex runs in under a second for an equation). See §6. |
| HTTPS server, bundled CA, token, Office manifest, self-installing `.exe`, registry work | **Gone.** An `.oxt` installs by double-click and runs inside LibreOffice. |
| `local-server/` (loopback compile API) | **Kept as an optional helper** (`helper/`), only for sandboxed LibreOffice (snap/flatpak). See §2. |

## 2. The one hard constraint: sandboxed LibreOffice

Snap and Flatpak builds of LibreOffice cannot see the host's TeX Live.
This was confirmed on the dev machine: inside the `libreoffice` snap,
`/usr/local/texlive/...` does not exist. The snap does have the `network`
plug, so it can reach `127.0.0.1`.

So the compile backend has two modes, chosen automatically:

1. **Direct** (default): the extension runs `pdflatex`/`dvisvgm`/`pdftocairo`
   itself as subprocesses. This works for LibreOffice from the distro `.deb`/`.rpm`,
   AppImage, and Windows and macOS installers.
2. **Helper**: if no TeX engine is reachable, the extension calls
   `http://127.0.0.1:47823/compile` instead. The helper (`helper/texer_imp_helper.py`)
   is a stdlib-only Python HTTP server running *outside* the sandbox. It
   imports the **same** `texer_imp.compile` module, so the two modes can't drift
   apart. It ships as one file, `TeXeR-IMP-helper.pyz`, with an optional
   systemd user unit.

Helper security, without a token. In a snap, `~/.texer-imp` is invisible, so
a shared token file can't be read by both sides. Instead:
- It binds `127.0.0.1` only.
- It rejects any request carrying an `Origin` header (browsers always send
  one cross-origin, and the extension never does).
- It rejects any `Host` other than `127.0.0.1:<port>`/`localhost:<port>`
  (DNS rebinding).
- It requires `Content-Type: application/json` plus a custom
  `X-TeXeR-Client` header, so a browser would have to preflight, and the
  preflight is never answered.
- The same dangerous-command filter and `-no-shell-escape` apply.

## 3. Architecture

```
impress/
  description.xml              extension identity, version, min LibreOffice
  META-INF/manifest.xml        registers the Python component + .xcu files
  registry/Addons.xcu          Insert menu entry + toolbar button
  python/
    texer_imp_main.py          UNO component (XJobExecutor), the entry point
    pythonpath/texer_imp/      pure package, auto-added to sys.path by LibreOffice
      latex.py                 standalone wrapping, hoisting, filter, errors   (no UNO)
      compile.py               TeX -> PDF -> SVG pipeline, env detection      (no UNO)
      backend.py               picks direct vs helper                          (no UNO)
      svg.py                   SVG size parsing                                 (no UNO)
      snippets.py boxes.py     examples, TikZ chips/starters, box builder      (no UNO)
      store.py                 settings.json + history.json                    (no UNO)
      insert.py                UNO: graphic loading, shape insert/replace, metadata
      dialog.py                UNO: the non-modal TeXeR window
      settings_dialog.py       UNO: modal Settings
  helper/texer_imp_helper.py   loopback compile server for sandboxed LibreOffice
  helper/texer-imp-helper.service   systemd --user unit
  scripts/build.py             zips -> release/TeXeR-IMP.oxt + release/TeXeR-IMP-helper.pyz
  tests/                       pure-Python tests + a headless-soffice smoke test
```

The rule is that everything marked "no UNO" is importable by plain `python3`,
which is what makes the helper and the tests possible.

### Insert path (Impress/Draw)
1. Compile → SVG string (+ the PDF kept around).
2. `GraphicProvider.queryGraphic` from the SVG bytes → `XGraphic` (vector).
3. `doc.createInstance("com.sun.star.drawing.GraphicObjectShape")`, set `Graphic`,
   size from the SVG's own `pt` width/height × the *Size %* setting, and
   centre it on the current slide.
4. Tag the shape so it can be edited later:
   - `Description` (alt text) = the LaTeX source, which doubles as decent accessibility text
   - `Title` = `TeXeR`
   - `Name` = `TeXeR <workspace>`
   - `UserDefinedAttributes` hold the JSON metadata (workspace, engine, size, colour),
     which survives save/reload in `.odp`

### Re-edit, which `powerpoint/` can't do
Select a TeXeR shape, then open TeXeR. The source and settings load from the
shape. **Insert** turns into **Replace selected**, which swaps the graphic in
place, keeps the position, and keeps the user's manual resize ratio.
A fresh insert is deliberately *not* left selected. Otherwise the next
equation typed would replace it instead of being added. Fresh inserts are
centred and cascade 5 mm when something already sits at the centre.

### Threading
Compiles run on a worker thread so LibreOffice doesn't freeze. Results come
back to the UI thread through `com.sun.star.awt.AsyncCallback`, and nothing
touches dialog controls from the worker.

## 4. Milestones

Verified on the dev machine: Ubuntu, LibreOffice 26.2 (snap), TeX Live 2026,
dvisvgm 3.6 + Ghostscript 10.06.

- [x] **M0: Scaffold.** Folder, PLAN, README, build script, identity files.
- [x] **M1: Compile core.** `latex.py`/`compile.py` ported from `server.js`.
      `tests/test_core.py` runs against real TeX Live: every example (math, TikZ, circuitikz,
      chemfig, pgfplots), every TikZ starter, a box (checking its exact width), the pdftocairo
      fallback, a forbidden command, a broken source, and a bad engine.
- [x] **M2: Insert.** `tests/uno_smoke.py` runs in headless Impress (inside the snap,
      compiling through the helper). It inserts math, TikZ and a box, replaces the equation
      after a 2x manual resize (keeping position and scale), loads a PDF graphic, saves `.odp`,
      reloads it, and reads the metadata back.
- [x] **M3: Dialog.** Non-modal window with workspaces (Math/LaTeX/Boxes/TikZ), per-workspace
      drafts, examples, TikZ starters + library picker, box builder (hand edits protected),
      colour pickers, Size/Engine, Render, preview, Insert/Replace selected/Edit selected,
      recents, modal Settings, status line, Ctrl+Enter / Ctrl+Shift+Enter.
      `tests/uno_dialog_smoke.py` installs the built `.oxt` with `unopkg`, confirms the
      Launcher service opens a window, then drives the window code through that whole flow.
- [x] **M4: Helper.** Loopback server, auto-fallback, `.pyz` packaging, systemd unit.
      `tests/test_helper.py` covers the Origin/Host/preflight/content-type guards and a
      round-trip through `backend.py`.
- [x] **M4.5: Round 1+2 features, shared with `powerpoint/`.** One global Look (Light/Dark/Custom
      slide, ink + paper, font: CM default, Latin Modern, Palatino, Times, Libertine, Sans,
      system font via XeLaTeX) injected as `\color{texerInk}` for every workspace; free-text
      box labels, five box styles, saved box presets, per-label auto numbering; saved
      snippets; Export ▾ (SVG/PDF/PNG); Re-render all; more TikZ starters and 36
      library/package chips (all compile in `test_core.py`). `powerpoint/` got the same features in
      TypeScript (`look.ts`, `boxes.ts`, `library.ts`, `ppt-shapes.ts`), with Edit selected
      and Re-render all gated on PowerPointApi 1.5. 49 unit tests plus both headless Impress
      runs pass; the `powerpoint/` pane was checked in a browser against `local-server`.
- [ ] **M5: Real-GUI pass** (needs a human; the tests above run headless, so nothing has
      been *looked at* yet):
  - [ ] Dialog layout and spacing at normal and HiDPI scaling, in light and dark themes
  - [ ] Menu entry lands under Insert next to Image; the toolbar icon shows
  - [ ] Ctrl+Enter in the source box renders without also inserting a newline
  - [ ] The colour picker opens (`com.sun.star.ui.dialogs.ColorPicker`)
  - [ ] A non-snap LibreOffice (`.deb` or AppImage) uses *local* TeX directly
  - [ ] Windows + MiKTeX: no console window flashes; finds MiKTeX on PATH
  - [ ] macOS + MacTeX: finds `/Library/TeX/texbin` without PATH help
- [ ] **M6: Polish.**
  - Writer support: insert as an anchored-as-character image at the view cursor
  - A sidebar deck (`Sidebar.xcu` + `XUIElementFactory`) as an alternative to the floating window
  - "Insert as shapes" (run Break on the inserted SVG so the equation becomes editable LibreOffice shapes)
  - A keyboard shortcut (Accelerators.xcu), once a free combination is confirmed in Impress and Draw
  - Localisation (`description.xml` + dialog strings)
- [ ] **M7: Release.** A GitHub Action that runs `scripts/build.py` plus the pure-Python tests,
      attaches `.oxt` + `.pyz`, and publishes to extensions.libreoffice.org.

## 5. Decisions and the reasons behind them

- **Python, not Basic or Java.** Python ships inside every LibreOffice build,
  including the snap (3.12 there). It's the only option where the compile core is
  also runnable outside LibreOffice, which the helper needs.
- **Non-modal dialog before a sidebar.** It has far fewer moving parts and gives the
  same "keep it open while editing slides" workflow. The sidebar is in M6.
- **Natural size × percent, not a fixed width.** `powerpoint/` inserts at a fixed 3in width,
  which makes `x=1` and a long integral the same width. Here the size comes from
  the TeX box itself (10pt text) times *Size %* (default 250%, about 25pt on the slide),
  so equations stay visually consistent with each other. A fixed width is still
  available in Settings.
- **SVG, no PNG.** LibreOffice paints imported SVG as a vector reliably, so the whole
  PNG rasterisation path from `powerpoint/` (and its canvas size limits) goes away.
  If SVG conversion fails entirely, the PDF is inserted as the graphic instead.
  LibreOffice imports PDF pages as images too.
- **No token for the helper.** See §2. Origin, Host and custom-header checks give
  the same protection as `powerpoint/`'s CORS trick, without a shared secret file the
  snap can't read.

## 6. Known gaps and open questions

- **Quick math without TeX.** If wanted later, it could be bundled MathJax driven by
  `node` (no, it adds a dependency) or LibreOffice's own Math object (wrong syntax).
  For now TeX is required for everything.
- The **snap has to have the helper running.** The extension can't start it,
  because subprocesses inherit the sandbox. The dialog detects this case and
  shows the exact one-line command to run.
- **macOS:** GUI apps don't inherit the shell `PATH`, so `compile.py` also probes
  `/Library/TeX/texbin`, `/usr/local/texlive/*/bin/*`, and MiKTeX/TeX Live
  default folders on Windows. There's also a *TeX bin folder* override in Settings.
- **Metadata read flicker, seen only in the cross-process test harness.** While
  the dialog test drove the window over the UNO bridge from a second process,
  `UserDefinedAttributes` occasionally read as missing for a moment. It never
  reproduced in a single-threaded probe, and the shipped extension runs
  in-process on the UI thread. As a safeguard, `read_meta` falls back to the
  alt text (source) and shape name (workspace), so editing still works if the
  attribute is ever missing. Re-check during M5.
- **Fixed relative to `powerpoint/`:** `braceDelta` in `powerpoint/app/server.js` (and
  `local-server/server.js`) compares a character against the two-character
  string `"\\\\"`, so escaped braces are never skipped. A snippet like
  `\newcommand{\lb}{\{}` followed by `$\lb x$` swallows the body into the
  preamble and renders an empty page. `impress/`'s port skips escapes correctly
  (`test_escaped_braces_dont_unbalance_hoisting`). Fixed in `powerpoint/` too
  (the comparison is now `"\\"`, in both server files).

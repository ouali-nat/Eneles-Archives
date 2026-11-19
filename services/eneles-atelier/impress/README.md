# TeXeR IMP

LaTeX for LibreOffice Impress (and Draw). No cloud, no account. It renders
with the TeX you already have installed and puts the result on the slide as
a crisp vector graphic. Select it later to edit and replace it in place.

The LibreOffice sibling of [`../ppt`](../ppt) (TeXeR for PowerPoint). Same
compile pipeline, same examples, same theorem boxes. See [PLAN.md](PLAN.md)
for how it's built and why.

```
impress/
  python/texer_imp_main.py        UNO entry point (menu + toolbar call this)
  python/pythonpath/texer_imp/    the extension's code
    latex.py compile.py           TeX -> PDF -> SVG, ported from powerpoint/app/server.js
    backend.py                    local TeX, or the helper for snap/flatpak
    dialog.py settings_dialog.py  the TeXeR window
    insert.py                     put the render on the slide, tag it, replace it
    snippets.py boxes.py store.py examples, box builder, settings/history
  helper/                         loopback compile helper (snap/flatpak only)
  registry/Addons.xcu             Insert-menu entry + toolbar button
  description.xml META-INF/       extension identity and manifest
  scripts/build.py                builds release/TeXeR-IMP.oxt (+ helper)
  tests/                          unit tests + headless LibreOffice tests
```

## Get it

1. Build it (below) or grab `TeXeR-IMP.oxt` from a release.
2. Double-click `TeXeR-IMP.oxt`, or in LibreOffice go to *Tools > Extension
   Manager > Add*. Restart LibreOffice.
3. In Impress or Draw, use **Insert > TeXeR LaTeX...** or the **TeXeR**
   toolbar (*View > Toolbars > TeXeR* if it's hidden).

**You also need:** TeX Live or MiKTeX with `pdflatex`, and `dvisvgm` or
`pdftocairo`. Both ship with TeX Live and MiKTeX. TeXeR also looks in the
usual install folders when TeX isn't on the `PATH` LibreOffice sees, which is
common on macOS: `/Library/TeX/texbin`, `/usr/local/texlive/*/bin/*`,
`C:\texlive\*\bin\windows`, and MiKTeX's folders. Failing that, set
*Settings > TeX bin folder*.

### Snap / Flatpak LibreOffice

Sandboxed LibreOffice can't see your TeX installation at all. Run the small
helper outside the sandbox and TeXeR will use it automatically:

```bash
python3 release/TeXeR-IMP-helper.pyz
```

To have it start at every login (systemd):

```bash
sh release/install-helper.sh
```

It listens on `127.0.0.1:47823` only and runs the same compile code as the
extension. Remove it with `sh release/install-helper.sh --remove`. The status
in the top-right of the TeXeR window says which mode is active: *TeX ready
(local)* or *TeX ready (helper)*.

## Use it

- **Workspaces:** Math (an expression), LaTeX (any snippet, or a whole
  `\documentclass` document), Boxes (theorem/definition/lemma callouts),
  TikZ (with starters and a library picker).
- **Render** with Ctrl+Enter. **Insert** with Ctrl+Shift+Enter, which also
  renders first if needed.
- **Edit:** select a TeXeR object on the slide. The button turns into
  **Replace selected**, and **Edit selected** loads its source. Replacing
  keeps the object's position and any resizing you did by hand.
- **Size:** objects come out at TeX's own size times *Size %* (default 250%,
  so 10pt text becomes about 25pt on the slide). Equations therefore match
  each other however long they are. *Settings > Sizing > Fixed width*
  gives the PowerPoint behaviour instead.
- **Box width** is the width on the slide, as a percentage of the slide or
  in cm/in. The box's text still matches your equations.
- Bare snippets are wrapped in `\documentclass[preview,border=2pt]{standalone}`.
  `\usepackage`, `\usetikzlibrary`, `\newcommand` and similar lines at the
  top are moved into the preamble.
- The LaTeX source is stored on the object (in its alt text and in the `.odp`),
  so editing still works after you save, close and reopen.
- **Look** (Slide / Ink / Paper and the font picker) applies to every
  workspace. Pick Light slide, Dark slide or Custom. Computer Modern stays the
  default; Latin Modern, Palatino, Times, Libertine, Sans serif or any system
  font (XeLaTeX) are the alternatives. Explicit colours in your source are kept.
- **Re-render all** redraws every TeXeR object in the document with the current
  Look, keeping positions and sizes. Use it after switching to a dark slide.
- **Boxes** take any label (Conjecture, Claim, ...), five styles (bar, frame,
  rounded, title bar, plain), accent/fill colours, and automatic numbering per
  label counted from the boxes already in the document. **Save style...**
  keeps it as a preset.
- **Save snippet...** adds the current source to the Examples list.
- **Export ▾** saves the last render as SVG, PDF or PNG.

## Settings

| Field | Meaning |
|---|---|
| Extra preamble | Added to every render |
| Crop border | `standalone` border (default `2pt`) |
| SVG fonts | Outlines (default) or embedded WOFF |
| System font name | Used when the font is *System font* (compiles with XeLaTeX) |
| Box presets | Your saved box styles (delete) |
| Sizing | TeX size x Size %, or a fixed width |
| Compile with | Automatic, Local TeX only, or Helper only |
| TeX bin folder | Folder containing `pdflatex`, if it isn't found |
| Helper URL | Default `http://127.0.0.1:47823` |

Settings, drafts and recents are stored as JSON in your LibreOffice user
profile under `texer-imp/`.

## Build it

```bash
python3 scripts/build.py
```

This produces `release/TeXeR-IMP.oxt`, `release/TeXeR-IMP-helper.pyz` and the
helper install files. There are no dependencies beyond Python 3.

## Test it

```bash
python3 -m unittest discover -s tests -v
```

That runs the core and helper tests against your real TeX, and covers every
example, every TikZ starter, a box, the pdftocairo fallback, the
forbidden-command filter, error extraction, and the helper's request guards.

```bash
sh tests/run_uno_smoke.sh
```

That runs a headless Impress test. It inserts, replaces, saves `.odp`,
reloads, and checks the metadata. Output goes to `tests/out/`.

```bash
sh tests/run_uno_smoke.sh dialog
```

That runs the full window flow. It installs the built `.oxt` into a
throwaway profile, then types, renders, inserts, re-edits, replaces, and
switches workspaces. Run `scripts/build.py` first.

For a snap LibreOffice, the runner starts the helper and runs the tests
inside the snap, so it exercises the real sandboxed path.

## Security

- Every compile passes `-no-shell-escape` and rejects `\write18`,
  `\directlua`, `\latelua` and pipe `\input`, just like `powerpoint/`.
- The helper binds `127.0.0.1` only. It refuses requests that carry an
  `Origin` header (any browser page), a foreign `Host` header (DNS
  rebinding), or lack its JSON + `X-TeXeR-Client` headers (which would force
  a CORS preflight it never answers). There's no token because a snap can't
  read a shared token file.
- Nothing is uploaded anywhere.

Change the helper's port with `TEXER_IMP_PORT` (and *Settings > Helper URL*).

## License

[MIT](LICENSE)

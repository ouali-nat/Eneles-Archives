# Eneles

LaTeX for Microsoft PowerPoint. No cloud, no server, no account. Renders with the TeX you already have installed and drops it straight onto the slide.

```
powerpoint/
  app/              The whole packaged app: one process, serves the task
                    pane (HTTPS, bundled cert) AND the compile API, and
                    installs itself on first run. This is what gets built
                    into Eneles-PPT.exe.
  local-server/     Dev-only alternative to app/: same compile logic, run
                    separately (see "Developing" below)
  src/taskpane/     The menu you open from the ribbon
  src/core/         Render, history, Office.js insert
  manifest.xml      Sideload this
  ca-private/       CA private key used to sign the bundled cert. Never ship
  .github/workflows/ CI that builds Eneles-PPT.exe and publishes GitHub Releases
```

Two render paths:

| Mode | When | How |
|---|---|---|
| **Quick math** | Equations, matrices, aligned steps | MathJax in the task pane. Instant. No server. |
| **Full LaTeX** | TikZ, circuitikz, chemfig, pgfplots, forest, or a whole `\documentclass` | The app runs your TeX, crops with `dvisvgm` (falls back to `pdftocairo`, see below), returns SVG |

Insert defaults to a high-DPI PNG (`Office.CoercionType.Image`) because that path is reliable in every PowerPoint build. **Insert SVG** is opt-in. Some hosts distort SVG (Office.js #4967).

---

## Get it

Grab `Eneles-PPT.exe` from the [Releases](../../releases) page, or build it yourself (see below). Double-click it once. That single run:

1. Copies itself to `%LOCALAPPDATA%\Eneles PPT`
2. Registers itself to start silently at every Windows login (no console window, ever)
3. Registers that folder with PowerPoint as a trusted add-in source
4. Launches itself in the background and exits the foreground window

That's the entire install. No script to run, nothing to paste, no terminal. Open PowerPoint. If **Eneles** isn't already on the Home tab, check **Insert > My Add-ins > Shared Folder**. If it's still not there, add the catalog manually once: *File > Options > Trust Center > Trust Center Settings > Trusted Add-in Catalogs*, add `%LOCALAPPDATA%\Eneles PPT`, check "Show in Menu", restart PowerPoint.

**What you need on the machine running it:**
- Windows, PowerPoint desktop
- TeX Live or MiKTeX on `PATH` (`pdflatex` in a terminal should already work)
- `dvisvgm` or `pdftocairo` on `PATH` (ships with both distributions)

**To update:** download the newer `Eneles-PPT.exe` and double-click it again. It reinstalls over the old one and relaunches.

**To remove:** `Eneles-PPT.exe --uninstall` (stops the background process, removes the registry entries and the install folder).

## Build it yourself

```bash
cd ppt
npm install
cd app && npm install && cd ..
npm run release
```

Produces `powerpoint/release/Eneles-PPT.exe`. That single file is the entire distributable.

## Releases (CI)

`.github/workflows/release.yml` builds `Eneles-PPT.exe` and attaches it to a GitHub Release automatically:

- Push a tag like `v1.0.0` → builds and publishes a Release with the exe attached.
- Manual run (`workflow_dispatch`) → builds and uploads the exe as a workflow artifact, no Release created. Use this to sanity-check a branch before cutting a version.

## Developing

If you're changing the add-in's code, the packaged `app/` build is slower to iterate on (rebuild + repackage each time). Use the split dev setup instead:

**1. Local TeX helper**

```bash
cd powerpoint/local-server
# or double-click start.bat (Windows) / start.sh (macOS/Linux)
npm install
npm start
```

It binds **loopback only** (`127.0.0.1:47822`), prints a token, and writes it to `~/.texer-ppt/token`. Copy that token into the add-in Settings panel once.

**2. Task pane (HTTPS sideload host)**

```bash
cd ppt
npm install
npm run cert:install
npm start
```

PowerPoint should open with **Eneles** on the Home ribbon. If the task pane is blank, trust the local HTTPS cert (`npm run cert:verify`).

The webpack dev server also proxies `/local-api` → `http://127.0.0.1:47822`, so if the browser blocks mixed HTTP from the HTTPS pane, Full LaTeX still works.

## Use it

1. Type math (e.g. `\int_0^1 x^2\,dx`) or a `tikzpicture` / `circuitikz` / `chemfig` snippet, or pick one from the **Examples** dropdown.
2. **Render** (Ctrl+Enter). Quick math is instant; Full LaTeX needs the app running (installed `Eneles-PPT.exe`, or `local-server` in dev).
3. **Insert picture** (Ctrl+Shift+Enter) drops a crisp PNG on the current slide.
4. Optional: **Insert SVG**, or **Export ▾** (Save SVG / PDF / PNG file, Copy SVG, Copy LaTeX source).

- **Look** applies to every workspace, not just Math. Pick **Light slide**, **Dark slide** or **Custom** (your own ink and paper colours) and a font. Computer Modern stays the default; Latin Modern, Palatino, Times, Libertine, Sans serif, or any installed system font (via XeLaTeX) are the alternatives. The ink is injected as `\color{texerInk}`, so anything you colour explicitly keeps its colour. The pane's own light/dark theme no longer changes the ink, and the preview background follows the slide.
- **Boxes** take any label (type *Conjecture*, *Claim*, ...), one of five styles (bar, frame, rounded, title bar, plain), and optional accent/fill colours. **Save style...** keeps it as a preset; numbering can run automatically per label.
- **Saved** holds your own snippets (the save icon next to Examples).
- **Edit selected / Re-render all** (Microsoft 365 PowerPoint, PowerPointApi 1.5+): select a Eneles picture to load its source and replace it in place, or re-render every Eneles picture in the deck with the current Look. On older PowerPoint builds these buttons are hidden.
- The **TikZ** tab has more starters (commutative diagrams, quantum circuits, Feynman diagrams, 3D, plots, ...) and a library/package picker.

Bare snippets are wrapped in `\documentclass[preview,border=2pt]{standalone}` automatically. A source that already has `\documentclass` is compiled as-is. Lines like `\usepackage{...}` and `\usetikzlibrary{...}` are hoisted into the preamble.

## Settings

| Field | Meaning |
|---|---|
| Local server URL | Default `http://127.0.0.1:47822` |
| Token | Printed by the app on startup. The packaged `app/` build fetches it automatically; `local-server` needs it pasted once |
| Extra preamble | Applied to every Full LaTeX render |
| Crop border | `standalone` border (default `2pt`) |
| SVG fonts | Outlines (default) or embedded WOFF |
| System font name | Used when the Look font is *System font* (compiles with XeLaTeX) |
| Width (in) | Physical width on the slide (inches) |
| Raster scale | PNG sharpness (4× is a good default) |
| Transparent background | PNG without the paper colour behind it |
| Box styles | Your saved box presets (rename/delete) |

Colours and font live in the **Look** panel, not here, because they apply to every workspace.

## A real bug this uncovered: dvisvgm vs. modern Ghostscript

`dvisvgm --pdf` (needed because `pdflatex`/`xelatex`/`lualatex` only produce PDF, not DVI) depends on Ghostscript for some operations, and current `dvisvgm` releases are incompatible with Ghostscript 10.01 and newer, which is exactly what TeX Live 2024 ships. On a stock TeX Live 2024 install, `dvisvgm --pdf` fails outright with `"Ghostscript version 10.04.0 isn't supported"`.

Both `app/server.js` and `local-server/server.js` handle this automatically: they try `dvisvgm` first and silently fall back to `pdftocairo` (poppler, ships alongside `dvisvgm` in both TeX Live and MiKTeX) if it fails. You don't need to do anything, but if compiles are slower or look slightly different than expected, that's why: you're on the fallback path. Check the app's startup log (`TeX engines:` / `SVG tool:` lines) to see what was actually detected.

## Security (why a token, why a bundled CA)

- The compile API rejects `\write18` / `\directlua` / pipe `\input`, always passes `-no-shell-escape`, and (in the packaged `app/` build) is only reachable same-origin from the task pane itself. `X-Eneles-Token` is a custom header, so any cross-origin caller gets CORS-preflighted and blocked before the request ever lands. `local-server` additionally checks an Origin allowlist since it's meant to be reachable from a separately-hosted dev server.
- The bundled HTTPS certificate (`app/certs/`) is signed by a private CA generated specifically for this project (`ca-private/`, **not** committed anywhere with its private key). The exe imports only the CA's public certificate into your **CurrentUser** trusted root store on every launch (no admin rights needed, nothing system-wide). If you're uneasy about that, generate your own CA and certificate (see `ca-private/README.md`) and swap `app/certs/*` before building.
- Self-install writes only to `%LOCALAPPDATA%` and `HKEY_CURRENT_USER`. Nothing system-wide, nothing requiring admin rights.

Change the port with `TEXER_PPT_PORT` (compile API) / `TEXER_PPT_HTTPS_PORT` (task pane, `app/` only). Override the token with `TEXER_PPT_TOKEN`. `local-server` extra CORS origins: `TEXER_PPT_ALLOWED_ORIGINS` (comma-separated).

## License

[MIT](LICENSE)

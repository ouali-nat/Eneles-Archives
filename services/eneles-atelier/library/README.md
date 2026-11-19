# Eneles library

The TikZ diagrams at [texer.org/library](https://texer.org/library), which are also the templates in the editor's **Insert a TikZ diagram** picker. The site is built from this repository; a push to `main` publishes within a few minutes.

## What is here

- `packages/<id>/package.json`: one package (a CTAN package such as `pgfplots`) or one family of plain TikZ figures of our own (such as Flowcharts). The folder name is the address: `packages/graphs` is `/library/graphs`.
- `packages/<id>/<example>.tex`: one example. The file name is the address: `packages/graphs/shortest-path.tex` is `/library/graphs/shortest-path`.
- `nav.json`: the categories, the packages in each, and the examples in each package, in the order the site shows them. A package or an example that is not listed is not published.
- `previews/`: the rendered image of each example and `previews/keys.json`, made by the check below. The site shows these instead of compiling every example for every visitor.
- `scripts/check.mjs`: checks everything. Run `node scripts/check.mjs` before you push; the same check runs on every push and pull request.

## Write an example

An example is a real file that compiles on its own: the preamble lines it needs (`\usepackage`, `\usetikzlibrary`, `\usepgfplotslibrary`, `\pgfplotsset`), then the figure. It starts with a comment header:

```latex
% Name: Shortest path
% Description: Dijkstra's result from A to F: the path in orange and each vertex's distance beside it.
% Tags: shortest path, Dijkstra, weighted graph

\usetikzlibrary{arrows.meta}

\begin{tikzpicture}
  ...
\end{tikzpicture}
```

The site adds `\documentclass`, TikZ, `xcolor`, `amsmath`, and `amssymb` around it to preview it. When someone inserts it in the editor, the figure goes where their cursor is, and its preamble lines (and TikZ itself) are added to their main document, once each.

Then add the file's name to its package in `nav.json`.

### What makes a good template

- **Plain first.** Each package starts with the plainest version of the thing, with default styling, few options, and obvious labels, which people adapt. Elaborate examples (highlights, colors, custom shapes) come after.
- **Self-contained.** Put styles in the `tikzpicture`'s options, not in `\tikzset` in the preamble, so inserting one example never changes another figure in the document. Keep `\tikzset`, `\ctikzset`, and `\pgfplotsset` to a single line when they are needed.
- **Short.** Under about 40 lines. Real labels, never placeholder text.
- **Readable on white paper.** Colors such as `blue!70!black` and light fills such as `blue!10`.
- **pdfLaTeX.** Every example compiles with pdfLaTeX unless its package says otherwise (`"engine": "lualatex"` in `package.json`, or `% Engine: lualatex` in the example's header).

## Add a package

Create `packages/<id>/package.json`:

```json
{
  "name": "pgfplots",
  "description": "Create high-quality plots and charts.",
  "ctanUrl": "https://ctan.org/pkg/pgfplots",
  "tags": ["plots", "charts"]
}
```

For a family of plain TikZ figures that is not a package on CTAN, give it a plain name and `"custom": true`. The site then shows the name as ours, in the ordinary typeface, rather than as a package name. Optional: `"engine"` (`pdflatex`, `lualatex`, or `xelatex`).

Then list it, with its examples, under a category in `nav.json`. Order packages and examples by how often people need them: the everyday ones first.

## Check and preview

```bash
node scripts/check.mjs              # metadata, then every example compiled twice: as the site previews it, and as the editor inserts it into an article
node scripts/check.mjs --previews   # the same, and render the preview images into previews/
node scripts/check.mjs --only graphs,pgfplots/box-plot
```

It needs Node 22 and TeX Live; `--previews` also needs `pdftocairo` (Poppler). Commit the images in `previews/` with your change. An example whose image is missing or older than its file still works: the site compiles it on demand.

## Preview the site

Clone this repository beside the `frontend` one, so the two folders sit side by side, and run `npm install` and `npm run dev` in `frontend`. The site reads this folder directly and reloads when you save.

## House style

Sentence case for every name and description. The Oxford comma, always.

## How publishing works

1. A push to `main` runs `.github/workflows/publish.yml`: it checks the metadata and compiles every example with TeX Live, then sends a `content-updated` event to the frontend repository.
2. The frontend repository's `deploy-content.yml` workflow starts a deploy on Railway.
3. The build clones this repository (and `docs` and `learn`) and bakes the library into the site (`frontend/scripts/sync-content.mjs`): the examples into `content/library.json` and the current preview images into `public/tikz-previews/`.

### One-time setup

- **In this repository:** a secret `FRONTEND_DISPATCH_TOKEN`: a fine-grained personal access token limited to the frontend repository with Contents: Read and write.
- **In the frontend repository:** nothing new beyond what docs and learn already need (`RAILWAY_TOKEN` and `RAILWAY_SERVICE`).
- **On the frontend service in Railway, only if this repository is private:** add a read-only deploy key here (Settings → Deploy keys), then set `LIBRARY_REPO=git@github.com:Eneles-org/library.git` and `LIBRARY_DEPLOY_KEY` to the private key. A public repository needs neither: the build clones it over HTTPS.

## License

[MIT](LICENSE)

# Eneles docs

The guides at [texer.org/docs](https://texer.org/docs): how to use Eneles, and the API reference. The site is built from this repository; a push to `main` publishes within a few minutes.

LaTeX itself is taught in the lessons, which live in the `learn` repository.

## What is here

- `pages/<name>.mdx`: one guide. The file name is the address: `pages/compiling.mdx` is `/docs/compiling`, and `pages/api/snips.mdx` is `/docs/api/snips`.
- `nav.json`: which pages appear in the sidebar, in which group, and in which order. A page that is not listed is not published.
- `scripts/check.mjs`: checks the pages. Run `node scripts/check.mjs` before you push; the same check runs on every push and pull request.

## Write a page

Start the file with its title and a one-sentence description. The description is shown in search results and on the docs overview. `keywords` are extra search terms that are not already in the title. `summary` is the text search engines, AI assistants, and link previews show: one or two sentences of 120 to 160 characters that name the topic and what the page covers. The check refuses a summary outside that range; a page without one uses its description.

```mdx
---
title: "Compiling"
description: "Engines, the main document, bibliographies, draft mode, and errors."
summary: "How Eneles compiles LaTeX to PDF: engines, the main document, bibliographies and indexes, draft mode, time limits, reading errors, and jumping to the source."
keywords: ["pdflatex", "xelatex", "biber", "log"]
---

# Compiling

The first paragraph says what the page covers.

## A section

Sections get a link and appear in the page's contents on the right.
```

Then add the file's name to a group in `nav.json`:

```json
{ "title": "Guides", "pages": ["projects-and-files", "compiling"] }
```

An entry written as an object with `"builtIn": true` (the two overview pages) is part of the site itself and has no file here.

## What a page can use

Pages are Markdown with a few components. They cannot `import` or `export`; the check refuses a page that does.

| Write | For |
|---|---|
| `<Callout type="tip" title="…">…</Callout>` | An aside. `type` is `tip`, `note`, or `warning`. |
| `<ShortcutsTable shortcuts={[{ … }]} />` | A table of keyboard shortcuts. See `pages/keyboard-shortcuts.mdx`. |
| `<Endpoint method="POST" path="/snips" description="…" auth="…" request="…" response="…" />` | One API endpoint, in the API reference. |
| A fenced block marked `latex`, `bash`, `json`, … | Code with a copy button. |
| A fenced block marked `latex-example` | LaTeX shown beside what it compiles to. The site compiles it, so it must compile. |
| A fenced block marked `latex-document` | The same, for a complete document (with its own `\documentclass`). |
| Tables, task lists, footnotes | GitHub-flavored Markdown works as written. |

## House style

- Describe what Eneles does today. If you have not checked a behaviour in the app, do not write it.
- Sentence case for every heading and label. The Oxford comma, always.
- One idea per paragraph, the instruction before the explanation, and the name of a button exactly as the app shows it, in bold.

## Preview your changes

Clone this repository beside the `frontend` one, so the two folders sit side by side, and run `npm install` and `npm run dev` in `frontend`. The site reads this folder directly and reloads when you save.

## How publishing works

1. A push to `main` runs `.github/workflows/publish.yml`: it checks the pages, then sends a `content-updated` event to the frontend repository.
2. The frontend repository's `deploy-content.yml` workflow starts a deploy on Railway.
3. The build clones this repository and `learn`, and bakes the pages into the site (`frontend/scripts/sync-content.mjs`).

### One-time setup

- **In this repository:** a secret `FRONTEND_DISPATCH_TOKEN`: a fine-grained personal access token limited to the frontend repository with Contents: Read and write.
- **In the frontend repository:** a secret `RAILWAY_TOKEN` (a Railway project token for production) and a variable `RAILWAY_SERVICE` (the frontend service's name).
- **On the frontend service in Railway, only if this repository is private:** add a read-only deploy key here (Settings → Deploy keys), then set `DOCS_REPO=git@github.com:Eneles-org/docs.git` and `DOCS_DEPLOY_KEY` to the private key. A public repository needs neither: the build clones it over HTTPS.

## License

[MIT](LICENSE)

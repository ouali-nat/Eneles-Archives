# Eneles Learn

The LaTeX lessons at [texer.org/learn](https://texer.org/learn): short pages that teach LaTeX itself, each with examples compiled on the page. The site is built from this repository; a push to `main` publishes within a few minutes.

How to use Eneles (the editor, sharing, plans) is in the `docs` repository.

## What is here

- `lessons/<name>.mdx`: one lesson. The file name is the address: `lessons/first-document.mdx` is `/learn/first-document`.
- `nav.json`: the tracks, and the lessons in each, in reading order. A lesson that is not listed is not published.
- `scripts/check.mjs`: checks the lessons. Run `node scripts/check.mjs` before you push; the same check runs on every push and pull request.

## Write a lesson

Start the file with its title and a one-sentence description. The description is shown under the title in the track's listing and in search. `keywords` are what someone would type to find the lesson: the commands it teaches and the words for what they do. `summary` is the text search engines, AI assistants, and link previews show: one or two sentences of 120 to 160 characters that name the topic and what the lesson covers. The check refuses a summary outside that range; a lesson without one uses its description.

```mdx
---
title: "Lists"
description: "Bulleted, numbered, and description lists, and how to nest and restyle them."
summary: "Lists in LaTeX: itemize, enumerate, and description lists, nesting, and custom labels, spacing, and numbering with the enumitem package, with examples."
keywords: ["itemize", "enumerate", "\\item", "bullet", "nested list"]
---

# Lists

One or two sentences on what the reader will be able to do.

## Bulleted lists

Show the smallest example that works, then say what each part does.
```

Then add the file's name to a track in `nav.json`, at the point in the order where a reader should meet it:

```json
{ "id": "start", "title": "Getting started", "description": "…", "lessons": ["what-is-latex", "first-document", "lists"] }
```

## Examples

A lesson is mostly examples. Mark a fenced block `latex-example` and the page shows the source beside the PDF it produces:

````mdx
```latex-example
Some \textbf{bold} and some \emph{emphasized} text.
```
````

The site wraps the block in a small document and compiles it, so it must compile on its own. When the example is a whole document (it has its own `\documentclass`), mark it `latex-document` instead. Use a plain `latex` block for a fragment that is shown but not compiled, such as a preamble line.

`<Callout type="tip" title="…">…</Callout>` adds an aside (`tip`, `note`, or `warning`). Lessons cannot `import` or `export`; the check refuses one that does.

## House style

- One lesson, one skill, readable in five minutes. Link to the next lesson instead of growing this one.
- The example first, then the explanation. Name the package a command needs the first time it appears.
- Every example is compiled by the site, so run the page locally and look at each one before you push.
- Sentence case for every heading. The Oxford comma, always.

## Preview your changes

Clone this repository beside the `frontend` one, so the two folders sit side by side, and run `npm install` and `npm run dev` in `frontend`. The site reads this folder directly and reloads when you save. The compiled examples need the API and the compiler running too.

## How publishing works

1. A push to `main` runs `.github/workflows/publish.yml`: it checks the lessons, then sends a `content-updated` event to the frontend repository.
2. The frontend repository's `deploy-content.yml` workflow starts a deploy on Railway.
3. The build clones this repository and `docs`, and bakes the pages into the site (`frontend/scripts/sync-content.mjs`).

### One-time setup

- **In this repository:** a secret `FRONTEND_DISPATCH_TOKEN`: a fine-grained personal access token limited to the frontend repository with Contents: Read and write.
- **In the frontend repository:** a secret `RAILWAY_TOKEN` (a Railway project token for production) and a variable `RAILWAY_SERVICE` (the frontend service's name).
- **On the frontend service in Railway, only if this repository is private:** add a read-only deploy key here (Settings → Deploy keys), then set `LEARN_REPO=git@github.com:Eneles-org/learn.git` and `LEARN_DEPLOY_KEY` to the private key. A public repository needs neither: the build clones it over HTTPS.

## License

[MIT](LICENSE)

// Checks the library before it is published: nav.json and every package's metadata, then compiles every example with the local TeX Live, the way the site previews it and the way the editor inserts it into a document. Run `node scripts/check.mjs` (add --previews to render the preview images too). It needs Node 22 and TeX Live; --previews also needs pdftocairo (Poppler).
//
//   node scripts/check.mjs                         everything
//   node scripts/check.mjs --only graphs,pgfplots/box-plot
//   node scripts/check.mjs --metadata              only nav.json and the metadata, no TeX needed
//   node scripts/check.mjs --previews              also write previews/<package>/<example>.png and previews/keys.json
//   node scripts/check.mjs --out <folder>          where the builds go (default: a folder in the system's temporary directory)
//   node scripts/check.mjs --jobs <n>              how many compiles run at once (default 6)
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const only = option("--only", "");
const outDir = path.resolve(option("--out", path.join(os.tmpdir(), "texer-library-check")));
const jobs = Math.max(1, Number(option("--jobs", "6")) || 6);
const previews = flag("--previews");

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENGINES = ["pdflatex", "lualatex", "xelatex"];
const problems = [];
const notes = [];

// ── Metadata ──────────────────────────────────────────────────────────

/** An example file: its header (Name, Description, Tags, and optionally Engine) and the source below it. */
export function readExample(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const header = /^((?:%[^\n]*\n)+)\n?/.exec(text);
  const meta = {};
  for (const line of (header?.[1] ?? "").split("\n")) {
    const m = /^%\s*(Name|Description|Tags|Engine):\s*(.*)$/.exec(line);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
  }
  return { meta, source: text.slice(header ? header[0].length : 0).trim(), text };
}

const nav = JSON.parse(fs.readFileSync(path.join(root, "nav.json"), "utf8"));
const listed = [];
const seenPackages = new Set();
for (const category of nav.categories ?? []) {
  if (!category.title) problems.push("nav.json: a category has no title.");
  for (const entry of category.packages ?? []) {
    const id = entry.id;
    if (!ID.test(id ?? "")) problems.push(`nav.json: "${id}" is not a usable package id (lower-case letters, digits, and hyphens).`);
    if (seenPackages.has(id)) problems.push(`nav.json lists the package "${id}" twice.`);
    seenPackages.add(id);
    const dir = path.join(root, "packages", id);
    const metaFile = path.join(dir, "package.json");
    if (!fs.existsSync(metaFile)) {
      problems.push(`nav.json lists "${id}", but packages/${id}/package.json does not exist.`);
      continue;
    }
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    } catch (err) {
      problems.push(`packages/${id}/package.json: ${err.message}`);
      continue;
    }
    for (const field of ["name", "description", "ctanUrl"]) if (typeof meta[field] !== "string" || !meta[field].trim()) problems.push(`packages/${id}/package.json needs a ${field}.`);
    if (!Array.isArray(meta.tags) || !meta.tags.length) problems.push(`packages/${id}/package.json needs a list of tags.`);
    if (meta.custom !== undefined && typeof meta.custom !== "boolean") problems.push(`packages/${id}/package.json: custom is true or false.`);
    if (meta.engine !== undefined && !ENGINES.includes(meta.engine)) problems.push(`packages/${id}/package.json: engine is one of ${ENGINES.join(", ")}.`);
    const seenExamples = new Set();
    for (const exId of entry.examples ?? []) {
      if (!ID.test(exId)) problems.push(`nav.json: "${id}/${exId}" is not a usable example id.`);
      if (seenExamples.has(exId)) problems.push(`nav.json lists "${id}/${exId}" twice.`);
      seenExamples.add(exId);
      const file = path.join(dir, `${exId}.tex`);
      if (!fs.existsSync(file)) {
        problems.push(`nav.json lists "${id}/${exId}", but packages/${id}/${exId}.tex does not exist.`);
        continue;
      }
      const ex = readExample(file);
      for (const field of ["name", "description", "tags"]) if (!ex.meta[field]) problems.push(`packages/${id}/${exId}.tex: the header needs a "% ${field[0].toUpperCase()}${field.slice(1)}:" line.`);
      if (ex.meta.engine && !ENGINES.includes(ex.meta.engine)) problems.push(`packages/${id}/${exId}.tex: Engine is one of ${ENGINES.join(", ")}.`);
      if (!ex.source) problems.push(`packages/${id}/${exId}.tex has no source below its header.`);
      const lines = ex.source.split("\n").length;
      if (lines > 45) notes.push(`${id}/${exId}: ${lines} lines; a template should stay under about 40.`);
      if (/\blorem\b|\bipsum\b/i.test(ex.source)) problems.push(`packages/${id}/${exId}.tex has placeholder text.`);
      listed.push({ pkg: id, packageName: meta.name, id: exId, file, engine: ex.meta.engine ?? meta.engine ?? "pdflatex", ...ex });
    }
    for (const f of fs.readdirSync(dir)) if (f.endsWith(".tex") && !seenExamples.has(f.slice(0, -4))) problems.push(`packages/${id}/${f} is not listed in nav.json, so the site will not show it.`);
  }
}
for (const dir of fs.readdirSync(path.join(root, "packages"))) if (!seenPackages.has(dir)) problems.push(`packages/${dir} is not listed in nav.json, so the site will not show it.`);

// ── Compiling ─────────────────────────────────────────────────────────

/** Lines that belong in the preamble. Keep in step with frontend/lib/tikz/utils.ts and frontend/lib/tikz/insert.ts. */
const PREAMBLE_LINE = /^\\(usepackage|usetikzlibrary|usepgfplotslibrary|pgfplotsset|tikzset|ctikzset)\b/;

/** The document the site compiles for a preview: frontend/lib/tikz/utils.ts, constructLatex. */
function previewDocument(source) {
  if (source.includes("\\documentclass")) return source.trim();
  const preamble = ["\\documentclass[margin=3mm]{standalone}"];
  if (!/\\usepackage(\[.*\])?\{tikz\}/.test(source)) preamble.push("\\usepackage{tikz}");
  if (!/\\usepackage(\[.*\])?\{xcolor\}/.test(source)) preamble.push("\\usepackage{xcolor}");
  preamble.push("\\usepackage{amsmath}", "\\usepackage{amssymb}");
  const body = [];
  for (const line of source.split("\n")) (PREAMBLE_LINE.test(line.trim()) ? preamble : body).push(PREAMBLE_LINE.test(line.trim()) ? line.trim() : line);
  return `${preamble.join("\n")}\n\n\\begin{document}\n${body.join("\n")}\n\\end{document}`;
}

/** Packages that load TikZ themselves (frontend/lib/tikz/insert.ts). */
const LOADS_TIKZ = new Set(["tikz", "pgfplots", "circuitikz", "tikz-cd", "quantikz", "forest", "tikz-feynman", "pgfgantt", "venndiagram", "chronology", "zx-calculus", "optikz", "tikzorbital", "neuralnetwork", "smartdiagram", "tensormatrix", "polyhedra", "dynkin-diagrams", "tkz-euclide"]);

/** The example as the editor's template picker puts it into an empty article: what it adds to the preamble, and the figure in the body (frontend/lib/tikz/insert.ts). */
function insertedDocument(source) {
  const preamble = [];
  const body = [];
  for (const line of source.split("\n")) (PREAMBLE_LINE.test(line.trim()) ? preamble : body).push(PREAMBLE_LINE.test(line.trim()) ? line.trim() : line);
  const packages = preamble.filter((l) => l.startsWith("\\usepackage"));
  const rest = preamble.filter((l) => !l.startsWith("\\usepackage"));
  const loaded = packages.flatMap((l) => (/\{([^}]*)\}/.exec(l)?.[1] ?? "").split(",").map((s) => s.trim()));
  const text = body.join("\n");
  if ((/\\begin\{tikzpicture\}|\\tikz\b|\\usetikzlibrary/.test(source)) && !loaded.some((p) => LOADS_TIKZ.has(p))) packages.unshift("\\usepackage{tikz}");
  if (/\\text\{|\\operatorname|\\dfrac|\\tfrac/.test(text) && !loaded.includes("amsmath")) packages.push("\\usepackage{amsmath}");
  if (/\\(mathbb|mathfrak|varnothing|leqslant|geqslant|checkmark|lrcorner|ulcorner|urcorner|llcorner|square|blacksquare|twoheadrightarrow|rightarrowtail|therefore)\b/.test(text) && !loaded.includes("amssymb")) packages.push("\\usepackage{amssymb}");
  return `\\documentclass{article}\n${[...packages, ...rest].join("\n")}\n\\begin{document}\n${text.trim()}\n\\end{document}\n`;
}

/** The interesting lines of a log: errors with their context, and warnings worth a look. */
function readLog(log) {
  const lines = log.split("\n");
  const errors = [];
  lines.forEach((line, i) => {
    if (line.startsWith("!") || /^[^:]*:\d+: /.test(line)) errors.push([line, ...lines.slice(i + 1, i + 3)].join(" ").replace(/\s+/g, " ").trim());
  });
  const warnings = new Set();
  for (const line of lines) {
    if (/Overfull \\[hv]box/.test(line) || /File `[^']+' not found/.test(line)) warnings.add(line.trim());
    else if (/(Package|LaTeX|Class) [\w-]* ?Warning/.test(line) && !/Font Warning|Unused global option|Shell escape disabled|LuaTeX is required|tried to use .\/graph drawing|Rerun to get/.test(line)) warnings.add(line.trim());
  }
  return { errors: errors.slice(0, 3), warnings: [...warnings].slice(0, 6) };
}

/** One compile with the site's compiler flags (frontend's compiler/server.js), and a second pass when the first asks for one. */
async function compile(dir, latex, engine) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "main.tex"), latex);
  const log = path.join(dir, "main.log");
  let ok = true;
  for (let pass = 0; pass < 2 && ok; pass++) {
    try {
      await run(engine, ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-no-shell-escape", "main.tex"], { cwd: dir, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    } catch {
      ok = false;
    }
    if (!fs.existsSync(log) || !/Rerun to get/.test(fs.readFileSync(log, "latin1"))) break;
  }
  return { ok: ok && fs.existsSync(path.join(dir, "main.pdf")), ...readLog(fs.existsSync(log) ? fs.readFileSync(log, "latin1") : "") };
}

/** The key of a preview image: a hash of the example file, so a changed example is known to need a new image. */
export const previewKey = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex").slice(0, 12);

async function check(ex) {
  const dir = path.join(outDir, `${ex.pkg}__${ex.id}`);
  const preview = await compile(dir, previewDocument(ex.source), ex.engine);
  const inserted = await compile(path.join(dir, "inserted"), insertedDocument(ex.source), ex.engine);
  const result = {
    key: `${ex.pkg}/${ex.id}`,
    ok: preview.ok && inserted.ok,
    errors: [...preview.errors, ...(inserted.ok ? [] : inserted.errors.map((e) => `inserted into an article: ${e}`))],
    // An overfull line in the article is a figure wider than the text.
    warnings: [...preview.warnings, ...inserted.warnings.filter((w) => w.startsWith("Overfull \\hbox")).map((w) => `in an article, wider than the text: ${w}`)],
  };
  if (preview.ok && previews) {
    const pdf = path.join(dir, "main.pdf");
    const { stdout } = await run("pdfinfo", [pdf]);
    const [, w, h] = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(stdout) ?? [0, 400, 300];
    // At most 3x, and at most 1400 pixels on the long side, like a live preview in the site.
    const dpi = Math.round(72 * Math.min(3, 1400 / Math.max(Number(w), Number(h))));
    const base = path.join(root, "previews", ex.pkg, ex.id);
    fs.mkdirSync(path.dirname(base), { recursive: true });
    await run("pdftocairo", ["-png", "-singlefile", "-f", "1", "-l", "1", "-r", String(dpi), pdf, base]);
    result.previewKey = previewKey(ex.text);
  }
  return result;
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
if (flag("--metadata")) {
  console.log(`${seenPackages.size} packages and ${listed.length} examples, no problems in the metadata.`);
  process.exit(0);
}

const targets = listed.filter((ex) => !only || only.split(",").some((t) => {
  const [p, e] = t.split("/");
  return ex.pkg === p && (!e || ex.id === e);
}));
console.log(`Compiling ${targets.length} examples, ${jobs} at a time, in ${outDir}`);
const results = [];
let next = 0;
await Promise.all(Array.from({ length: jobs }, async () => {
  while (next < targets.length) {
    const r = await check(targets[next++]);
    results.push(r);
    process.stdout.write(r.ok ? (r.warnings.length ? "w" : ".") : "F");
  }
}));
process.stdout.write("\n\n");

const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log(`FAIL ${r.key}\n  ${r.errors.join("\n  ") || "no error in the log (a timeout?)"}`);
for (const r of results.filter((x) => x.ok && x.warnings.length)) console.log(`WARN ${r.key}\n  ${r.warnings.join("\n  ")}`);
for (const n of notes) console.log(`NOTE ${n}`);

// Previews: write the keys of the images just made, and say which examples have no current image.
const keysFile = path.join(root, "previews", "keys.json");
const keys = fs.existsSync(keysFile) ? JSON.parse(fs.readFileSync(keysFile, "utf8")) : {};
for (const r of results) if (r.previewKey) keys[r.key] = r.previewKey;
const live = new Set(listed.map((ex) => `${ex.pkg}/${ex.id}`));
for (const key of Object.keys(keys)) {
  if (live.has(key)) continue;
  delete keys[key];
  fs.rmSync(path.join(root, "previews", `${key}.png`), { force: true });
}
if (previews) {
  fs.mkdirSync(path.dirname(keysFile), { recursive: true });
  fs.writeFileSync(keysFile, `${JSON.stringify(Object.fromEntries(Object.entries(keys).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
}
const stale = listed.filter((ex) => keys[`${ex.pkg}/${ex.id}`] !== previewKey(ex.text)).map((ex) => `${ex.pkg}/${ex.id}`);
if (stale.length) console.log(`PREVIEW ${stale.length} examples have no current preview image (the site compiles those on demand): run with --previews. ${stale.slice(0, 8).join(", ")}${stale.length > 8 ? ", …" : ""}`);

console.log(`\n${results.length - failed.length} of ${results.length} compile.`);
if (failed.length) process.exitCode = 1;

#!/usr/bin/env node
/**
 * Tests for lib/synctex.ts against the real `synctex` CLI.
 *
 *   node scripts/test-synctex.mjs            run the tests on the committed fixtures (needs nothing but Node 18+ and the project's node_modules)
 *   node scripts/test-synctex.mjs --regen    rebuild the fixtures first (needs TeX Live: pdflatex, xelatex, lualatex, synctex)
 *   node scripts/test-synctex.mjs --bench    also build a book-length document (about 1,300 pages) and time parsing and lookups (needs pdflatex)
 *
 * A fixture is a folder under lib/__fixtures__/synctex with the sources in src/, and per engine the .synctex.gz TeX wrote plus what `synctex edit` and `synctex view` answered for a few hundred positions. The tests replay every one of those positions through the library and count agreement, then check the parts the CLI does not have (project paths, package files, narrowed highlights, word columns, edited sources, rotated pages).
 *
 * Fixtures are compiled the way the compile service does it (job folder as both the working and the output directory), in SYNCTEX_FIXTURE_WORKDIR or the system temp folder, and the job folder's path is rewritten to /tmp/texer-jobs/fixture before anything is stored.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));

// The library is TypeScript. It is turned into JavaScript with the project's own compiler and loaded from inside node_modules, so its one import ("diff") resolves and no Node flag or extra tool is needed.
const ts = createRequire(import.meta.url)("typescript");
const compiledDir = path.join(here, "../node_modules/.cache/synctex-test");
fs.mkdirSync(compiledDir, { recursive: true });
const compiledFile = path.join(compiledDir, "synctex.mjs");
fs.writeFileSync(compiledFile, ts.transpileModule(fs.readFileSync(path.join(here, "../lib/synctex.ts"), "utf8"), { compilerOptions: { module: "ESNext", target: "ES2022" } }).outputText);
const synctex = await import(pathToFileURL(compiledFile).href + "?" + Date.now());
const FIXTURES = path.join(here, "../lib/__fixtures__/synctex");
const JOB = "/tmp/texer-jobs/fixture";
const ENGINES = { pdftex: "pdflatex", xetex: "xelatex", luatex: "lualatex" };
/** Which engines each fixture is built with. */
const PLAN = { basic: ["pdftex", "xetex", "luatex"], multi: ["pdftex", "xetex", "luatex"], twocol: ["pdftex", "luatex"], forms: ["pdftex"] };
/** Fixtures to replay against the CLI: the plan, plus the hand-wrapped form (see buildWrappedForm). */
const REPLAY = { ...PLAN, forms: ["pdftex", "wrapped"] };

const args = new Set(process.argv.slice(2));

// ─── Small helpers ───────────────────────────────────────────────────────────

/** Deterministic random numbers, so a regenerated fixture samples the same positions. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

function parseCliBlocks(stdout) {
  const blocks = [];
  let current = null;
  for (const raw of stdout.split("\n")) {
    const at = raw.indexOf(":");
    if (at < 0) continue;
    const key = raw.slice(0, at);
    const value = raw.slice(at + 1);
    if (key === "Output") {
      current = {};
      blocks.push(current);
    } else if (current) current[key] = value;
  }
  return blocks;
}

function cli(cwd, argv) {
  try {
    return execFileSync("synctex", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    return error.stdout || "";
  }
}

// ─── Building fixtures ───────────────────────────────────────────────────────

function regenerate(only) {
  const workRoot = process.env.SYNCTEX_FIXTURE_WORKDIR || fs.mkdtempSync(path.join(os.tmpdir(), "synctex-fixtures-"));
  for (const [name, engines] of Object.entries(PLAN)) {
    if (only && only !== name) continue;
    const src = path.join(FIXTURES, name, "src");
    for (const engine of engines) {
      const job = path.join(workRoot, `${name}-${engine}`);
      fs.rmSync(job, { recursive: true, force: true });
      fs.cpSync(src, job, { recursive: true });
      const argv = ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-synctex=1", `-output-directory=${job}`, "-no-shell-escape", "main.tex"];
      for (let pass = 0; pass < 3; pass++) {
        try {
          execFileSync(ENGINES[engine], argv, { cwd: job, stdio: "ignore", timeout: 180000 });
        } catch {
          throw new Error(`${ENGINES[engine]} failed on fixture ${name}: see ${path.join(job, "main.log")}`);
        }
      }
      // The job folder's real path must not reach the repository, and the CLI has to read the same bytes the tests do.
      const text = zlib.gunzipSync(fs.readFileSync(path.join(job, "main.synctex.gz"))).toString("latin1").split(job).join(JOB);
      const gz = zlib.gzipSync(Buffer.from(text, "latin1"), { level: 9 });
      const cliDir = path.join(job, "cli");
      fs.mkdirSync(cliDir, { recursive: true });
      fs.writeFileSync(path.join(cliDir, "main.synctex.gz"), gz);
      fs.writeFileSync(path.join(FIXTURES, name, `${engine}.synctex.gz`), gz);

      const ix = synctex.parseSyncTexBytes(new Uint8Array(Buffer.from(text, "latin1")));
      const random = rng(name.length * 7919 + engine.length);
      const pages = [];
      for (let p = 1; p <= ix.pageCount; p++) pages.push(p);
      // Up to four pages, the first and the last always among them.
      const picked = pages.length <= 4 ? pages : [1, 2, Math.ceil(pages.length / 2), pages.length];
      const edit = [];
      for (const page of picked) {
        // Points all over a Letter-sized area, margins included: the CLI needs no PDF, so the true page size does not matter here.
        const width = 612;
        const height = 792;
        for (let i = 0; i < 70; i++) {
          const x = Math.round(random() * width * 100) / 100;
          const y = Math.round(random() * height * 100) / 100;
          const blocks = parseCliBlocks(cli(cliDir, ["edit", "-o", `${page}:${x}:${y}:main.pdf`]));
          edit.push([page, x, y, blocks.map((b) => [b.Input, Number(b.Line)])]);
        }
      }
      const view = [];
      const projectFiles = listFiles(src);
      for (const input of ix.inputs) {
        const relative = input.name.startsWith(JOB + "/") ? synctex.normalizeTexPath(input.name.slice(JOB.length + 1)) : null;
        if (!relative || !projectFiles.includes(relative)) continue;
        if (view.some((entry) => entry[0] === input.name)) continue;
        const lineCount = fs.readFileSync(path.join(src, relative), "utf8").split("\n").length;
        const step = Math.max(1, Math.ceil(lineCount / 90));
        for (let line = 1; line <= lineCount; line += step) {
          const blocks = parseCliBlocks(cli(cliDir, ["view", "-i", `${line}:0:${input.name}`, "-o", "main.pdf"]));
          view.push([input.name, line, blocks.map((b) => [Number(b.Page), Number(b.x), Number(b.y), Number(b.h), Number(b.v), Number(b.W), Number(b.H)])]);
        }
      }
      fs.writeFileSync(path.join(FIXTURES, name, `${engine}.cli.json.gz`), zlib.gzipSync(JSON.stringify({ edit, view }), { level: 9 }));
      console.log(`built ${name}/${engine}: ${ix.pageCount} pages, ${edit.length} edit and ${view.length} view samples`);
      if (name === "forms") buildWrappedForm(text, job);
    }
  }
}

/**
 * pdfTeX writes the content of a PDF form without the `<` and `>` records the format calls for, so the form of the fixture is never resolved, by the CLI or here. To test form handling all the same, this variant moves that content into a proper form record in front of the sheet, as an engine following the format would write it, and asks the CLI about it.
 */
function buildWrappedForm(text, job) {
  const lines = text.split("\n");
  const sheetStart = lines.findIndex((l) => l.startsWith("{1"));
  const sheetEnd = lines.findIndex((l) => l.startsWith("}1"));
  let lastClose = sheetEnd;
  while (lastClose > sheetStart && lines[lastClose] !== "]") lastClose--;
  const stray = lines.slice(lastClose + 1, sheetEnd).filter((l) => !l.startsWith("!"));
  const kept = [...lines.slice(0, sheetStart), "<1", "(1,6:0,455111:7820642,455111,0", ...stray, ")", ">", ...lines.slice(sheetStart, lastClose + 1), ...lines.slice(sheetEnd)];
  const wrapped = kept.join("\n");
  const gz = zlib.gzipSync(Buffer.from(wrapped, "latin1"), { level: 9 });
  const cliDir = path.join(job, "cli-wrapped");
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(path.join(cliDir, "main.synctex.gz"), gz);
  fs.writeFileSync(path.join(FIXTURES, "forms", "wrapped.synctex.gz"), gz);
  const random = rng(4711);
  const edit = [];
  for (let i = 0; i < 120; i++) {
    // Mostly around the two places the form is used, where the copies are.
    const x = Math.round((i < 80 ? 130 + random() * 250 : random() * 612) * 100) / 100;
    const y = Math.round((i < 80 ? 125 + random() * 45 : random() * 792) * 100) / 100;
    const blocks = parseCliBlocks(cli(cliDir, ["edit", "-o", `1:${x}:${y}:main.pdf`]));
    edit.push([1, x, y, blocks.map((b) => [b.Input, Number(b.Line)])]);
  }
  const view = [];
  for (let line = 1; line <= 14; line++) {
    const blocks = parseCliBlocks(cli(cliDir, ["view", "-i", `${line}:0:${JOB}/main.tex`, "-o", "main.pdf"]));
    view.push([`${JOB}/main.tex`, line, blocks.map((b) => [Number(b.Page), Number(b.x), Number(b.y), Number(b.h), Number(b.v), Number(b.W), Number(b.H)])]);
  }
  fs.writeFileSync(path.join(FIXTURES, "forms", "wrapped.cli.json.gz"), zlib.gzipSync(JSON.stringify({ edit, view }), { level: 9 }));
  console.log(`built forms/wrapped: ${edit.length} edit and ${view.length} view samples`);
}

// ─── Test runner ─────────────────────────────────────────────────────────────

let failures = 0;
let checks = 0;
function check(condition, message) {
  checks++;
  if (!condition) {
    failures++;
    console.log(`  FAIL ${message}`);
  }
}

function load(name, engine) {
  const gz = fs.readFileSync(path.join(FIXTURES, name, `${engine}.synctex.gz`));
  const ix = synctex.parseSyncTexBytes(new Uint8Array(zlib.gunzipSync(gz)));
  const expected = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, name, `${engine}.cli.json.gz`))).toString("utf8"));
  const src = path.join(FIXTURES, name, "src");
  const files = Object.fromEntries(listFiles(src).map((f) => [f, fs.readFileSync(path.join(src, f), "utf8")]));
  const map = synctex.mapInputsToProject(ix, Object.keys(files), "main.tex");
  return { ix, gz, expected, files, map };
}

const near = (a, b) => Math.abs(a - b) <= 0.02;

/** Replay every CLI sample. Returns the agreement counts. */
function compareWithCli(label, ix, expected, verbose) {
  let editSame = 0;
  for (const [page, x, y, want] of expected.edit) {
    const got = synctex.editQuery(ix, page, x, y);
    // The CLI prints the first result's file name for every result, so only the lines of later ones can be compared.
    const same = got.length === want.length && got.every((g, i) => g.line === want[i][1] && (i > 0 || g.input === want[i][0]));
    if (same) editSame++;
    else if (verbose) console.log(`    edit ${page}:${x}:${y} cli=${JSON.stringify(want)} lib=${JSON.stringify(got.map((g) => [g.input, g.line]))}`);
  }
  let viewSame = 0;
  let viewSameSet = 0;
  for (const [input, line, want] of expected.view) {
    // A file read twice has two inputs of the same name: the CLI answers for the one read last.
    const tag = ix.inputs.findLast((i) => i.name === input)?.tag ?? -1;
    const got = synctex.displayQuery(ix, tag, line).map((r) => [r.page, r.x, r.y, r.h, r.v, r.W, r.H]);
    const eq = (a, b) => a[0] === b[0] && a.slice(1).every((value, i) => near(value, b[i + 1]));
    const ordered = got.length === want.length && got.every((g, i) => eq(g, want[i]));
    if (ordered) viewSame++;
    const asSet = got.length === want.length && want.every((w) => got.some((g) => eq(g, w)));
    if (asSet) viewSameSet++;
    if (!ordered && verbose) console.log(`    view ${path.basename(input)}:${line} cli=${JSON.stringify(want.slice(0, 3))} lib=${JSON.stringify(got.slice(0, 3))} (${want.length} vs ${got.length})`);
  }
  const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) : "100.0") + "%";
  console.log(`  ${label}: edit ${editSame}/${expected.edit.length} (${pct(editSame, expected.edit.length)}), view ${viewSame}/${expected.view.length} (${pct(viewSame, expected.view.length)}) in the CLI's order, ${viewSameSet}/${expected.view.length} as a set`);
  return { editSame, editTotal: expected.edit.length, viewSame, viewTotal: expected.view.length, viewSameSet };
}

/** Source line (1-based) of the first line containing `text` in a fixture file. */
function lineOf(files, file, text, nth = 1) {
  const lines = files[file].split("\n");
  let seen = 0;
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(text) && ++seen === nth) return i + 1;
  throw new Error(`"${text}" is not in ${file}`);
}

/** The middle of the first highlight for a source line: a point that must map back to that line. */
function roundTrip(ix, map, files, file, text, label) {
  const line = lineOf(files, file, text);
  const tags = map.tagsOfPath.get(file) ?? [];
  const hit = synctex.forwardSearch(ix, tags, line);
  check(hit !== null && hit.exact, `${label}: forward search finds ${file}:${line} itself`);
  if (!hit) return null;
  const rect = hit.rects[hit.primary];
  check(rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0, `${label}: the highlight is a real rectangle`);
  const back = synctex.inverseSearch(ix, rect.page, rect.x + rect.width / 2, rect.y + rect.height / 2, (tag) => map.pathOfTag.has(tag));
  const lines = back ? back.candidates.filter((c) => map.pathOfTag.get(c.tag) === file).map((c) => c.line) : [];
  check(back !== null && lines.includes(line), `${label}: the middle of the highlight for ${file}:${line} maps back to it (got ${back ? `${map.pathOfTag.get(back.tag)}:${back.line}, candidates ${lines.join(",")}` : "nothing"})`);
  return hit;
}

async function run() {
  const verbose = args.has("--verbose");
  const totals = [];

  console.log("Agreement with the synctex CLI");
  for (const [name, engines] of Object.entries(REPLAY)) {
    for (const engine of engines) {
      if (!fs.existsSync(path.join(FIXTURES, name, `${engine}.synctex.gz`))) {
        check(false, `fixture ${name}/${engine} is missing: run with --regen`);
        continue;
      }
      const { ix, gz, expected } = load(name, engine);
      const result = compareWithCli(`${name}/${engine}`, ix, expected, verbose);
      totals.push({ name, engine, ...result });
      check(result.editSame === result.editTotal, `${name}/${engine}: every edit sample agrees with the CLI`);
      check(result.viewSameSet === result.viewTotal, `${name}/${engine}: every view sample agrees with the CLI`);

      // The streaming path the browser uses must build the very same index.
      const streamed = await synctex.parseSyncTexGzip(new Uint8Array(gz), 1);
      check(streamed !== null && streamed.count === ix.count && streamed.pageCount === ix.pageCount, `${name}/${engine}: streamed parse matches the one-shot parse`);
      if (streamed) {
        let same = true;
        for (let i = 0; i < ix.count && same; i++) same = streamed.line[i] === ix.line[i] && streamed.h[i] === ix.h[i] && streamed.v[i] === ix.v[i] && streamed.friendNext[i] === ix.friendNext[i];
        check(same, `${name}/${engine}: streamed parse has identical records`);
      }
    }
  }

  console.log("Units");
  {
    const { ix } = load("basic", "pdftex");
    check(Math.abs(ix.unit - 1 / 65781.76) < 1e-15, "1 bp is 65781.76 sp");
    // TeX's origin is 1 in from the top-left: 4736286 sp is 72 bp (72.27 pt).
    check(Math.abs(4736286 * ix.unit - 72) < 0.001, "1 in of scaled points is 72 PDF points, not 72.27");
  }

  console.log("Project paths");
  for (const engine of PLAN.multi) {
    const { ix, map, files } = load("multi", engine);
    for (const file of ["main.tex", "shared.tex", "chapters/intro.tex", "chapters/methods.tex", "sub/part.tex", "localmacros.sty"]) check(map.tagsOfPath.has(file), `multi/${engine}: ${file} is matched to an input`);
    check((map.tagsOfPath.get("shared.tex") ?? []).length === 2, `multi/${engine}: a file read twice has two tags`);
    check(![...map.pathOfTag.values()].some((p) => !(p in files)), `multi/${engine}: nothing outside the project is matched`);
    const external = ix.inputs.filter((i) => !map.pathOfTag.has(i.tag)).map((i) => i.name);
    check(external.some((n) => n.endsWith("report.cls")) && external.some((n) => n.endsWith("main.toc")), `multi/${engine}: the class and the generated .toc stay outside the project`);
  }
  {
    const { ix } = load("multi", "pdftex");
    const other = synctex.mapInputsToProject(ix, ["main.tex", "report.cls", "intro.tex"], "main.tex");
    check(![...other.pathOfTag.values()].includes("report.cls"), "a project file named like a system file is not confused with it");
    check(![...other.pathOfTag.values()].includes("intro.tex"), "a file is matched by its whole path, not its base name");
    check(synctex.normalizeTexPath("/tmp/job/./a/../b/./c.tex") === "/tmp/job/b/c.tex", "paths are normalized");
  }

  console.log("Round trips: source line → highlight → the same source line");
  for (const engine of PLAN.basic) {
    const { ix, map, files } = load("basic", engine);
    const label = `basic/${engine}`;
    const cases = [
      ["This sentence sits on one source line", "paragraph, first line"],
      ["A second line of the same paragraph", "paragraph, second line"],
      ["and a third one closes it", "paragraph, third line"],
      ["One very long source line", "long line over several PDF lines"],
      ["Inline math such as", "inline math"],
      ["\\int_0^1", "display equation"],
      ["\\end{align}", "align (typeset at its \\end line)"],
      ["\\item Second item", "list item"],
      ["Widget & 12", "table row"],
      ["Sprocket & 30", "last table row"],
      ["\\caption{A small table", "table caption"],
      ["Text with a footnote", "footnote call and text"],
      ["\\marginpar{Margin note}", "margin note"],
      ["A margin note hangs", "line beside a margin note"],
      ["\\caption{A black rectangle", "figure caption"],
      ["\\rule{4cm}{2cm}", "rule standing in for a picture"],
      ["\\includegraphics", "included image"],
      ["\\product{Quasar}", "text from a macro"],
      ["\\section{Introduction}", "section heading"],
      ["\\subsection{A subsection}", "subsection heading"],
      ["The second page starts", "second page"],
      ["Closing words", "last line"],
      ["\\maketitle", "title block"],
    ];
    for (const [text, what] of cases) roundTrip(ix, map, files, "main.tex", text, `${label} ${what}`);

    const first = synctex.forwardSearch(ix, map.tagsOfPath.get("main.tex"), lineOf(files, "main.tex", "Plain paragraphs come first"));
    const later = synctex.forwardSearch(ix, map.tagsOfPath.get("main.tex"), lineOf(files, "main.tex", "The second page starts"));
    check(first?.page === 1 && later !== null && later.page === ix.pageCount, `${label}: lines are found on their own pages (${first?.page}, ${later?.page} of ${ix.pageCount})`);

    // align reads its whole body before typesetting it, so every row carries the \end{align} line: a body line is answered by that line, with one highlight per row.
    const tagsOfMain = map.tagsOfPath.get("main.tex");
    const row = synctex.forwardSearch(ix, tagsOfMain, lineOf(files, "main.tex", "d &= e + f + g"));
    check(row !== null && !row.exact && row.line === lineOf(files, "main.tex", "\\end{align}") && row.rects.length === 3, `${label}: a line inside align goes to the align, one highlight per row (line ${row?.line}, ${row?.rects.length} highlights)`);
    if (row) {
      // And back: SyncTeX says \end{align}, the clicked symbols say which row.
      const texts = { compiled: (p) => files[p], current: (p) => files[p] };
      const second = row.rects[1];
      const jump = synctex.resolveSourceJump(ix, map, texts, second.page, second.x + second.width / 2, second.y + second.height / 2, { word: "e", before: ["d"], after: ["f", "g"] });
      check(jump !== null && jump.line === lineOf(files, "main.tex", "d &= e + f + g") && jump.column === files["main.tex"].split("\n")[jump.line - 1].indexOf("e +"), `${label}: a click on the second align row lands on its source line and symbol (line ${jump?.line}, column ${jump?.column})`);
      const none = synctex.resolveSourceJump(ix, map, texts, second.page, second.x + second.width / 2, second.y + second.height / 2, null);
      check(none !== null && none.line === lineOf(files, "main.tex", "\\end{align}"), `${label}: without a word, the same click lands on \\end{align}`);
    }

    // A long source line gives one highlight per PDF line, top to bottom, each no wider than the text block.
    const long = synctex.forwardSearch(ix, map.tagsOfPath.get("main.tex"), lineOf(files, "main.tex", "One very long source line"));
    check(long !== null && long.rects.length >= 4, `${label}: a long source line highlights each PDF line it fills (${long?.rects.length})`);
    if (long) {
      check(long.rects.every((r, i) => i === 0 || r.y > long.rects[i - 1].y), `${label}: those highlights run down the page`);
      const end = synctex.forwardSearch(ix, map.tagsOfPath.get("main.tex"), lineOf(files, "main.tex", "One very long source line"), { fraction: 1 });
      check(end !== null && end.primary === end.rects.length - 1, `${label}: a cursor at the end of the long line brings its last PDF line into view`);
    }

    // Two source lines sharing a PDF line get different, narrower highlights.
    const a = synctex.forwardSearch(ix, map.tagsOfPath.get("main.tex"), lineOf(files, "main.tex", "This sentence sits on one source line"));
    const b = synctex.forwardSearch(ix, map.tagsOfPath.get("main.tex"), lineOf(files, "main.tex", "A second line of the same paragraph"));
    if (a && b) {
      const textWidth = 345;
      check(a.rects[0].width < textWidth && b.rects.some((r) => r.width < textWidth - 20), `${label}: a source line that fills part of a PDF line is highlighted in part`);
      check(b.rects[0].x > a.rects[0].x + 20, `${label}: the second source line's highlight starts where the first one's text ends`);
    }

    // Lines with no output of their own go to the next line that has some.
    const tags = map.tagsOfPath.get("main.tex");
    const comment = synctex.forwardSearch(ix, tags, lineOf(files, "main.tex", "% A comment between paragraphs"));
    check(comment !== null && !comment.exact && comment.line === lineOf(files, "main.tex", "One very long source line"), `${label}: a comment line goes to the paragraph after it (line ${comment?.line})`);
    const blank = synctex.forwardSearch(ix, tags, lineOf(files, "main.tex", "and a third one closes it") + 1);
    check(blank !== null && blank.line > lineOf(files, "main.tex", "and a third one closes it"), `${label}: a blank line goes forward, not back`);
    const preamble = synctex.forwardSearch(ix, tags, 2);
    check(preamble !== null && !preamble.exact && preamble.page === 1 && preamble.line >= lineOf(files, "main.tex", "\\begin{document}"), `${label}: a preamble line goes to the first output (line ${preamble?.line})`);
    const trailing = synctex.forwardSearch(ix, tags, lineOf(files, "main.tex", "% Trailing comment"));
    check(trailing !== null && trailing.page === ix.pageCount, `${label}: a line after \\end{document} goes to the last output`);

    // A click in the table of contents is in main.toc, which is not a project file: it lands on \tableofcontents.
    const toc = findToc(ix, map);
    if (toc) {
      const hit = synctex.inverseSearch(ix, toc.page, toc.x, toc.y, (tag) => map.pathOfTag.has(tag));
      check(hit !== null && hit.rerouted && hit.line === lineOf(files, "main.tex", "\\tableofcontents"), `${label}: a table of contents entry lands on \\tableofcontents (got line ${hit?.line})`);
    } else check(false, `${label}: no table of contents record found`);

    // Margins and gaps answer with the nearest text, never nothing and never a package file.
    for (const [x, y, where] of [[5, 5, "top-left corner"], [600, 780, "bottom-right corner"], [300, 20, "top margin"], [20, 400, "left margin"]]) {
      const hit = synctex.inverseSearch(ix, 1, x, y, (tag) => map.pathOfTag.has(tag));
      check(hit !== null && map.pathOfTag.get(hit.tag) === "main.tex" && hit.line > 0, `${label}: a click in the ${where} still finds a line of main.tex`);
    }
    check(synctex.inverseSearch(ix, 99, 100, 100) === null, `${label}: a page that does not exist gives nothing`);
  }

  console.log("Several files");
  for (const engine of PLAN.multi) {
    const { ix, map, files } = load("multi", engine);
    const label = `multi/${engine}`;
    roundTrip(ix, map, files, "main.tex", "Text in the main file before any input", `${label} main file`);
    roundTrip(ix, map, files, "chapters/intro.tex", "The introduction lives in a subfolder", `${label} \\input from a subfolder`);
    roundTrip(ix, map, files, "chapters/intro.tex", "which spans two source lines", `${label} second paragraph of the input`);
    roundTrip(ix, map, files, "chapters/methods.tex", "Methods are included", `${label} \\include`);
    roundTrip(ix, map, files, "chapters/methods.tex", "\\end{equation}", `${label} equation in an included file`);
    roundTrip(ix, map, files, "sub/part.tex", "This text comes from a subfile", `${label} \\subfile`);
    roundTrip(ix, map, files, "shared.tex", "It has a second line with the word walrus", `${label} file read twice`);

    // The shared file appears in two chapters: the page on screen decides which copy is shown.
    const tags = map.tagsOfPath.get("shared.tex");
    const line = lineOf(files, "shared.tex", "This shared paragraph");
    const first = synctex.forwardSearch(ix, tags, line);
    const last = synctex.forwardSearch(ix, tags, line, { pageHint: ix.pageCount });
    check(first !== null && last !== null && last.page > first.page, `${label}: a file read twice is shown where the reader is (pages ${first?.page} and ${last?.page})`);
    if (last) {
      const back = synctex.inverseSearch(ix, last.page, last.rects[0].x + last.rects[0].width / 2, last.rects[0].y + last.rects[0].height / 2, (tag) => map.pathOfTag.has(tag));
      check(back !== null && map.pathOfTag.get(back.tag) === "shared.tex", `${label}: the second copy maps back to shared.tex`);
    }
  }

  console.log("Two columns, a margin note, and a rotated page");
  for (const engine of PLAN.twocol) {
    const { ix, map, files } = load("twocol", engine);
    const label = `twocol/${engine}`;
    const left = roundTrip(ix, map, files, "main.tex", "The first column starts", `${label} left column`);
    const right = roundTrip(ix, map, files, "main.tex", "Text that should land in the second column", `${label} right column`);
    if (left && right) check(right.rects[0].x > left.rects[0].x + 150 || right.page > left.page, `${label}: the right column's highlight is in the right column`);
    roundTrip(ix, map, files, "main.tex", "\\marginpar{Side remark}", `${label} margin note beside a column`);
    roundTrip(ix, map, files, "main.tex", "This page is rotated", `${label} landscape page`);
    roundTrip(ix, map, files, "main.tex", "Lower left & Lower right", `${label} table on the landscape page`);
    roundTrip(ix, map, files, "main.tex", "Back to portrait", `${label} after the landscape page`);

    // The landscape page is a portrait page shown turned a quarter, with its body turned the other way by a PDF transformation SyncTeX never sees. Told the page's rotation, highlights follow the turned text and clicks on it are turned back.
    const geometry = { view: [0, 0, 612, 792], rotation: 90 };
    const tags = map.tagsOfPath.get("main.tex");
    const line = lineOf(files, "main.tex", "This page is rotated");
    const upright = synctex.forwardSearch(ix, tags, line);
    const turned = synctex.forwardSearch(ix, tags, line, { pageGeometry: (page) => (page === 2 ? geometry : undefined) });
    check(upright !== null && turned !== null && upright.rects[0].x + upright.rects[0].width > 612 && turned.rects[0].x + turned.rects[0].width < 612 && turned.rects[0].height > 5 * turned.rects[0].width, `${label}: on the landscape page the highlight is turned onto the page (${turned ? `${turned.rects[0].width.toFixed(0)}×${turned.rects[0].height.toFixed(0)} at ${turned.rects[0].x.toFixed(0)},${turned.rects[0].y.toFixed(0)}` : "none"})`);
    if (turned) {
      const r = turned.rects[0];
      const shown = synctex.pageRectToShown(r, geometry);
      check(shown.width * 792 > 5 * shown.height * 612 && shown.left >= 0 && shown.top >= 0 && shown.left + shown.width <= 1 && shown.top + shown.height <= 1, `${label}: shown turned, that highlight lies along the line of text`);
      // The section heading sits above this line in reading order, which on the turned page means further left.
      const heading = synctex.forwardSearch(ix, tags, lineOf(files, "main.tex", "\\section{Landscape page}"), { pageGeometry: () => geometry });
      check(heading !== null && synctex.pageRectToShown(heading.rects[0], geometry).top < shown.top, `${label}: the heading of the landscape page is shown above its first line`);
      const back = synctex.inverseSearch(ix, r.page, r.x + r.width / 2, r.y + r.height / 2, (tag) => map.pathOfTag.has(tag), geometry);
      check(back !== null && back.candidates.some((c) => c.line === line), `${label}: a click on the turned text maps back to its line (got ${back?.line})`);
      const cell = synctex.forwardSearch(ix, tags, lineOf(files, "main.tex", "Lower left & Lower right"), { pageGeometry: () => geometry });
      const cellBack = cell ? synctex.inverseSearch(ix, 2, cell.rects[0].x + cell.rects[0].width / 2, cell.rects[0].y + cell.rects[0].height / 2, (tag) => map.pathOfTag.has(tag), geometry) : null;
      check(cellBack !== null && cellBack.candidates.some((c) => c.line === lineOf(files, "main.tex", "Lower left & Lower right")), `${label}: a table row on the turned page round-trips too`);
    }
  }

  console.log("PDF forms");
  {
    // What pdfTeX really writes: the form's content is unreachable, so its line goes to the next line with output, where the form is first placed.
    const { ix, map, files } = load("forms", "pdftex");
    roundTrip(ix, map, files, "main.tex", "Plain text before the form", "forms/pdftex text before a form");
    const built = lineOf(files, "main.tex", "Text inside a reusable form");
    const hit = synctex.forwardSearch(ix, map.tagsOfPath.get("main.tex"), built);
    check(hit !== null && !hit.exact && hit.line === lineOf(files, "main.tex", "First use:"), `forms/pdftex: the line that builds a form goes to where the form is first placed (line ${hit?.line})`);
    check(hit !== null && hit.rects.every((r) => r.x > 72 && r.y > 72), "forms/pdftex: stray form records never put a highlight in the page corner");
  }
  {
    // A form written the way the format describes: both placements are found, and a click on either maps to the line that built it.
    const wrapped = synctex.parseSyncTexBytes(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, "forms", "wrapped.synctex.gz")))));
    const { files } = load("forms", "pdftex");
    const map = synctex.mapInputsToProject(wrapped, Object.keys(files), "main.tex");
    const built = lineOf(files, "main.tex", "Text inside a reusable form");
    const hit = synctex.forwardSearch(wrapped, map.tagsOfPath.get("main.tex"), built);
    check(hit !== null && hit.exact && hit.rects.length === 2, `forms/wrapped: a form placed twice is highlighted in both places (${hit?.rects.length})`);
    for (const rect of hit?.rects ?? []) {
      const back = synctex.inverseSearch(wrapped, rect.page, rect.x + rect.width / 2, rect.y + rect.height / 2, (tag) => map.pathOfTag.has(tag));
      check(back !== null && back.candidates.some((c) => c.line === built), `forms/wrapped: a click on a placed form maps to the line that built it (got ${back?.line})`);
    }
  }

  console.log("Words and columns");
  {
    const line = "One very long source line holds alpha beta gamma delta alpha epsilon zeta, and then again alpha beta gamma.";
    const third = synctex.findWordInLines([line], { word: "alpha", before: ["again", "then"], after: ["beta", "gamma"] });
    check(third !== null && third.column === line.lastIndexOf("alpha"), "a word that occurs three times is told apart by its neighbors");
    const second = synctex.findWordInLines([line], { word: "alpha", before: ["delta", "gamma"], after: ["epsilon"] });
    check(second !== null && second.column === line.indexOf("alpha epsilon"), "the middle occurrence is found by its neighbors too");
    const first = synctex.findWordInLines([line], { word: "alpha", before: ["holds"], after: ["beta"] });
    check(first !== null && first.column === line.indexOf("alpha"), "and the first one");
    const noContext = synctex.findWordInLines([line], { word: "alpha", before: [], after: [] }, 0.95);
    check(noContext !== null && noContext.column === line.lastIndexOf("alpha"), "without neighbors, the place along the line decides");
    const marked = synctex.findWordInLines(["Some \\textbf{bold} words and \\emph{more} words here"], { word: "words", before: ["more", "and"], after: ["here"] });
    check(marked !== null && marked.column === "Some \\textbf{bold} words and \\emph{more} ".length, "markup between words does not hide the neighbors");
    const ligature = synctex.findWordInLines(["the first office file"], { word: "oﬃce", before: ["ﬁrst"], after: ["ﬁle"] });
    check(ligature !== null && ligature.column === 10 && ligature.length === 6, "ligatures in the PDF text match plain letters in the source");
    const hyphenated = synctex.findWordInLines(["a hyphenated documentation word"], { word: "documen", before: ["hyphenated"], after: [] });
    check(hyphenated !== null && hyphenated.column === 13 && hyphenated.length === 7, "the first half of a word hyphenated in the PDF is found");
    const twoLines = synctex.findWordInLines(["zebra on the first line", "and a zebra on the second"], { word: "zebra", before: ["a", "and"], after: ["on"] });
    check(twoLines !== null && twoLines.index === 1 && twoLines.column === 6, "with two candidate lines, the one whose neighbors fit wins");
    check(synctex.findWordInLines(["nothing to see"], { word: "absent", before: [], after: [] }) === null, "a word that is not on SyncTeX's lines is not invented");
    const clicked = synctex.clickedWordAt("The quick brown fox jumps", 11);
    check(clicked !== null && clicked.word === "brown" && clicked.before[0] === "quick" && clicked.after[0] === "fox", "the clicked word and its neighbors are read off a PDF line");
    const fromSource = synctex.sourceWordAt("Some \\textbf{bold} words", 14);
    check(fromSource !== null && fromSource.word === "bold", "the word under the editor's cursor is read off a source line");
  }
  for (const engine of PLAN.basic) {
    // The real thing: SyncTeX names the line, the clicked word names the column, for each of the four alphas on the long line.
    const { ix, map, files } = load("basic", engine);
    const text = files["main.tex"].split("\n");
    const line = lineOf(files, "main.tex", "One very long source line");
    const hit = synctex.forwardSearch(ix, map.tagsOfPath.get("main.tex"), line);
    if (!hit) continue;
    const top = hit.rects[0];
    const back = synctex.inverseSearch(ix, top.page, top.x + 30, top.y + top.height / 2, (tag) => map.pathOfTag.has(tag));
    const lines = back ? back.candidates.map((c) => text[c.line - 1] ?? "") : [];
    const found = synctex.findWordInLines(lines, { word: "very", before: ["One"], after: ["long", "source"] }, back?.fraction);
    check(back !== null && found !== null && back.candidates[found.index].line === line && found.column === 4, `basic/${engine}: line from SyncTeX, column from the clicked word`);
  }

  console.log("Edited sources");
  {
    const compiled = ["a", "b", "c", "d", "e", "f"].join("\n");
    check(!synctex.createLineMap(compiled, compiled).changed, "identical texts need no map");
    const inserted = synctex.createLineMap(compiled, ["a", "NEW 1", "NEW 2", "b", "c", "d", "e", "f"].join("\n"));
    check(inserted.toCurrent(1).line === 1 && inserted.toCurrent(2).line === 4 && inserted.toCurrent(6).line === 8 && inserted.toCurrent(4).exact, "lines after an insertion shift down");
    check(inserted.toCompiled(4).line === 2 && inserted.toCompiled(8).line === 6, "and map back up");
    check(!inserted.toCompiled(2).exact && inserted.toCompiled(2).line === 2, "a line typed after the compile maps to where it was inserted, flagged as inexact");
    const removed = synctex.createLineMap(compiled, ["a", "d", "e", "f"].join("\n"));
    check(removed.toCurrent(4).line === 2 && removed.toCurrent(4).exact, "lines after a deletion shift up");
    check(!removed.toCurrent(2).exact && removed.toCurrent(2).line === 2, "a deleted line maps to what took its place, flagged as inexact");
    const edited = synctex.createLineMap(compiled, ["a", "b", "C changed", "d", "e", "f"].join("\n"));
    check(edited.toCurrent(3).line === 3 && !edited.toCurrent(3).exact && edited.toCurrent(4).exact, "an edited line keeps its place and is flagged");
    // The compile service adds lines to the main file's preamble: the map absorbs them like any other difference.
    const source = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}";
    const withInjection = "\\documentclass{article}\n\\usepackage{amsmath}\n% injected\n\\providecommand{\\R}{\\mathbb{R}}\n\\begin{document}\nHello\n\\end{document}";
    const injected = synctex.createLineMap(withInjection, source);
    check(injected.toCurrent(6).line === 3 && injected.toCurrent(6).exact && injected.toCompiled(3).line === 6, "lines injected into the compiled preamble are accounted for");
    const big = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
    const bigEdited = big.slice();
    bigEdited.splice(10000, 0, "inserted");
    const t0 = performance.now();
    const bigMap = synctex.createLineMap(big.join("\n"), bigEdited.join("\n"));
    check(bigMap.toCurrent(15000).line === 15001 && performance.now() - t0 < 200, `a 20,000-line file maps in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  console.log("Edited sources, end to end");
  for (const engine of PLAN.basic) {
    const { ix, map, files } = load("basic", engine);
    const label = `basic/${engine}`;
    const compiled = files["main.tex"];
    const target = lineOf(files, "main.tex", "A second line of the same paragraph");
    const hit = synctex.forwardSearch(ix, map.tagsOfPath.get("main.tex"), target);
    if (!hit) continue;
    const rect = hit.rects[hit.rects.length - 1];
    const click = [rect.page, rect.x + rect.width / 2, rect.y + rect.height / 2];
    const word = { word: "paragraph", before: ["same", "the"], after: ["follows", "here"] };

    // Twelve lines typed near the top after the compile: the same click lands twelve lines lower, on the same word.
    const lines = compiled.split("\n");
    const shifted = [...lines.slice(0, 12), ...Array.from({ length: 12 }, (_, i) => `% added after the compile ${i}`), ...lines.slice(12)].join("\n");
    const moved = synctex.resolveSourceJump(ix, map, { compiled: () => compiled, current: () => shifted }, ...click, word);
    check(moved !== null && moved.exact && moved.line === target + 12 && shifted.split("\n")[moved.line - 1].slice(moved.column, moved.column + moved.length) === "paragraph", `${label}: lines typed above the target after the compile shift the jump with them (line ${moved?.line})`);

    // The target line itself reworded: the jump still finds the word, and says the place was edited.
    const reworded = lines.slice();
    reworded[target - 1] = "Now a rewritten line of that paragraph is here,";
    const edited = synctex.resolveSourceJump(ix, map, { compiled: () => compiled, current: () => reworded.join("\n") }, ...click, word);
    check(edited !== null && !edited.exact && edited.line === target && reworded[target - 1].slice(edited.column, edited.column + edited.length) === "paragraph", `${label}: a jump into an edited line finds the word again and is flagged`);

    // The target line deleted: the jump goes to what took its place, flagged, never far away.
    const deleted = [...lines.slice(0, target - 1), ...lines.slice(target)].join("\n");
    const gone = synctex.resolveSourceJump(ix, map, { compiled: () => compiled, current: () => deleted }, ...click, word);
    check(gone !== null && !gone.exact && Math.abs(gone.line - target) <= 1, `${label}: a jump to a deleted line lands next to where it was, flagged (line ${gone?.line})`);

    // Without the compiled text there is nothing to compare against, but the word still pins the place when the drift is small.
    const blind = synctex.resolveSourceJump(ix, map, { compiled: () => undefined, current: () => compiled }, ...click, word);
    check(blind !== null && blind.line === target, `${label}: with no compiled text on hand the jump still lands on the line`);

    // The other way: the cursor on the shifted line still highlights the same place, and a freshly typed line is flagged.
    const forward = synctex.resolvePdfJump(ix, map, { compiled: () => compiled, current: () => shifted }, "main.tex", target + 12, 5);
    check(forward !== null && forward.current && forward.line === target && forward.rects.length === hit.rects.length && near(forward.rects[0].x, hit.rects[0].x), `${label}: the cursor on a shifted line highlights where that line was compiled`);
    const fresh = synctex.resolvePdfJump(ix, map, { compiled: () => compiled, current: () => shifted }, "main.tex", 15, 0);
    check(fresh !== null && !fresh.current, `${label}: the cursor on a line typed after the compile is flagged as not compiled yet`);
    check(synctex.resolvePdfJump(ix, map, { compiled: () => compiled, current: () => compiled }, "nope.tex", 1, 0) === null, `${label}: a file TeX never read has no place in the PDF`);
  }
  {
    const lines = ["\\begin{figure}", "  \\caption{A caption that", "    runs over three", "    source lines}", "\\end{figure}"];
    check(synctex.linesReadTogether(lines, 4).join() === "2,3", "an argument closed on a later line brings in the lines it started on");
    check(synctex.linesReadTogether(lines, 5).join() === "1,2,3,4", "an \\end line brings in its environment");
    check(synctex.linesReadTogether(["plain {text} here", "more plain text"], 2).length === 0, "a plain line brings in nothing");
    const nested = ["\\begin{align}", "\\begin{aligned}", "x", "\\end{aligned}", "\\end{align}"];
    check(synctex.linesReadTogether(nested, 4).join() === "2,3" && synctex.linesReadTogether(nested, 5).join() === "1,2,3,4", "nested environments pair up");
  }

  console.log("Page geometry");
  {
    const portrait = { view: [0, 0, 612, 792], rotation: 0 };
    const p = synctex.shownToPage(0.25, 0.5, portrait);
    check(near(p.x, 153) && near(p.y, 396), "an upright page maps straight through");
    for (const rotation of [0, 90, 180, 270]) {
      const page = { view: [0, 0, 612, 792], rotation };
      const rect = { x: 100, y: 200, width: 50, height: 12 };
      const shown = synctex.pageRectToShown(rect, page);
      check(shown.width > 0 && shown.height > 0 && shown.left >= 0 && shown.top >= 0 && shown.left + shown.width <= 1 && shown.top + shown.height <= 1, `a rectangle stays on the page at ${rotation}°`);
      const corner = synctex.shownToPage(shown.left + shown.width / 2, shown.top + shown.height / 2, page);
      check(near(corner.x, 125) && near(corner.y, 206), `a click in the middle of a shown rectangle maps back to its middle at ${rotation}°`);
    }
    // A page turned 90° clockwise: TeX's top-left corner is shown at the top-right.
    const turned = synctex.shownToPage(1, 0, { view: [0, 0, 612, 792], rotation: 90 });
    check(near(turned.x, 0) && near(turned.y, 0), "the top-right of a page turned 90° is TeX's top-left");
  }

  if (args.has("--bench")) await bench();

  console.log("");
  console.log("Summary");
  for (const t of totals) console.log(`  ${t.name}/${t.engine}: edit ${t.editSame}/${t.editTotal}, view ${t.viewSameSet}/${t.viewTotal} (${t.viewSame} in identical order)`);
  console.log(`${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
}

/** A point on a record of the generated .toc, if the document has one. */
function findToc(ix, map) {
  const toc = ix.inputs.find((i) => i.name.endsWith(".toc"));
  if (!toc || map.pathOfTag.has(toc.tag)) return null;
  for (let n = 0; n < ix.count; n++) {
    // A kern or glue of the .toc, inside a line of an entry.
    if (ix.tag[n] !== toc.tag || (ix.type[n] !== 5 && ix.type[n] !== 6)) continue;
    const box = ix.parent[n];
    if (box < 0 || ix.type[box] !== 2) continue;
    const page = synctex.pageOf(ix, n);
    if (page < 1) continue;
    return { page, x: ix.h[n] * ix.unit + ix.xOffset, y: (ix.v[n] - 100000) * ix.unit + ix.yOffset };
  }
  return null;
}

async function bench() {
  console.log("A book-length document");
  const workRoot = process.env.SYNCTEX_FIXTURE_WORKDIR || fs.mkdtempSync(path.join(os.tmpdir(), "synctex-fixtures-"));
  const job = path.join(workRoot, "bench");
  fs.rmSync(job, { recursive: true, force: true });
  fs.mkdirSync(job, { recursive: true });
  const body = [];
  for (let i = 0; i < 1500; i++) body.push(`\\section{Section ${i}}`, "\\lipsum[1-4]", `Marker line ${i} with $x_${i % 9} = ${i}$ inline.`, "");
  fs.writeFileSync(path.join(job, "main.tex"), `\\documentclass{book}\n\\usepackage{lipsum}\n\\begin{document}\n${body.join("\n")}\n\\end{document}\n`);
  execFileSync("pdflatex", ["-interaction=nonstopmode", "-synctex=1", `-output-directory=${job}`, "main.tex"], { cwd: job, stdio: "ignore", timeout: 600000 });
  const gz = fs.readFileSync(path.join(job, "main.synctex.gz"));
  const raw = zlib.gunzipSync(gz);
  let t = performance.now();
  const ix = synctex.parseSyncTexBytes(new Uint8Array(raw));
  const parseMs = performance.now() - t;
  console.log(`  ${ix.pageCount} pages, ${(gz.length / 1e6).toFixed(1)} MB gzipped, ${(raw.length / 1e6).toFixed(1)} MB of text, ${ix.count} records`);
  console.log(`  one-shot parse: ${parseMs.toFixed(0)} ms`);

  // The browser path: the longest stretch the main thread is held is what typing would feel.
  let longest = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const nowAt = performance.now();
    longest = Math.max(longest, nowAt - last);
    last = nowAt;
  }, 0);
  t = performance.now();
  last = t;
  const streamed = await synctex.parseSyncTexGzip(new Uint8Array(gz));
  clearInterval(timer);
  console.log(`  streamed parse: ${(performance.now() - t).toFixed(0)} ms in all, longest stretch without yielding ${longest.toFixed(0)} ms`);
  check(streamed !== null && streamed.count === ix.count, "the streamed parse of the long document is complete");
  check(longest < 50, `the main thread is never held for more than 50 ms (${longest.toFixed(0)} ms)`);

  const tag = ix.inputs[0].tag;
  const random = rng(42);
  t = performance.now();
  let found = 0;
  for (let i = 0; i < 1000; i++) if (synctex.inverseSearch(ix, 1 + Math.floor(random() * ix.pageCount), 100 + random() * 400, 100 + random() * 600)) found++;
  const inverseMs = (performance.now() - t) / 1000;
  t = performance.now();
  synctex.forwardSearch(ix, [tag], 100);
  const firstForward = performance.now() - t;
  t = performance.now();
  for (let i = 0; i < 1000; i++) if (synctex.forwardSearch(ix, [tag], 4 + Math.floor(random() * 5990))) found++;
  const forwardMs = (performance.now() - t) / 1000;
  console.log(`  PDF → source: ${inverseMs.toFixed(3)} ms a lookup; source → PDF: ${forwardMs.toFixed(3)} ms a lookup (the first one builds the line table: ${firstForward.toFixed(0)} ms)`);
  check(inverseMs < 30 && forwardMs < 30 && firstForward < 300, "lookups stay within a few tens of milliseconds");
  check(found > 1900, "lookups in the long document find something");
  const marker = 4 + 4 * 700 + 2;
  const hit = synctex.forwardSearch(ix, [tag], marker);
  const back = hit ? synctex.inverseSearch(ix, hit.page, hit.rects[0].x + hit.rects[0].width / 2, hit.rects[0].y + hit.rects[0].height / 2) : null;
  check(hit !== null && back !== null && back.candidates.some((c) => c.line === marker), `a line deep in the long document round-trips (page ${hit?.page})`);
}

if (args.has("--regen")) {
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  regenerate(only);
}
await run();

#!/usr/bin/env node
"use strict";

/**
 * Eneles PPT: local compile server.
 *
 * Runs on YOUR machine, on localhost only. Compiles LaTeX with whatever
 * pdflatex/xelatex/lualatex is already on your PATH (TeX Live, MiKTeX,
 * whatever) and converts the result to a tightly-cropped SVG with dvisvgm
 * (falling back to pdftocairo, see convertPdfToSvg). Nothing is uploaded
 * anywhere.
 *
 * Start it with `npm start` (or double-click start.bat / start.sh), then
 * point the PowerPoint add-in's Settings panel at http://127.0.0.1:<port>.
 *
 * NOTE: if you just want this to work with zero manual steps at all (no
 * pasted token, no separate process to start), use ../app/ instead. It is
 * this exact same compile logic merged with the task pane's own HTTPS
 * host in one process, meant to be packaged into a single .exe. This
 * standalone version is kept for people who prefer running the dev
 * webpack server (`npm run dev-server` in powerpoint/) instead.
 */

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { execFile, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Config ──────────────────────────────────────────────────────────
const PORT = parseInt(process.env.TEXER_PPT_PORT || "47822", 10);
const HOST = "127.0.0.1"; // loopback only, never bind 0.0.0.0
const MAX_CONCURRENT = 2;
const JOB_TIMEOUT_MS = 45000;
const MAX_SOURCE_BYTES = 200 * 1024; // 200KB, enough for single equations and diagrams
const STATE_DIR = path.join(os.homedir(), ".texer-ppt");
const TOKEN_FILE = path.join(STATE_DIR, "token");
const RENDERS_DIR = path.join(STATE_DIR, "renders");

const defaultOrigins = [
  "https://localhost:47821", // add-in dev server (webpack serve)
  "https://ppt.eneles.example", // add-in prod hosting; change if you host elsewhere
];
const ALLOWED_ORIGINS = (process.env.TEXER_PPT_ALLOWED_ORIGINS || defaultOrigins.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ── Auth token ──────────────────────────────────────────────────────
// A random per-install token, persisted to disk so it survives restarts.
// This exists because the server listens on a plain HTTP port with no TLS,
// and ANY page open in the user's browser can attempt to fetch localhost
// ports. The token, plus the Origin allowlist below, is what stops some
// unrelated website from silently using your LaTeX installation.
function getOrCreateToken() {
  if (process.env.TEXER_PPT_TOKEN) return process.env.TEXER_PPT_TOKEN;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    if (fs.existsSync(TOKEN_FILE)) {
      const existing = fs.readFileSync(TOKEN_FILE, "utf-8").trim();
      if (existing) return existing;
    }
    const fresh = crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(TOKEN_FILE, fresh, { mode: 0o600 });
    return fresh;
  } catch (e) {
    // Filesystem write failed (permissions, read-only home, etc). Fall back
    // to an in-memory token. Still safe, it just won't survive a restart.
    console.warn(`[texer-ppt] Could not persist token to ${TOKEN_FILE}: ${e.message}`);
    return crypto.randomBytes(24).toString("hex");
  }
}
const AUTH_TOKEN = getOrCreateToken();

// ── Job queue (simple concurrency cap; this is a personal machine, not
// a shared server; we just don't want a double-click to fork 8 pdflatex
// processes and choke the fan) ───────────────────────────────────────
const queue = [];
let active = 0;
function runQueue() {
  if (active >= MAX_CONCURRENT || queue.length === 0) return;
  active++;
  const { fn, resolve, reject } = queue.shift();
  fn()
    .then(resolve, reject)
    .finally(() => {
      active--;
      setImmediate(runQueue);
    });
}
function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    runQueue();
  });
}

// ── Dangerous command filter (defense in depth; we always pass
// -no-shell-escape too, but a pasted snippet from a random forum post
// shouldn't get a free pass at trying) ───────────────────────────────
function containsDangerousCommands(content) {
  const patterns = [
    /\\write18/,
    /\\immediate\s*\\write18/,
    /\\input\s*\{\s*\|/,
    /\\openin\s*[^=]*=\s*"?\s*\|/,
    /\\directlua/,
    /\\latelua/,
    /\\csname\s+write\\endcsname/,
  ];
  return patterns.some((p) => p.test(content));
}

// ── Wrap a bare snippet in a standalone document ─────────────────────
// If `source` already declares \documentclass it's used verbatim (full
// escape hatch). Otherwise it's wrapped in standalone+preview cropping,
// which works for math, tikzpicture, circuitikz, chemfig, forest, etc.
// alike. Any \usepackage / \usetikzlibrary / ...set line already present
// in the snippet is hoisted into the preamble automatically. Common macro
// and theorem declarations are hoisted as well, including multi-line ones,
// so authors can paste a self-contained TikZ or theorem-box setup instead
// of manually moving definitions to Settings.
function buildStandaloneLatex(source, opts) {
  const extraPreamble = (opts && opts.preamble) || "";
  const border = (opts && opts.border) || "2pt";
  const trimmed = (source || "").trim();

  if (/\\documentclass/.test(trimmed)) {
    return trimmed;
  }

  const preamble = [`\\documentclass[preview,border=${border}]{standalone}`];

  // Compares whole names from the comma list. A word-boundary regex treated
  // \usepackage{tikz-3dplot} as loading "tikz", so tikz was never added and
  // tikz-3dplot (which doesn't load it) failed to compile.
  const hasPackage = (name) =>
    [trimmed, extraPreamble].some((text) =>
      [...text.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)].some((m) =>
        m[1].split(",").map((p) => p.trim()).includes(name),
      ),
    );

  if (!hasPackage("tikz")) preamble.push("\\usepackage{tikz}");
  if (!hasPackage("xcolor")) preamble.push("\\usepackage{xcolor}");
  if (!hasPackage("amsmath")) preamble.push("\\usepackage{amsmath}");
  if (!hasPackage("amssymb")) preamble.push("\\usepackage{amssymb}");

  const preambleLineRegex =
    /^\\(usepackage|usetikzlibrary|pgfplotsset|tdplotsetmaincoords|tikzset|ctikzset|newcommand|renewcommand|providecommand|DeclareMathOperator|newtheorem|theoremstyle|newlength|setlength|definecolor|colorlet|newtcbox|newtcolorbox|tcbset|newenvironment|renewenvironment|title|author|date|hypersetup|geometry)\b/;
  const braceDelta = (line) => {
    let delta = 0;
    for (let index = 0; index < line.length; index++) {
      if (line[index] === "\\") {
        index++;
        continue;
      }
      if (line[index] === "{") delta++;
      if (line[index] === "}") delta--;
    }
    return delta;
  };
  const body = [];
  let collectingPreamble = false;
  let openBraces = 0;
  for (const rawLine of trimmed.split("\n")) {
    const line = rawLine.trim();
    if (collectingPreamble) {
      preamble.push(rawLine);
      openBraces += braceDelta(rawLine);
      if (openBraces <= 0) collectingPreamble = false;
    } else if (preambleLineRegex.test(line)) {
      preamble.push(rawLine);
      openBraces = braceDelta(rawLine);
      collectingPreamble = openBraces > 0;
    } else {
      body.push(rawLine);
    }
  }

  for (const rawLine of extraPreamble.split("\n")) {
    const line = rawLine.trim();
    if (line) preamble.push(line);
  }

  return `${preamble.join("\n")}\n\n\\begin{document}\n${body.join("\n")}\n\\end{document}`;
}

// ── Detect what's actually installed, fresh every call. It is cheap,
// and it means installing a new engine mid-session just works next
// render without restarting this server ──────────────────────────────
function which(cmd) {
  const finder = os.platform() === "win32" ? "where" : "which";
  try {
    execFileSync(finder, [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function detectEnvironment() {
  const engines = ["pdflatex", "xelatex", "lualatex"].filter(which);
  const hasDvisvgm = which("dvisvgm");
  const hasPdftocairo = which("pdftocairo");
  // Reported for the health pill and error messages: the "preferred" tool,
  // not necessarily the only one that will be tried (see convertPdfToSvg).
  const svgTool = hasDvisvgm ? "dvisvgm" : hasPdftocairo ? "pdftocairo" : null;
  return { engines, svgTool, hasDvisvgm, hasPdftocairo };
}

// ── Run the TeX engine ────────────────────────────────────────────────
function runEngine(engine, args, cwd) {
  return new Promise((resolve) => {
    execFile(
      engine,
      args,
      { cwd, timeout: JOB_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ exitCode: error ? error.code || 1 : 0, log: `${stdout}\n${stderr}` });
      },
    );
  });
}

// ── Convert the compiled PDF to SVG ───────────────────────────────────
function runSvgTool(tool, pdfPath, svgPath, { fontMode, cwd }) {
  return new Promise((resolve) => {
    let cmd, args;
    if (tool === "dvisvgm") {
      cmd = "dvisvgm";
      args = ["--pdf", fontMode === "embed" ? "--font-format=woff" : "--no-fonts", "-o", svgPath, pdfPath];
    } else {
      // pdftocairo fallback (poppler). No font-outline toggle; it always
      // embeds text as real <text> using whatever's on the system, which
      // is usually fine since it's rendering back on the SAME machine.
      cmd = "pdftocairo";
      args = ["-svg", pdfPath, svgPath];
    }
    execFile(cmd, args, { cwd, timeout: 20000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ exitCode: error ? error.code || 1 : 0, log: `${stdout}\n${stderr}` });
    });
  });
}

// dvisvgm's `--pdf` mode depends on Ghostscript for some operations, and
// dvisvgm (as shipped in current TeX Live/MiKTeX) is incompatible with
// Ghostscript >= 10.01, a known upstream break that users cannot
// easily avoid, since TeX Live 2024 ships exactly that combination.
// Rather than hard-failing when that happens, fall back to pdftocairo
// (poppler), which ships alongside dvisvgm in both TeX Live and MiKTeX
// and doesn't hit this issue. Confirmed against a real TeX Live 2024 +
// Ghostscript 10.04 install: dvisvgm --pdf fails outright there, and this
// fallback is what actually produces a usable SVG.
async function convertPdfToSvg(pdfPath, svgPath, { fontMode, cwd, hasDvisvgm, hasPdftocairo }) {
  const attempts = [];
  if (hasDvisvgm) attempts.push("dvisvgm");
  if (hasPdftocairo) attempts.push("pdftocairo");

  let combinedLog = "";
  for (const tool of attempts) {
    const conv = await runSvgTool(tool, pdfPath, svgPath, { fontMode, cwd });
    combinedLog += `\n--- ${tool} ---\n${conv.log}`;
    if (conv.exitCode === 0 && fs.existsSync(svgPath)) {
      return { ok: true, tool, log: combinedLog };
    }
  }
  return { ok: false, tool: null, log: combinedLog };
}

function extractErrors(log) {
  const errors = [];
  for (const raw of (log || "").split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    if (/^!/.test(t)) errors.push(t);
    else if (/^\.\/.*:\d+:/.test(t)) errors.push(t);
    else if (/LaTeX Error/i.test(t)) errors.push(t);
    else if (/Package .* Error/i.test(t)) errors.push(t);
    else if (/File .* not found/i.test(t)) errors.push(t);
    else if (/^l\.\d+/.test(t) && t.length < 120) errors.push(t);
    else if (/Emergency stop|Fatal error/i.test(t)) errors.push(t);
  }
  return [...new Set(errors)];
}

function cleanStaleJobs() {
  const dir = path.join(os.tmpdir(), "texer-ppt-jobs");
  if (!fs.existsSync(dir)) return;
  const now = Date.now();
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    try {
      if (now - fs.statSync(p).mtimeMs > 60 * 60 * 1000) {
        fs.rmSync(p, { recursive: true, force: true });
      }
    } catch {
      /* best-effort */
    }
  }
}

// Renders saved via /history/save (the Recents tab's "open file location")
// are meant to stick around as long as they're useful, but nothing deletes
// them when an entry falls off the client-side history list (capped at 30
// entries), so sweep anything genuinely old on startup instead of letting
// this grow forever.
function cleanOldRenders() {
  if (!fs.existsSync(RENDERS_DIR)) return;
  const now = Date.now();
  const maxAge = 90 * 24 * 60 * 60 * 1000; // 90 days
  for (const name of fs.readdirSync(RENDERS_DIR)) {
    const p = path.join(RENDERS_DIR, name);
    try {
      if (now - fs.statSync(p).mtimeMs > maxAge) fs.rmSync(p, { force: true });
    } catch {
      /* best-effort */
    }
  }
}

// History entry ids are generated by the client (see src/core/history.ts)
// as `${timestamp}-${random}`. Never let one reach the filesystem as
// anything other than that shape.
function sanitizeHistoryId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id) ? id : null;
}

// ── HTTP server ────────────────────────────────────────────────────
const app = express();
app.use(
  cors({
    origin(origin, callback) {
      // Requests with no Origin header (curl, health checks) are allowed
      // through; browser-issued cross-origin requests are checked against
      // the allowlist.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`Origin not allowed: ${origin}`));
    },
    allowedHeaders: ["Content-Type", "X-Eneles-Token"],
  }),
);
app.use(express.json({ limit: "1mb" }));

function requireToken(req, res, next) {
  const provided = req.headers["x-texer-token"];
  if (provided && provided === AUTH_TOKEN) return next();
  res.status(401).json({
    success: false,
    errors: [
      "Missing or incorrect local token. Copy the token printed in the server console into the add-in's Settings panel.",
    ],
  });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, ...detectEnvironment() });
});

app.post("/compile/svg", requireToken, async (req, res) => {
  const {
    source = "",
    engine = "pdflatex",
    preamble = "",
    border = "2pt",
    fontMode = "path",
  } = req.body || {};

  const validEngines = ["pdflatex", "xelatex", "lualatex"];
  if (!validEngines.includes(engine)) {
    return res.status(400).json({ success: false, errors: [`Invalid engine: ${engine}`] });
  }
  if (!source || !source.trim()) {
    return res.status(400).json({ success: false, errors: ["No LaTeX source provided"] });
  }
  if (Buffer.byteLength(source, "utf-8") > MAX_SOURCE_BYTES) {
    return res.status(400).json({ success: false, errors: ["Source exceeds 200KB limit"] });
  }
  if (containsDangerousCommands(source) || containsDangerousCommands(preamble)) {
    return res.status(400).json({
      success: false,
      errors: ["Forbidden LaTeX command detected: shell-escape commands are not allowed"],
    });
  }

  const { engines, hasDvisvgm, hasPdftocairo } = detectEnvironment();
  if (!engines.includes(engine)) {
    return res.status(503).json({
      success: false,
      errors: [
        `${engine} was not found on PATH. Installed engines detected: ${engines.join(", ") || "none"}. ` +
          "Make sure your TeX Live/MiKTeX bin directory is on PATH and restart this server.",
      ],
    });
  }
  if (!hasDvisvgm && !hasPdftocairo) {
    return res.status(503).json({
      success: false,
      errors: [
        "Neither dvisvgm nor pdftocairo was found on PATH. dvisvgm ships with both TeX Live and MiKTeX. " +
          "check that your TeX bin directory is on PATH and restart this server.",
      ],
    });
  }

  try {
    const result = await enqueue(async () => {
      const startTime = Date.now();
      const jobId = crypto.randomUUID();
      const workDir = path.join(os.tmpdir(), "texer-ppt-jobs", jobId);
      fs.mkdirSync(workDir, { recursive: true });

      try {
        const mainFile = "main.tex";
        const texSource = buildStandaloneLatex(source, { preamble, border });
        fs.writeFileSync(path.join(workDir, mainFile), texSource, "utf-8");

        const args = [
          "-interaction=nonstopmode",
          "-halt-on-error",
          "-file-line-error",
          `-output-directory=${workDir}`,
          "-no-shell-escape",
        ];
        if (engine === "xelatex" || engine === "lualatex") args.push("-shell-restricted");
        args.push(mainFile);

        let lastLog = "";
        let lastExitCode = 0;
        for (let pass = 0; pass < 2; pass++) {
          const r = await runEngine(engine, args, workDir);
          lastLog = r.log;
          lastExitCode = r.exitCode;
          if (r.exitCode !== 0) break;
          if (!/rerun/i.test(lastLog)) break;
        }

        const pdfPath = path.join(workDir, "main.pdf");
        if (!fs.existsSync(pdfPath)) {
          let errors = extractErrors(lastLog);
          if (!errors.length && lastLog.trim()) {
            errors = ["Compilation failed. Last log lines:\n" + lastLog.trim().split("\n").slice(-15).join("\n")];
          }
          return { success: false, svg: null, log: lastLog, errors, duration: Date.now() - startTime };
        }

        const svgPath = path.join(workDir, "main.svg");
        const conv = await convertPdfToSvg(pdfPath, svgPath, { fontMode, cwd: workDir, hasDvisvgm, hasPdftocairo });

        if (!conv.ok) {
          return {
            success: false,
            svg: null,
            log: `${lastLog}\n${conv.log}`,
            errors: ["PDF compiled but SVG conversion failed. See log."],
            duration: Date.now() - startTime,
          };
        }

        return {
          success: true,
          svg: fs.readFileSync(svgPath, "utf-8"),
          // For Export > PDF in the task pane.
          pdf: fs.readFileSync(pdfPath).toString("base64"),
          log: lastLog,
          errors: [],
          duration: Date.now() - startTime,
        };
      } finally {
        try {
          fs.rmSync(workDir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    });

    res.json(result);
  } catch (err) {
    console.error("[texer-ppt] Compile error:", err);
    res.status(500).json({ success: false, svg: null, errors: [err.message || "Internal error"] });
  }
});

// ── Recents tab file management ────────────────────────
// Persists a render's final SVG so "open file location" has a real
// file to point at. Keyed by the history entry id the client already
// generated for its localStorage-side list. This server never
// maintains the list itself, just the files behind it.
app.post("/history/save", requireToken, (req, res) => {
  const id = sanitizeHistoryId((req.body || {}).id);
  const svg = (req.body || {}).svg;
  if (!id || typeof svg !== "string") {
    return res.status(400).json({ success: false, errors: ["Invalid id or svg"] });
  }
  try {
    fs.mkdirSync(RENDERS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RENDERS_DIR, `${id}.svg`), svg, "utf-8");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, errors: [err.message || "Could not save file"] });
  }
});

app.post("/history/open", requireToken, (req, res) => {
  const id = sanitizeHistoryId((req.body || {}).id);
  if (!id) return res.status(400).json({ success: false, errors: ["Invalid id"] });
  const filePath = path.join(RENDERS_DIR, `${id}.svg`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, errors: ["That render's file isn't on disk (never saved, or already deleted)."] });
  }
  // windowsVerbatimArguments matters here: without it Node quotes the whole
  // "/select,C:\path\file.svg" token, and Explorer fails to parse that when
  // the path contains a space (it silently opens Documents instead of
  // selecting the file). Passing the command line through untouched is the
  // form Explorer actually expects.
  execFile(
    "explorer.exe",
    [`/select,${filePath}`],
    { windowsVerbatimArguments: true },
    () => {
      /* explorer.exe reports a nonzero exit even on success, so ignore it */
    },
  );
  res.json({ success: true });
});

app.post("/history/delete", requireToken, (req, res) => {
  const id = sanitizeHistoryId((req.body || {}).id);
  if (!id) return res.status(400).json({ success: false, errors: ["Invalid id"] });
  try {
    fs.rmSync(path.join(RENDERS_DIR, `${id}.svg`), { force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, errors: [err.message || "Could not delete file"] });
  }
});

cleanStaleJobs();
cleanOldRenders();

app.listen(PORT, HOST, () => {
  const { engines, svgTool } = detectEnvironment();
  console.log("");
  console.log("  Eneles local compile server");
  console.log(`  Listening on http://${HOST}:${PORT}  (loopback only)`);
  console.log(`  TeX engines found: ${engines.join(", ") || "NONE. Install TeX Live or MiKTeX and put it on PATH"}`);
  console.log(`  SVG converter:     ${svgTool || "NONE. dvisvgm ships with TeX Live/MiKTeX; check PATH"}`);
  console.log("");
  console.log(`  Local token (paste into the add-in's Settings panel once):`);
  console.log(`    ${AUTH_TOKEN}`);
  console.log("");
  console.log(`  Saved at: ${TOKEN_FILE}`);
  console.log("  Leave this window open while you use the add-in. Ctrl+C to stop.");
  console.log("");
});

#!/usr/bin/env node
"use strict";

/**
 * Eneles PPT: the whole app in one file.
 *
 * Download Eneles-PPT.exe, double-click it once. That single run:
 *   1. Copies itself to a permanent location (%LOCALAPPDATA%\Eneles PPT)
 *   2. Registers itself to start silently at every Windows login
 *   3. Registers that folder with PowerPoint as a trusted add-in source
 *   4. Launches the installed copy invisibly and exits
 *
 * After that there is nothing left to run. It stays there,
 * in the background, until you replace it with an updated Eneles-PPT.exe
 * (double-click the new one; it reinstalls over the old one) or remove it
 * (`Eneles-PPT.exe --uninstall`).
 *
 * Once installed and running it serves two things, both loopback-only:
 *   - https://localhost:47821       the task pane itself (static files),
 *                                    using a bundled long-lived local cert
 *   - http://127.0.0.1:47822/*      the LaTeX compile API the task pane
 *                                    talks to by default, so no manual
 *                                    server URL or token entry needed
 *
 * How LaTeX actually gets rendered: this process shells out to whatever
 * pdflatex/xelatex/lualatex is already installed on THIS machine (TeX Live
 * or MiKTeX), then converts the resulting PDF to a cropped SVG with
 * dvisvgm (falling back to pdftocairo, see convertPdfToSvg, because
 * dvisvgm's --pdf mode is broken against Ghostscript >= 10.01, which is
 * exactly what current TeX Live ships). Nothing is uploaded anywhere.
 */

const express = require("express");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { execFile, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Crash log ───────────────────────────────────
// This process is normally launched hidden (no console window at all),
// so without this a startup crash would fail completely silently,
// nothing to look at, no way to tell it even tried. Every run appends
// to the same file; check it first if something isn't working.
const LOG_FILE = path.join(os.homedir(), ".texer-ppt", "app.log");
try {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
  const timestamp = () => new Date().toISOString();
  for (const method of ["log", "warn", "error"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      try {
        logStream.write(`[${timestamp()}] ${args.map(String).join(" ")}\n`);
      } catch {
        /* best-effort */
      }
    };
  }
  console.log(`--- started (pid ${process.pid}, argv: ${process.argv.slice(2).join(" ") || "none"}) ---`);
} catch {
  /* if we can't even open the log file, just run without one */
}

process.on("uncaughtException", (err) => {
  console.error("[texer-ppt] FATAL uncaught exception:", err && err.stack ? err.stack : err);
  pauseBeforeExit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("[texer-ppt] FATAL unhandled rejection:", err && err.stack ? err.stack : err);
  pauseBeforeExit(1);
});

// True only for the foreground, double-clicked run (the installer). The
// hidden --serve process launched by Launch-Hidden.vbs has no console
// anyone can see, and no one to press a key, so it must never block here.
const IS_FOREGROUND_INSTALLER = !process.argv.includes("--serve") && !process.argv.includes("--uninstall");

/**
 * Keeps a double-clicked console window open on failure instead of it
 * flashing and vanishing before the error is readable, which is exactly
 * what "I ran it and nothing happened" looks like from the outside.
 */
function pauseBeforeExit(code) {
  if (!IS_FOREGROUND_INSTALLER) {
    process.exit(code);
    return;
  }
  try {
    console.log("");
    execFileSync("cmd", ["/c", "pause"], { stdio: "inherit" });
  } catch {
    /* stdin unavailable (e.g. launched with no console) — nothing to wait on */
  }
  process.exit(code);
}

// ── Config ──────────────────────────────────────────────────────────
const HTTPS_PORT = parseInt(process.env.TEXER_PPT_HTTPS_PORT || "47821", 10);
const API_PORT = parseInt(process.env.TEXER_PPT_PORT || "47822", 10);
const HOST = "127.0.0.1"; // loopback only, never bind 0.0.0.0
const MAX_CONCURRENT = 2;
const JOB_TIMEOUT_MS = 45000;
const MAX_SOURCE_BYTES = 200 * 1024;
const STATE_DIR = path.join(os.homedir(), ".texer-ppt");
const TOKEN_FILE = path.join(STATE_DIR, "token");
const RENDERS_DIR = path.join(STATE_DIR, "renders");
const PUBLIC_DIR = path.join(__dirname, "public");
const CERTS_DIR = path.join(__dirname, "certs");

const EXE_NAME = "Eneles-PPT.exe";
const INSTALL_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), "Eneles PPT");
const INSTALLED_EXE_PATH = path.join(INSTALL_DIR, EXE_NAME);
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE_NAME = "EnelesPPT";
const CATALOG_ID = "{2f8f5f2a-9b7b-4a3b-8b9d-1f2e3d4c5b6a}";
const CATALOG_KEY = `HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\TrustedCatalogs\\${CATALOG_ID}`;

// Written into the install directory. Runs the installed exe with no
// visible window and an explicit --serve flag. This is what the
// Run-at-login registry entry actually points at, since a plain .exe
// launch would flash a console every login. Passing --serve explicitly
// (rather than relying on comparing file paths, which is fragile on
// Windows: case, \\?\ prefixes, short vs. long paths) guarantees this
// process always goes straight to serving instead of re-triggering
// install logic.
function launchHiddenVbs() {
  return [
    "Set fso = CreateObject(\"Scripting.FileSystemObject\")",
    "Set shell = CreateObject(\"WScript.Shell\")",
    "here = fso.GetParentFolderName(WScript.ScriptFullName)",
    `shell.Run """" & here & "\\${EXE_NAME}"" --serve", 0, False`,
    "",
  ].join("\r\n");
}

// ── One-time (per launch) trust of the bundled CA ────────────────────
// `certutil -addstore -user Root` is idempotent and needs no elevation
// (CurrentUser store), so it is safe to run on every startup.
//
// certutil is an external process, so it can't read ca.crt directly out
// of pkg's virtual snapshot filesystem (only Node's own fs calls can see
// bundled assets there), so copy it to a real temp file first.
function ensureCaTrusted() {
  const tempCaPath = path.join(os.tmpdir(), "texer-ppt-ca.crt");
  try {
    fs.writeFileSync(tempCaPath, fs.readFileSync(path.join(CERTS_DIR, "ca.crt")));
    execFileSync("certutil", ["-addstore", "-user", "Root", tempCaPath], { stdio: "pipe" });
    console.log("[texer-ppt] Local CA trusted (CurrentUser\\Root).");
  } catch (e) {
    console.warn(`[texer-ppt] Could not import CA automatically: ${e.message}`);
    console.warn(`[texer-ppt] Run manually if the task pane shows a certificate warning:`);
    console.warn(`[texer-ppt]   certutil -addstore -user Root "${tempCaPath}"`);
  } finally {
    try {
      fs.rmSync(tempCaPath, { force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ── Self-install (this is the ENTIRE setup experience) ───────────────
function isRunningFromInstallDir() {
  try {
    return path.resolve(process.execPath).toLowerCase() === path.resolve(INSTALLED_EXE_PATH).toLowerCase();
  } catch {
    return false;
  }
}

function regAdd(key, name, type, value) {
  execFileSync("reg", ["add", key, "/v", name, "/t", type, "/d", value, "/f"], { stdio: "pipe" });
}

function regDelete(key) {
  try {
    execFileSync("reg", ["delete", key, "/f"], { stdio: "pipe" });
  } catch {
    /* wasn't there, fine */
  }
}

function regDeleteValue(key, name) {
  try {
    execFileSync("reg", ["delete", key, "/v", name, "/f"], { stdio: "pipe" });
  } catch {
    /* wasn't there, fine */
  }
}

/**
 * Kills every OTHER process named EXE_NAME, excluding this one.
 *
 * "App-specific process name, safe to kill by image name" was true, but
 * incomplete: our own distributable is also named exactly EXE_NAME, so a
 * bare /IM match includes the process running this very command. In
 * uninstallSelf() that meant the process killed itself mid-cleanup, before
 * it ever reached the registry/file removal steps below, which is why a
 * completed-looking uninstall left every trace behind. The /FI filter
 * excludes our own PID from the match.
 */
function killOtherInstances() {
  execFileSync("taskkill", ["/F", "/FI", `PID ne ${process.pid}`, "/IM", EXE_NAME, "/T"], { stdio: "pipe" });
}

/** Copies the running exe to INSTALL_DIR, retrying once if a previous
 * running copy has the destination file locked. */
/** Blocks the current thread for `ms` without spawning a subprocess. Used
 * only in the short, synchronous install flow, never inside serve(). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Copies the running exe to INSTALL_DIR.
 *
 * The destination can be locked for two different reasons, and a single
 * immediate retry isn't enough for either:
 *   1. An older installed copy is still running and holds the file open.
 *      killOtherInstances() handles this, but the OS does not always
 *      release the handle the instant the process dies.
 *   2. Windows Defender (or another antivirus) locks a freshly-downloaded,
 *      unsigned exe for a moment while it scans it. This happens on a
 *      completely fresh machine with nothing else running, so there is
 *      nothing to kill. It clears on its own within a second or two.
 * Retry with a short backoff instead of surfacing "Install failed" for
 * something that resolves itself if you just wait.
 */
function copySelfIn() {
  fs.mkdirSync(INSTALL_DIR, { recursive: true });

  // Graduated backoff: failures observed in the wild alternated between
  // succeeding and hitting a lock, meaning the real clearing time varies.
  // Total budget here is roughly 8 seconds worst case.
  const delaysMs = [200, 300, 400, 600, 800, 1000, 1200, 1500, 1800];
  let lastError;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    if (attempt === 1) {
      try {
        killOtherInstances();
      } catch {
        /* nothing else was running */
      }
    }
    try {
      fs.copyFileSync(process.execPath, INSTALLED_EXE_PATH);
      return;
    } catch (e) {
      lastError = e;
      if (attempt < delaysMs.length) sleepSync(delaysMs[attempt]);
    }
  }
  throw lastError;
}

function installSelf() {
  console.log("[texer-ppt] Installing to", INSTALL_DIR);
  copySelfIn();
  fs.writeFileSync(path.join(INSTALL_DIR, "Launch-Hidden.vbs"), launchHiddenVbs());
  fs.copyFileSync(path.join(PUBLIC_DIR, "manifest.xml"), path.join(INSTALL_DIR, "manifest.xml"));

  // Trust the CA HERE, in the foreground, before anything can try to load
  // the task pane. If this is left to the background instance, a very first
  // install races the WebView: PowerPoint can reach https://localhost:47821
  // before the root cert lands in the store, the handshake is rejected, and
  // WebView caches that failure and shows its error page. Running the exe a
  // second time then "fixed" it only because the CA was trusted by then.
  ensureCaTrusted();

  // Start at login, invisibly.
  const launchCmd = `wscript.exe //B "${path.join(INSTALL_DIR, "Launch-Hidden.vbs")}"`;
  regAdd(RUN_KEY, RUN_VALUE_NAME, "REG_SZ", launchCmd);

  // Trusted add-in catalog. PowerPoint reads this at startup and lists
  // every manifest.xml in INSTALL_DIR under Insert > My Add-ins, with
  // Flags=1 also surfacing the ribbon button directly.
  regAdd(CATALOG_KEY, "Id", "REG_SZ", CATALOG_ID);
  regAdd(CATALOG_KEY, "Url", "REG_SZ", INSTALL_DIR);
  regAdd(CATALOG_KEY, "Flags", "REG_DWORD", "1");

  console.log("[texer-ppt] Installed.");
}

/** Resolves once the background instance is actually answering, or after `timeoutMs`. */
function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const req = http.get(
        { host: HOST, port: API_PORT, path: "/health", timeout: 1000 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) return resolve(true);
          retry();
        },
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

function uninstallSelf() {
  console.log("[texer-ppt] Uninstalling...");
  try {
    killOtherInstances();
  } catch {
    /* wasn't running, fine */
  }
  regDeleteValue(RUN_KEY, RUN_VALUE_NAME);
  regDelete(CATALOG_KEY);
  try {
    execFileSync("certutil", ["-delstore", "-user", "Root", "Eneles PPT Local CA"], { stdio: "pipe" });
  } catch {
    /* fine either way */
  }
  try {
    fs.rmSync(INSTALL_DIR, { recursive: true, force: true });
  } catch (e) {
    console.warn(`[texer-ppt] Could not remove ${INSTALL_DIR}: ${e.message}`);
  }
  console.log("[texer-ppt] Done. Restart PowerPoint if it was open.");
}

// ── Job queue ─────────────────────────────────────────────────────────
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

// ── Dangerous command filter ──────────────────────────────────────────
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
// Package, macro, theorem, and TikZ setup lines at the top of a snippet are
// hoisted into the generated preamble. This includes multi-line definitions,
// which makes pasted theorem-box and TikZ setups work without manual moves.
function buildStandaloneLatex(source, opts) {
  const extraPreamble = (opts && opts.preamble) || "";
  const border = (opts && opts.border) || "2pt";
  const trimmed = (source || "").trim();

  if (/\\documentclass/.test(trimmed)) return trimmed;

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
  const svgTool = hasDvisvgm ? "dvisvgm" : hasPdftocairo ? "pdftocairo" : null;
  return { engines, svgTool, hasDvisvgm, hasPdftocairo };
}

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

function runSvgTool(tool, pdfPath, svgPath, { fontMode, cwd }) {
  return new Promise((resolve) => {
    let cmd, args;
    if (tool === "dvisvgm") {
      cmd = "dvisvgm";
      args = ["--pdf", fontMode === "embed" ? "--font-format=woff" : "--no-fonts", "-o", svgPath, pdfPath];
    } else {
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
// Confirmed against a real install: dvisvgm --pdf fails outright there.
// Fall back to pdftocairo (poppler), which ships alongside dvisvgm in
// both TeX Live and MiKTeX and doesn't hit this issue.
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

function cleanStaleJobs() {
  const dir = path.join(os.tmpdir(), "texer-ppt-jobs");
  if (!fs.existsSync(dir)) return;
  const now = Date.now();
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    try {
      if (now - fs.statSync(p).mtimeMs > 60 * 60 * 1000) fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ── Auth token ─────────────────────────────────────────────────────
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
    console.warn(`[texer-ppt] Could not persist token to ${TOKEN_FILE}: ${e.message}`);
    return crypto.randomBytes(24).toString("hex");
  }
}

// ── Shared Express app (mounted on both listeners) ───────────────────
function buildApp(authToken) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(PUBLIC_DIR));

  // `X-Eneles-Token` is a custom header, so any cross-origin caller (a
  // random webpage the user happens to have open in another tab) gets
  // CORS-preflighted first; since we never send an
  // Access-Control-Allow-Origin header, that preflight fails and the
  // browser never sends the real request. Same-origin requests from the
  // task pane itself aren't preflighted at all, so this costs it nothing.
  function requireToken(req, res, next) {
    const provided = req.headers["x-texer-token"];
    if (provided && provided === authToken) return next();
    res.status(401).json({ success: false, errors: ["Missing or incorrect local token."] });
  }

  app.get("/health", (_req, res) => {
    res.json({ ok: true, ...detectEnvironment() });
  });

  // Lets the task pane fetch its own auth token on boot instead of the
  // user copy-pasting it from anywhere.
  app.get("/local-token", (_req, res) => {
    res.json({ token: authToken });
  });

  app.post("/compile/svg", requireToken, async (req, res) => {
    const { source = "", engine = "pdflatex", preamble = "", border = "2pt", fontMode = "path" } = req.body || {};

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
            "Install TeX Live or MiKTeX and make sure it's on PATH, then restart Eneles.",
        ],
      });
    }
    if (!hasDvisvgm && !hasPdftocairo) {
      return res.status(503).json({
        success: false,
        errors: ["Neither dvisvgm nor pdftocairo was found on PATH. dvisvgm ships with TeX Live/MiKTeX."],
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

  return app;
}

function serve() {
  cleanStaleJobs();
  cleanOldRenders();
  ensureCaTrusted();

  const authToken = getOrCreateToken();
  const app = buildApp(authToken);

  const httpsOptions = {
    key: fs.readFileSync(path.join(CERTS_DIR, "localhost.key")),
    cert: fs.readFileSync(path.join(CERTS_DIR, "localhost.crt")),
  };

  // This process normally runs hidden, so an unhandled listen error would
  // just vanish, and the pane would fail to load with nothing anywhere
  // explaining why. Name the likely cause instead.
  const onListenError = (label, port) => (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(
        `[texer-ppt] Port ${port} is already in use, so the ${label} could not start. ` +
          "Another copy of Eneles may already be running (check Task Manager for Eneles-PPT.exe), " +
          "or another application has taken the port.",
      );
    } else {
      console.error(`[texer-ppt] The ${label} failed to start on port ${port}:`, err && err.message ? err.message : err);
    }
    process.exit(1);
  };

  const httpsServer = https.createServer(httpsOptions, app);
  httpsServer.on("error", onListenError("task pane server", HTTPS_PORT));
  httpsServer.listen(HTTPS_PORT, HOST, () => {
    console.log(`[texer-ppt] Task pane:  https://localhost:${HTTPS_PORT}/taskpane.html`);
  });

  const apiServer = http.createServer(app);
  apiServer.on("error", onListenError("compile API", API_PORT));
  apiServer.listen(API_PORT, HOST, () => {
    const { engines, svgTool } = detectEnvironment();
    console.log(`[texer-ppt] Compile API: http://127.0.0.1:${API_PORT}`);
    console.log(`[texer-ppt] TeX engines: ${engines.join(", ") || "NONE (install TeX Live or MiKTeX)"}`);
    console.log(`[texer-ppt] SVG tool:    ${svgTool || "NONE (dvisvgm ships with TeX Live/MiKTeX)"}`);
    console.log("[texer-ppt] Ready.");
  });
}

// ── Entry point ────────────────────────────────────────────────────
function main() {
  if (process.argv.includes("--uninstall")) {
    uninstallSelf();
    return;
  }

  // Launched by our own hidden vbs launcher, so always just serve, no
  // path-comparison involved.
  if (process.argv.includes("--serve")) {
    serve();
    return;
  }

  if (os.platform() !== "win32") {
    console.warn("[texer-ppt] Self-install is Windows-only right now. Serving directly instead.");
    serve();
    return;
  }

  if (isRunningFromInstallDir()) {
    // Someone double-clicked the installed copy directly (not via the
    // hidden launcher), so just run without reinstalling over itself.
    serve();
    return;
  }

  // First run (or running a newer downloaded copy to update): install,
  // hand off to the installed copy, and get out of the way.
  console.log("");
  console.log("  Installing Eneles...");
  try {
    installSelf();
  } catch (err) {
    console.log("");
    console.error("  Install failed:", err && err.message ? err.message : err);
    console.error(`  Full details were written to ${LOG_FILE}`);
    if (err && err.code === "EBUSY") {
      console.error("  The install file was locked (often antivirus briefly scanning a new,");
      console.error("  unsigned exe, or an old copy still running). Wait a few seconds and");
      console.error("  double-click Eneles-PPT.exe again.");
    } else {
      console.error("  Common causes: another security tool blocking reg.exe or certutil,");
      console.error("  or a work/school PC whose IT policy restricts registry changes.");
    }
    pauseBeforeExit(1);
    return;
  }
  console.log("");
  console.log("  Starting in the background...");

  execFile("wscript.exe", ["//B", path.join(INSTALL_DIR, "Launch-Hidden.vbs")], () => {});

  // Don't exit on a blind timer. Wait until the background instance is
  // genuinely answering, so that by the time this window closes the task
  // pane is actually loadable. Otherwise opening PowerPoint too quickly
  // hits a dead port, WebView caches the failure, and it looks like the
  // app has to be run twice.
  waitForServer().then((ready) => {
    console.log("");
    if (ready) {
      console.log("  Ready. Eneles is running in the background and starts with Windows.");
      console.log("  Open PowerPoint and click Eneles. You never need to run this again.");
      console.log("  (Double-click a newer Eneles-PPT.exe only when you want to update it.)");
      console.log("");
      setTimeout(() => process.exit(0), 1500);
    } else {
      console.log("  The background service did not come up in time.");
      console.log(`  Check the log at ${LOG_FILE}`);
      console.log("");
      pauseBeforeExit(1);
    }
  });
}

main();

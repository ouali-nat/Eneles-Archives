const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");

/**
 * Load compiler/.env for local runs, without a dependency.
 *
 * In Docker and on Railway the environment is injected and this finds no
 * file. Locally, `node server.js` previously saw none of the secrets in
 * `.env`, which meant the internal token and client keys silently did not
 * work in development. Real environment variables always win over the file.
 */
(() => {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

const app = express();
const PORT = process.env.PORT || 3500;
// How many TeX runs at once. Each uses one core, so set MAX_CONCURRENT to the cores this instance has.
const MAX_CONCURRENT = Math.max(Number(process.env.MAX_CONCURRENT) || 8, 1);
const MAX_QUEUE_SIZE = 100; // Prevent memory exhaustion
const JOB_TIMEOUT_MS = 30000;
// One compile may run TeX several times plus BibTeX/Biber and makeindex. The
// whole job has to finish inside the API's 120 s wait, so it gets a budget,
// and each step gets what is left of it, capped.
const COMPILE_BUDGET_MS = 100000;
const ENGINE_PASS_TIMEOUT_MS = 60000; // slow packages (quantikz, chemfig) on a first run
const TOOL_TIMEOUT_MS = 30000;
const MAX_ENGINE_PASSES = 5;
const CLEANUP_AGE_MS = 60 * 60 * 1000; // 1 hour
const INTERNAL_SECRET = process.env.COMPILER_INTERNAL_SECRET || "";

/**
 * Named client keys for external projects.
 *
 * The internal secret above identifies the Eneles API itself. It is one
 * value shared by one caller, and that is fine for that purpose. It is the
 * wrong tool for granting access to other projects: a single secret handed to
 * three teams means one leaked key compromises all three, revoking one means
 * rotating everyone, and the logs cannot say which project made a request.
 *
 * Client keys fix each of those. Configure them as
 *
 *   COMPILER_CLIENT_KEYS=byblex:ck_8f2a...,laso:ck_c41d...,lebsci:ck_0e77...
 *
 * Each entry is `name:key`, or `name:key:limit` to give that client its own number of compiles a minute (default 60). Names appear in logs, in the rate-limit bucket, and in the X-Compiler-Client response header; keys are compared in constant time. Generate a key with `node scripts/generate-client-key.mjs <name>`. Revoke one by removing its entry and restarting.
 */
/** Per-client budget when an entry names none. Generous for a real integration, useless as an amplifier. */
const DEFAULT_CLIENT_LIMIT_PER_MINUTE = 60;
const CLIENT_KEYS = new Map(); // name -> key
const CLIENT_LIMITS = new Map(); // name -> compiles a minute
for (const entry of (process.env.COMPILER_CLIENT_KEYS || "").split(",")) {
  const trimmed = entry.trim();
  if (!trimmed) continue;
  const parts = trimmed.split(":").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) {
    console.warn(`[compiler] Ignoring malformed COMPILER_CLIENT_KEYS entry (expected name:key or name:key:limit): ${trimmed.slice(0, 20)}...`);
    continue;
  }
  const name = parts[0].toLowerCase();
  const key = parts[1];
  if (!name || key.length < 32) {
    console.warn(`[compiler] Ignoring COMPILER_CLIENT_KEYS entry "${name}": key must be at least 32 characters`);
    continue;
  }
  let limit = DEFAULT_CLIENT_LIMIT_PER_MINUTE;
  if (parts.length === 3) {
    const parsed = Number(parts[2]);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) {
      console.warn(`[compiler] COMPILER_CLIENT_KEYS entry "${name}": limit "${parts[2]}" is not a whole number from 1 to 10000; using ${DEFAULT_CLIENT_LIMIT_PER_MINUTE}`);
    } else {
      limit = parsed;
    }
  }
  CLIENT_KEYS.set(name, key);
  CLIENT_LIMITS.set(name, limit);
}
if (CLIENT_KEYS.size > 0) {
  console.log(`[compiler] ${CLIENT_KEYS.size} client key(s) loaded: ${[...CLIENT_KEYS.keys()].map((name) => `${name} (${CLIENT_LIMITS.get(name)}/min)`).join(", ")}`);
}

const clientLimit = (name) => CLIENT_LIMITS.get(name) ?? DEFAULT_CLIENT_LIMIT_PER_MINUTE;
const clientBuckets = new Map(); // name -> { count, windowStart }

/**
 * Compare a presented key against every configured client key in constant
 * time per candidate, and return the matching client's name or null.
 *
 * Iterating all keys rather than looking one up by name is deliberate: the
 * request carries only the key, and a hash-map lookup keyed on the secret
 * itself would leak via timing whether a prefix matched. With a handful of
 * clients the linear scan costs nothing.
 */
function identifyClient(presented) {
  if (!presented || CLIENT_KEYS.size === 0) return null;
  const presentedBuf = Buffer.from(String(presented));
  let matched = null;
  for (const [name, key] of CLIENT_KEYS) {
    const keyBuf = Buffer.from(key);
    const same =
      keyBuf.length === presentedBuf.length &&
      crypto.timingSafeEqual(keyBuf, presentedBuf);
    // No early return: every key gets compared so timing is independent of
    // which entry, if any, matched.
    if (same) matched = name;
  }
  return matched;
}

/** Sliding one-minute window per client. Returns true if the request is allowed. */
function consumeClientBudget(name) {
  const now = Date.now();
  const bucket = clientBuckets.get(name);
  if (!bucket || now - bucket.windowStart >= 60_000) {
    clientBuckets.set(name, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= clientLimit(name)) return false;
  bucket.count++;
  return true;
}

// Job Queue State
const jobQueue = [];
let activeJobs = 0;
const rateLimits = new Map(); // For editor compiles only
const TIKZ_CACHE_MAX = 300; // LRU cache for TikZ previews (library examples)
const tikzCache = new Map(); // hash -> { success, pdf, log, errors, duration }

// Process the queue
const processQueue = async () => {
  if (activeJobs >= MAX_CONCURRENT || jobQueue.length === 0) return;

  activeJobs++;
  const { fn, resolve, reject } = jobQueue.shift();

  try {
    const result = await fn();
    resolve(result);
  } catch (error) {
    reject(error);
  } finally {
    activeJobs--;
    // Schedule next processing on next tick to allow I/O
    setImmediate(processQueue);
  }
};

// Enqueue job helper
const enqueueJob = (fn) => {
  return new Promise((resolve, reject) => {
    if (jobQueue.length >= MAX_QUEUE_SIZE) {
      return reject(new Error("Server is too busy, please try again later."));
    }
    jobQueue.push({ fn, resolve, reject });
    processQueue();
  });
};

// CORS: allow the NestJS API to call us
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : "*",
  }),
);

app.use(express.json({ limit: "50mb" }));

// ── Metrics ───────────────────────────────────────────────────
// What to watch to decide when one compiler is not enough: how many compiles run and wait, how long they take, and how many are turned away. Written by hand in the Prometheus text format so the service keeps its four dependencies.
const DURATION_BUCKETS = [0.5, 1, 2, 5, 10, 20, 30, 60, 120];
const requestStats = new Map(); // "compile|success" -> { count, seconds, buckets[] }

app.use((req, res, next) => {
  if (req.method !== "POST" || (req.path !== "/compile" && req.path !== "/synctex")) return next();
  const started = process.hrtime.bigint();
  let succeeded = null;
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body.success === "boolean") succeeded = body.success;
    return sendJson(body);
  };
  res.on("finish", () => {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    // success: a PDF came back. failure: TeX ran and the document had errors. The rest never reached TeX or broke on our side.
    const outcome = res.statusCode === 429 ? "rate_limited" : res.statusCode === 503 ? "queue_full" : res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "refused" : succeeded === false ? "failure" : "success";
    const key = `${req.path.slice(1)}|${outcome}`;
    let stat = requestStats.get(key);
    if (!stat) requestStats.set(key, (stat = { count: 0, seconds: 0, buckets: DURATION_BUCKETS.map(() => 0) }));
    stat.count += 1;
    stat.seconds += seconds;
    DURATION_BUCKETS.forEach((limit, i) => {
      if (seconds <= limit) stat.buckets[i] += 1;
    });
  });
  next();
});

// GET /metrics needs "Authorization: Bearer <METRICS_TOKEN>". Without the setting it does not exist in production.
app.get("/metrics", (req, res) => {
  const token = (process.env.METRICS_TOKEN || "").trim();
  if (!token) {
    if (process.env.NODE_ENV === "production") return res.status(404).end();
  } else {
    const given = Buffer.from((req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim());
    const expected = Buffer.from(token);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return res.status(401).end();
  }
  const memory = process.memoryUsage();
  const lines = [
    "# HELP texer_compiler_jobs Compiles running now, waiting in the queue, and the limits on each.",
    "# TYPE texer_compiler_jobs gauge",
    `texer_compiler_jobs{state="active"} ${activeJobs}`,
    `texer_compiler_jobs{state="queued"} ${jobQueue.length}`,
    `texer_compiler_jobs{state="capacity"} ${MAX_CONCURRENT}`,
    `texer_compiler_jobs{state="queue_limit"} ${MAX_QUEUE_SIZE}`,
    "# HELP texer_compiler_request_duration_seconds How long compile and synctex requests take, queueing included, by outcome.",
    "# TYPE texer_compiler_request_duration_seconds histogram",
  ];
  for (const [key, stat] of requestStats) {
    const [route, outcome] = key.split("|");
    const labels = `route="${route}",outcome="${outcome}"`;
    DURATION_BUCKETS.forEach((limit, i) => lines.push(`texer_compiler_request_duration_seconds_bucket{${labels},le="${limit}"} ${stat.buckets[i]}`));
    lines.push(`texer_compiler_request_duration_seconds_bucket{${labels},le="+Inf"} ${stat.count}`);
    lines.push(`texer_compiler_request_duration_seconds_sum{${labels}} ${stat.seconds.toFixed(3)}`);
    lines.push(`texer_compiler_request_duration_seconds_count{${labels}} ${stat.count}`);
  }
  lines.push(
    "# HELP texer_compiler_process_resident_memory_bytes Memory this process holds (TeX runs in child processes and is not counted).",
    "# TYPE texer_compiler_process_resident_memory_bytes gauge",
    `texer_compiler_process_resident_memory_bytes ${memory.rss}`,
    "# HELP texer_compiler_process_uptime_seconds Seconds since this process started.",
    "# TYPE texer_compiler_process_uptime_seconds gauge",
    `texer_compiler_process_uptime_seconds ${Math.round(process.uptime())}`,
    "# HELP texer_compiler_load1 The machine's one-minute load average, and how many CPUs it has.",
    "# TYPE texer_compiler_load1 gauge",
    `texer_compiler_load1 ${os.loadavg()[0].toFixed(2)}`,
    "# TYPE texer_compiler_cpus gauge",
    `texer_compiler_cpus ${os.cpus().length}`,
  );
  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8").set("Cache-Control", "no-store").send(lines.join("\n") + "\n");
});

// ── Health check ──────────────────────────────────────────────
app.get("/health", (_req, res) => {
  // active, queued, and capacity say how busy this instance is: when queued stays above zero, it is time for a second one.
  res.json({ status: "ok", engines: getAvailableEngines(), active: activeJobs, queued: jobQueue.length, capacity: MAX_CONCURRENT, queueLimit: MAX_QUEUE_SIZE });
});

// ── Dangerous command filter ──────────────────────────────────
// Defense in depth only: TeX can rebuild any control sequence from catcode
// tricks, so a determined document can get past a text filter. The real
// boundary is the engine running as its own unprivileged user (TEX_RUN_UID
// below), which cannot read this process's environment or root-only files.
function containsDangerousCommands(content) {
  const dangerousPatterns = [
    /\\write18/,
    /\\immediate\s*\\write18/,
    /\\input\s*\{\s*\|/,
    /\\openin\s*[^=]*\s*=\s*"\s*\|/,
    /\\openin\s*[^=]*\s*=\s*\|/,
    /\\(directlua|latelua|luaexec|luadirect|luacode)/,
    /\\begin\s*\{\s*luacode\*?\s*\}/,
    /\\csname\s+write\\endcsname/,
    // Reads of process environments and kernel state, as a path start
    // ({/proc/..., =/proc/..., a bare /proc/...), not inside a URL.
    /(^|[\s{=,])\/(proc|sys)\//m,
    // ^^5c is a backslash in TeX's hex notation, the usual way around this list.
    /\^\^(5c|5C)/,
  ];
  return dangerousPatterns.some((pattern) => pattern.test(content));
}

// ── Engine user ───────────────────────────────────────────────
// When this process runs as root and TEX_RUN_UID is set, each job's files are
// handed to that user and the engine runs as it. /proc/<pid>/environ (where
// this service's secrets live) is readable only by the same user, so a
// document can no longer read them back into its PDF.
const TEX_RUN_UID = process.env.TEX_RUN_UID ? Number(process.env.TEX_RUN_UID) : null;
const TEX_RUN_GID = process.env.TEX_RUN_GID ? Number(process.env.TEX_RUN_GID) : TEX_RUN_UID;
const canDropPrivileges =
  TEX_RUN_UID !== null && typeof process.getuid === "function" && process.getuid() === 0;
if (TEX_RUN_UID !== null && !canDropPrivileges) {
  console.warn(
    "[compiler] TEX_RUN_UID is set but this process is not root: TeX runs as the current user.",
  );
}

function handToEngineUser(dir) {
  if (!canDropPrivileges) return;
  const walk = (p) => {
    fs.chownSync(p, TEX_RUN_UID, TEX_RUN_GID);
    if (fs.statSync(p).isDirectory()) {
      for (const entry of fs.readdirSync(p)) walk(path.join(p, entry));
    }
  };
  walk(dir);
}

// ── Compile endpoint ──────────────────────────────────────────
// Expects JSON body:
// {
//   files: { path: string, content: string }[]   all project files
//   mainFile: string                              e.g. "main.tex"
//   engine: "pdflatex" | "xelatex" | "lualatex" | "latex"
//   compileMode: "normal" | "draft"
//   stopOnFirstError: boolean
// }
//
// Returns JSON:
// {
//   success: boolean
//   pdf: string | null     base64-encoded PDF
//   log: string            full TeX log output
//   errors: string[]       extracted error lines
//   duration: number       ms
// }
app.post("/compile", async (req, res) => {
  // Only trust X-Request-Source when the caller proves it is an internal
  // service by supplying a valid X-Internal-Token that matches our shared
  // secret.  If INTERNAL_SECRET is empty/unset, never bypass rate limiting
  // (safe default).
  const internalToken = req.headers["x-internal-token"] || "";
  const isTrustedInternal =
    INTERNAL_SECRET.length > 0 &&
    internalToken.length > 0 &&
    crypto.timingSafeEqual(
      Buffer.from(INTERNAL_SECRET),
      Buffer.byteLength(internalToken) === Buffer.byteLength(INTERNAL_SECRET)
        ? Buffer.from(internalToken)
        : Buffer.alloc(Buffer.byteLength(INTERNAL_SECRET)), // length mismatch → guaranteed fail
    );

  const source = isTrustedInternal
    ? (req.headers["x-request-source"] || "").toLowerCase()
    : "";
  const isTikzPreview = source === "tikz-preview";
  const isPrebuild =
    source === "latex-templates-prebuild" ||
    source === "tikz-components-prebuild";

  // External projects authenticate with their own named key. A bad key is
  // not an error, it just means the request is treated as anonymous and gets
  // the anonymous limit, so a typo cannot be told apart from having no key.
  const clientName = identifyClient(req.headers["x-compiler-key"]);
  // Say which client the key was recognized as, so a client can tell a wrong key (no header, the anonymous limit) from its own budget running out.
  if (clientName) res.setHeader("X-Compiler-Client", clientName);
  else if (req.headers["x-compiler-key"]) res.setHeader("X-Compiler-Client", "unrecognized");

  const {
    files = [],
    mainFile = "main.tex",
    engine: requestedEngine = "pdflatex",
    compileMode = "normal",
    stopOnFirstError = false,
  } = req.body;
  // "latexmk" was offered as a project setting. Every compile now runs the
  // bibliography and index steps itself, so it means plain pdfLaTeX.
  const engine = requestedEngine === "latexmk" ? "pdflatex" : requestedEngine;

  const cacheKey = isTikzPreview
    ? crypto
        .createHash("sha256")
        .update(JSON.stringify({ files, mainFile, engine, stopOnFirstError }))
        .digest("hex")
    : null;

  // 1a. TikZ preview: no rate limit, check cache first
  if (isTikzPreview && cacheKey) {
    const cached = tikzCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    if (tikzCache.size >= TIKZ_CACHE_MAX) {
      const firstKey = tikzCache.keys().next().value;
      if (firstKey) tikzCache.delete(firstKey);
    }
  } else if (clientName) {
    // 1b. Named client: its own per-minute budget, independent of IP, so one
    // project cannot starve another and a shared NAT cannot starve anyone.
    if (!consumeClientBudget(clientName)) {
      return res.status(429).json({
        success: false,
        log: "",
        errors: [
          `Rate limit exceeded for client "${clientName}": ${clientLimit(clientName)} compiles per minute.`,
        ],
        pdf: null,
        duration: 0,
      });
    }
    console.log(`[compile] client=${clientName} engine=${engine} files=${files.length}`);
  } else if (!isTikzPreview && !isPrebuild) {
    // 1c. Anonymous: rate limit 1 req/sec per IP (prebuild scripts bypass)
    const clientIp = req.ip || req.connection.remoteAddress;
    const lastRequest = rateLimits.get(clientIp);
    const now = Date.now();
    if (lastRequest && now - lastRequest < 1000) {
      return res.status(429).json({
        success: false,
        log: "",
        errors: ["Rate limit exceeded. Please wait."],
        pdf: null,
        duration: 0,
      });
    }
    rateLimits.set(clientIp, now);
  }

  // 2. Validation & Image Size Check
  const validEngines = ["pdflatex", "xelatex", "lualatex", "latex"];
  if (!validEngines.includes(engine)) {
    return res.status(400).json({
      success: false,
      log: "",
      errors: [`Invalid engine: ${engine}`],
      pdf: null,
      duration: 0,
    });
  }
  if (!files.length) {
    return res.status(400).json({
      success: false,
      log: "",
      errors: ["No files provided"],
      pdf: null,
      duration: 0,
    });
  }

  // Check file sizes
  const MAX_IMG_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
  for (const file of files) {
    // Base64 is ~1.33x larger than binary. 10MB bin ~= 13.3MB base64
    if (file.content && file.content.length > MAX_IMG_SIZE_BYTES * 1.37) {
      return res.status(400).json({
        success: false,
        log: "",
        errors: [`File ${file.path} exceeds 10MB limit`],
        pdf: null,
        duration: 0,
      });
    }
  }

  // 3. Queue & Execution
  try {
    const result = await enqueueJob(async () => {
      const startTime = Date.now();
      const jobId = uuidv4();
      const workDir = path.join(os.tmpdir(), "texer-jobs", jobId);

      try {
        // Write all project files to the temp directory
        for (const file of files) {
          const filePath = path.join(workDir, file.path);

          // Path traversal protection
          const resolvedPath = path.resolve(filePath);
          const resolvedWorkDir = path.resolve(workDir);
          if (!resolvedPath.startsWith(resolvedWorkDir + path.sep)) {
            return { refused: 400, body: { error: "Invalid file path: path traversal detected" } };
          }

          // Check every text file: a .sty or .cls the document loads runs just like .tex
          if (file.encoding !== "base64") {
            if (containsDangerousCommands(file.content)) {
              return {
                refused: 400,
                body: {
                  success: false,
                  log: "",
                  errors: [
                    "Forbidden LaTeX command detected: shell escape commands are not allowed",
                  ],
                  pdf: null,
                  duration: 0,
                },
              };
            }
          }

          const fileDir = path.dirname(filePath);
          fs.mkdirSync(fileDir, { recursive: true });

          if (file.encoding === "base64") {
            fs.writeFileSync(filePath, Buffer.from(file.content, "base64"));
          } else {
            fs.writeFileSync(filePath, file.content, "utf-8");
          }
        }

        // Build command args
        const args = [
          "-interaction=nonstopmode",
          "-halt-on-error",
          "-file-line-error",
          // SyncTeX (=1, compressed) produces <main>.synctex.gz mapping PDF
          // coordinates <-> source (file, line). Powers accurate PDF->editor sync.
          "-synctex=1",
          `-output-directory=${workDir}`,
        ];

        if (stopOnFirstError) {
          // batchmode suppresses interactive prompts; -halt-on-error (already set) stops on first error
          args[0] = "-interaction=batchmode";
        }

        args.push("-no-shell-escape");

        if (engine === "xelatex" || engine === "lualatex") {
          args.push("-shell-restricted");
        }

        const mainBasename = path.basename(mainFile, path.extname(mainFile));

        // Draft: images are drawn as boxes of the right size, which is where
        // most of a long document's time goes. (TeX's own -draftmode writes
        // no PDF at all, so it cannot be used for this.) The file name goes
        // into TeX code here, so only a plain path qualifies.
        if (compileMode === "draft" && /^[\w./-]+\.tex$/.test(mainFile) && !mainFile.includes("..")) {
          args.push(
            `-jobname=${mainBasename}`,
            `\\PassOptionsToPackage{draft}{graphicx}\\PassOptionsToPackage{draft}{graphics}\\input{${mainFile}}`,
          );
        } else {
          args.push(mainFile);
        }
        const logPath = path.join(workDir, `${mainBasename}.log`);

        /**
         * Read the engine's own .log file.
         *
         * `stopOnFirstError` switches the engine to -interaction=batchmode,
         * which writes essentially nothing to stdout: the banner, then
         * silence. Reporting stdout in that mode gives "This is pdfTeX...
         * entering extended mode" for every failure and hides the actual
         * error. The .log file is written regardless of interaction mode, so
         * it is the only reliable source. stdout stays as the fallback for the
         * case where the engine died before creating a log at all.
         */
        const readLog = (stdout) => {
          try {
            if (fs.existsSync(logPath)) {
              const fileLog = fs.readFileSync(logPath, "utf-8");
              if (fileLog.trim().length > 0) return fileLog;
            }
          } catch {
            // Fall through to stdout.
          }
          return stdout;
        };

        let lastLog = "";
        let lastExitCode = 0;
        let passes = 0;
        const deadline = startTime + COMPILE_BUDGET_MS;
        const tools = { errors: [], warnings: [], logs: [] };

        const runPass = async () => {
          const remaining = deadline - Date.now();
          if (remaining < 2000) return false;
          const result = await runEngine(
            engine,
            args,
            workDir,
            Math.min(ENGINE_PASS_TIMEOUT_MS, remaining),
          );
          passes++;
          lastLog = readLog(result.log);
          lastExitCode = result.exitCode;
          return result.exitCode === 0;
        };

        // TeX, then whatever the document asked for (BibTeX or Biber,
        // makeindex, glossaries), then TeX again until the cross-references
        // settle. biblatex's "(re)run Biber ... and rerun LaTeX afterwards"
        // asks for the tool, not for another TeX pass on its own.
        const wantsTool = (log) => /\(re\)run (Biber|BibTeX)|rerun BibTeX/i.test(log);
        // The package that checks for reruns is itself called rerunfilecheck, and hyperref loads it, so its name alone must not count as a request.
        const wantsRerun = (log) =>
          /rerun/i.test(
            log
              .replace(/rerunfilecheck/gi, "")
              // A package's one-line description of itself ("Rerun checks for auxiliary files") and its Info messages are not requests either.
              .replace(/^Package: .*$/gim, "")
              .replace(/^.* Info: .*$/gim, "")
              .replace(/^.*\(re\)run (Biber|BibTeX).*$/gim, "")
              .replace(/^.*and rerun LaTeX afterwards.*$/gim, ""),
          );

        // A table of contents, a list of figures or tables, and beamer's navigation are written during one pass and read during the next, and LaTeX prints no warning when they change. So the files themselves are compared: if a pass left any of them different from how it found them, the PDF does not show them yet.
        const LISTS = new Set([".toc", ".lof", ".lot", ".loa", ".lol", ".nav", ".snm"]);
        const listsState = () => {
          const hash = crypto.createHash("sha1");
          try {
            for (const name of fs.readdirSync(workDir).sort()) {
              if (!LISTS.has(path.extname(name))) continue;
              const content = fs.readFileSync(path.join(workDir, name));
              // A missing file and an empty one are the same: nothing to print.
              if (content.length) hash.update(name).update(content);
            }
          } catch {
            // An unreadable folder reads as "no lists", which only costs a pass.
          }
          return hash.digest("hex");
        };
        let lists = listsState();
        const listsChanged = () => {
          const now = listsState();
          const changed = now !== lists;
          lists = now;
          return changed;
        };

        let ok = await runPass();
        let toolRounds = 0;
        while (ok && passes < MAX_ENGINE_PASSES) {
          const stale = listsChanged();
          if ((toolRounds === 0 || wantsTool(lastLog)) && toolRounds < 2) {
            toolRounds++;
            const ran = await runAuxiliaryTools(workDir, mainBasename, deadline, tools);
            if (ran) {
              ok = await runPass();
              continue;
            }
          }
          if (!stale && !wantsRerun(lastLog)) break;
          ok = await runPass();
        }

        // The "latex" engine writes DVI; dvipdfmx turns it into the PDF. A
        // dvipdfmx.cfg in the project would be read first, and its D line
        // runs a shell command, so a project carrying one is refused.
        const dviPath = path.join(workDir, `${mainBasename}.dvi`);
        if (ok && engine === "latex" && fs.existsSync(dviPath)) {
          if (files.some((f) => path.basename(String(f.path)).toLowerCase() === "dvipdfmx.cfg")) {
            tools.errors.push("dvipdfmx.cfg cannot be part of a project. Remove it and compile again.");
          } else {
            const remaining = deadline - Date.now();
            const r = await runProgram(
              "dvipdfmx",
              ["-q", "-o", `${mainBasename}.pdf`, `${mainBasename}.dvi`],
              workDir,
              Math.max(1000, Math.min(TOOL_TIMEOUT_MS, remaining)),
            );
            if (r.exitCode !== 0) {
              tools.logs.push(`==== dvipdfmx ====\n${r.log.trim().slice(0, 20000)}`);
              tools.errors.push("dvipdfmx could not turn the DVI into a PDF. See the end of the log.");
            }
          }
        }


        const pdfPath = path.join(workDir, `${mainBasename}.pdf`);
        let pdfBase64 = null;

        if (fs.existsSync(pdfPath)) {
          const pdfBuffer = fs.readFileSync(pdfPath);
          pdfBase64 = pdfBuffer.toString("base64");
        }

        // Read the SyncTeX artifact (gzipped). If TeX emitted an uncompressed
        // .synctex (rare), gzip it ourselves so the client always receives gz.
        let synctexBase64 = null;
        try {
          const synctexGz = path.join(workDir, `${mainBasename}.synctex.gz`);
          const synctexPlain = path.join(workDir, `${mainBasename}.synctex`);
          if (fs.existsSync(synctexGz)) {
            synctexBase64 = fs.readFileSync(synctexGz).toString("base64");
          } else if (fs.existsSync(synctexPlain)) {
            synctexBase64 = zlib
              .gzipSync(fs.readFileSync(synctexPlain))
              .toString("base64");
          }
        } catch (e) {
          console.error("SyncTeX read error:", e.message);
        }

        let errors = [...extractErrors(lastLog), ...tools.errors];
        const success = lastExitCode === 0 && pdfBase64 !== null;

        // When LaTeX fails but extractErrors found nothing, add log tail as fallback
        if (!success && errors.length === 0 && lastLog) {
          const tail = lastLog.trim().split("\n").slice(-15).join("\n");
          if (tail) errors = ["Compilation failed. Last log lines:\n" + tail];
        }

        return {
          success,
          pdf: pdfBase64,
          synctex: synctexBase64,
          // The bibliography and index tools' own output follows TeX's log.
          log: tools.logs.length ? `${lastLog}\n\n${tools.logs.join("\n\n")}` : lastLog,
          errors,
          warnings: tools.warnings,
          passes,
          duration: Date.now() - startTime,
        };
      } finally {
        // Immediate cleanup of this job
        try {
          if (fs.existsSync(workDir)) {
            fs.rmSync(workDir, { recursive: true, force: true });
          }
        } catch (e) {
          console.error("Cleanup error:", e);
        }
      }
    });

    // A refused job answers once, here: replying from inside the queued job
    // and again below threw ERR_HTTP_HEADERS_SENT and took the process down.
    if (result && result.refused) {
      return res.status(result.refused).json(result.body);
    }

    // Store in cache for TikZ preview (render once)
    if (isTikzPreview && cacheKey) {
      tikzCache.set(cacheKey, result);
    }

    res.json(result);
  } catch (err) {
    if (err.message === "Server is too busy, please try again later.") {
      return res.status(503).json({ success: false, pdf: null, log: "", errors: [err.message], duration: 0 });
    }
    console.error("Compilation error:", err);
    res.status(500).json({
      success: false,
      pdf: null,
      log: err.message || "Internal compiler error",
      errors: [err.message || "Internal compiler error"],
      duration: 0,
    });
  }
});

// ── SyncTeX reverse-search endpoint (authoritative, uses the real binary) ─
// Body: { synctex: base64 of <main>.synctex.gz, mainFile, page, x, y }
//   page is 1-based; x/y are PDF points from the page's TOP-LEFT.
// Returns: { success, file?, line?, error? }
app.post("/synctex", async (req, res) => {
  const { synctex, mainFile = "main.tex", page, x, y } = req.body || {};

  if (!synctex || typeof synctex !== "string") {
    return res
      .status(400)
      .json({ success: false, error: "Missing synctex data" });
  }
  const pageNum = Number(page);
  const xPt = Number(x);
  const yPt = Number(y);
  if (
    !Number.isFinite(pageNum) ||
    !Number.isFinite(xPt) ||
    !Number.isFinite(yPt) ||
    pageNum < 1
  ) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid page/coordinates" });
  }
  if (synctex.length > 60 * 1024 * 1024) {
    return res
      .status(400)
      .json({ success: false, error: "SyncTeX payload too large" });
  }

  const jobId = uuidv4();
  const workDir = path.join(os.tmpdir(), "texer-synctex", jobId);
  try {
    fs.mkdirSync(workDir, { recursive: true });
    const basename = path.basename(mainFile, path.extname(mainFile));
    // `synctex edit` derives the data-file name from the .pdf name, so the
    // .synctex.gz must sit next to a same-named .pdf path.
    fs.writeFileSync(
      path.join(workDir, `${basename}.synctex.gz`),
      Buffer.from(synctex, "base64"),
    );
    const result = await runSynctexEdit(basename, pageNum, xPt, yPt, workDir);
    return res.json(result);
  } catch (err) {
    console.error("SyncTeX resolve error:", err.message);
    return res
      .status(500)
      .json({ success: false, error: err.message || "SyncTeX failed" });
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (e) {
      console.error("SyncTeX cleanup error:", e.message);
    }
  }
});

// Map a PDF point to a source location via `synctex edit -o PAGE:X:Y:FILE.pdf`.
function runSynctexEdit(basename, page, x, y, cwd) {
  return new Promise((resolve) => {
    const spec = `${page}:${x}:${y}:${basename}.pdf`;
    execFile(
      "synctex",
      ["edit", "-o", spec],
      { cwd, timeout: 8000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        const out = stdout || "";
        // Collect Input/Line pairs; synctex lists best matches first.
        const records = [];
        let pendingFile = null;
        for (const rawLine of out.split("\n")) {
          const line = rawLine.trim();
          const inputMatch = line.match(/^Input:(.*)$/);
          if (inputMatch) {
            pendingFile = inputMatch[1].trim();
            continue;
          }
          const lineMatch = line.match(/^Line:(\d+)/);
          if (lineMatch && pendingFile !== null) {
            records.push({
              file: pendingFile,
              line: parseInt(lineMatch[1], 10),
            });
            pendingFile = null;
          }
        }
        if (records.length === 0) {
          return resolve({
            success: false,
            error:
              error && error.killed
                ? "SyncTeX timed out"
                : "No source location found for that position",
          });
        }
        const best = records[0];
        resolve({ success: true, file: best.file, line: best.line });
      },
    );
  });
}

// ── Run the TeX engine and its helper tools ───────────────────
// The same environment for every program a compile runs.
function texEnv(cwd) {
  return {
    HOME: cwd,
    PATH: process.env.PATH,
    TEXMFHOME: process.env.TEXMFHOME || "",
    FONTCONFIG_PATH: process.env.FONTCONFIG_PATH || "",
    // File access policy.
    //
    // `openout_any=p` and `shell_escape=f` are unconditional: nothing
    // submitted here has any business writing outside the job directory
    // or shelling out.
    //
    // `openin_any` is the one with a trade-off. Paranoid (`p`) blocks
    // `\input{/etc/passwd}`, but it also forbids absolute paths in
    // general, and kpathsea resolves every package in the TeX Live tree
    // to an absolute path. Depending on the build that can break
    // `\usepackage` outright. The default here is restricted (`r`),
    // which blocks dotfiles and is the setting TeX Live itself ships for
    // constrained contexts. Set TEX_OPENIN_ANY=p to tighten it, and
    // check your examples still compile: the container boundary is doing
    // the heavy lifting either way, since the compiler image holds no
    // secrets on disk.
    openin_any: process.env.TEX_OPENIN_ANY || "r",
    openout_any: "p",
    shell_escape: "f",
    // Unwrapped log lines: TeX breaks them at 79 characters by default,
    // which splits error messages and file paths in two.
    max_print_line: "10000",
    error_line: "254",
    half_error_line: "238",
  };
}

function runProgram(command, args, cwd, timeout) {
  handToEngineUser(cwd);
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB log buffer
        ...(canDropPrivileges ? { uid: TEX_RUN_UID, gid: TEX_RUN_GID } : {}),
        env: texEnv(cwd),
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          timedOut: Boolean(error && error.killed),
          missing: Boolean(error && error.code === "ENOENT"),
          log: (stdout || "") + "\n" + (stderr || ""),
        });
      },
    );
  });
}

function runEngine(engine, args, cwd, timeout = ENGINE_PASS_TIMEOUT_MS) {
  return runProgram(engine, args, cwd, timeout);
}

/**
 * Run what the last TeX pass asked for, judged from the files it wrote:
 *
 *   BibTeX     every top-level .aux that names a database (\bibdata), which
 *              covers natbib, plain \bibliography and per-chapter units
 *   Biber      <main>.bcf, written by biblatex
 *   makeindex  every top-level .idx (\makeindex, imakeidx)
 *   glossaries the glossaries listed in <main>.aux, sorted with makeindex
 *   nomencl    <main>.nlo
 *
 * Programs run as the engine user with the engine's file policy. Biber never
 * reads a config file from the project (--noconf) and never fetches remote
 * bibliographies, which would let a document make the compiler request any
 * URL. Returns whether anything ran, so the caller knows to run TeX again.
 */
async function runAuxiliaryTools(workDir, base, deadline, tools) {
  const read = (name) => {
    try {
      return fs.readFileSync(path.join(workDir, name), "utf8");
    } catch {
      return null;
    }
  };
  const exists = (name) => fs.existsSync(path.join(workDir, name));
  const topLevel = (ext) => {
    try {
      return fs
        .readdirSync(workDir)
        .filter((f) => f.endsWith(ext) && /^[\w.-]+$/.test(f))
        .sort()
        .slice(0, 30);
    } catch {
      return [];
    }
  };
  let ran = false;

  const run = async (label, command, args, outputFile) => {
    const remaining = deadline - Date.now();
    if (remaining < 2000) {
      tools.errors.push(`${label} was not run: the compile ran out of time.`);
      return null;
    }
    const result = await runProgram(command, args, workDir, Math.min(TOOL_TIMEOUT_MS, remaining));
    ran = true;
    const fileLog = outputFile ? read(outputFile) : null;
    const text = (fileLog && fileLog.trim() ? fileLog : result.log).slice(0, 20000);
    tools.logs.push(`==== ${label} ====\n${text.trim()}`);
    if (result.missing) {
      tools.errors.push(`${label} is not installed on the compiler.`);
    } else if (result.timedOut) {
      tools.errors.push(`${label} took too long and was stopped.`);
    }
    return { ...result, text };
  };

  const mainAux = read(`${base}.aux`) || "";

  // Biber, for biblatex. With backend=bibtex, biblatex writes \bibdata
  // instead and BibTeX handles it below.
  const bcf = read(`${base}.bcf`);
  if (bcf !== null && /<bcf:datasource\b/.test(bcf) && !/\\bibdata\{/.test(mainAux)) {
    const sources = [...bcf.matchAll(/<bcf:datasource\b[^>]*>([^<]*)<\/bcf:datasource>/g)].map((m) =>
      m[1].trim(),
    );
    if (sources.some((s) => /^[a-z][a-z0-9+.-]*:/i.test(s))) {
      tools.errors.push(
        "Biber was not run: remote bibliography files are not supported. Upload the .bib file to the project and use \\addbibresource{name.bib}.",
      );
    } else {
      const r = await run(`Biber (${base}.bcf)`, "biber", ["--noconf", base], `${base}.blg`);
      if (r && !r.missing && !r.timedOut) {
        for (const line of r.text.split("\n")) {
          const m = /^\[\d+\]\s+\S+>\s+(ERROR|WARN) - (.*)$/.exec(line.trim()) || /^(ERROR|WARN) - (.*)$/.exec(line.trim());
          if (!m) continue;
          (m[1] === "ERROR" ? tools.errors : tools.warnings).push(`Biber: ${m[2].trim()}`);
        }
        if (r.exitCode !== 0 && !tools.errors.some((e) => e.startsWith("Biber:"))) {
          tools.errors.push("Biber could not build the bibliography. See the end of the log.");
        }
      }
    }
  }

  // BibTeX.
  for (const aux of topLevel(".aux")) {
    const content = aux === `${base}.aux` ? mainAux : read(aux);
    if (!content || !/\\bibdata\{/.test(content)) continue;
    const stem = aux.slice(0, -4);
    const r = await run(`BibTeX (${aux})`, "bibtex", [stem], `${stem}.blg`);
    if (!r || r.missing || r.timedOut) continue;
    const lines = r.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (/^Warning--/.test(line)) {
        tools.warnings.push(`BibTeX: ${line.replace(/^Warning--/, "")}`);
      } else if (
        /^(I couldn't open|I found no|I was expecting|Illegal|You're missing|Sorry---|Repeated entry)/.test(line)
      ) {
        // The location is either on the same line or the next one.
        const next = (lines[i + 1] || "").trim();
        const where =
          /---line \d+ of file \S+/.exec(line)?.[0] ?? (/^---line \d+ of file/.test(next) ? next : null);
        const message = line.replace(/---line \d+ of file \S+.*$/, "").trim();
        tools.errors.push(`BibTeX: ${message}${where ? ` (${where.replace(/^---/, "")})` : ""}`);
      }
    }
  }

  // makeindex for \makeindex and imakeidx. Each .idx is its own index.
  for (const idx of topLevel(".idx")) {
    const stem = idx.slice(0, -4);
    await run(`makeindex (${idx})`, "makeindex", ["-q", "-t", `${stem}.ilg`, idx], `${stem}.ilg`);
  }

  // glossaries: <main>.aux lists each glossary's file extensions and the
  // style file the package wrote. A .xdy style means xindy, which is not
  // installed; say so rather than fail quietly.
  const ist = /\\@istfilename\{([^}]+)\}/.exec(mainAux)?.[1];
  if (ist) {
    if (!/^[\w.-]+\.ist$/.test(ist) || !exists(ist)) {
      tools.errors.push(
        "Glossaries were not sorted: only makeindex is available here. Use \\makeglossaries without the xindy option.",
      );
    } else {
      const byLetter = /\\@glsorder\{letter\}/.test(mainAux);
      for (const m of mainAux.matchAll(/\\@newglossary\{([^}]+)\}\{([^}]+)\}\{([^}]+)\}\{([^}]+)\}/g)) {
        const [, name, logExt, outExt, inExt] = m;
        if (![logExt, outExt, inExt].every((e) => /^[\w-]+$/.test(e))) continue;
        if (!exists(`${base}.${inExt}`)) continue;
        await run(
          `makeindex (glossary ${name})`,
          "makeindex",
          ["-q", ...(byLetter ? ["-l"] : []), "-s", ist, "-t", `${base}.${logExt}`, "-o", `${base}.${outExt}`, `${base}.${inExt}`],
          `${base}.${logExt}`,
        );
      }
    }
  }

  // nomencl.
  if (exists(`${base}.nlo`)) {
    await run(
      "makeindex (nomenclature)",
      "makeindex",
      ["-q", `${base}.nlo`, "-s", "nomencl.ist", "-t", `${base}.nlg`, "-o", `${base}.nls`],
      `${base}.nlg`,
    );
  }

  return ran;
}

// ── Extract error lines from TeX log ──────────────────────────
function extractErrors(log) {
  const errors = [];
  const lines = log.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;

    // A missing package is the single most common failure and the most
    // actionable, so it is reported with the name pulled out rather than as a
    // raw log line.
    const missingFile = /LaTeX Error: File `([^']+)' not found/.exec(t);
    if (missingFile) {
      const name = missingFile[1];
      const pkg = name.replace(/\.(sty|cls)$/, "");
      errors.push(
        `Missing package: ${name} is not installed on the compiler. ` +
          `Add it with: tlmgr install ${pkg}`,
      );
      continue;
    }

    // With -file-line-error, errors read "./main.tex:8: Missing \endgroup inserted."
    // rather than starting with "!". The job folder is dropped from the path.
    const fileLine = /^(?:.*\/texer-jobs\/[^/]+\/|\.\/)?([^\s:]+\.(?:tex|sty|cls|bbl|aux|ltx)):(\d+): (.+)$/.exec(t);
    if (fileLine) {
      const [, file, line, message] = fileLine;
      if (/Fatal error occurred|Emergency stop/.test(message)) continue;
      errors.push(`${file}, line ${line}: ${message}`);
      continue;
    }

    // ! TeX/LaTeX errors (e.g. "! Undefined control sequence.")
    if (/^!/.test(t)) {
      // The following "l.NN ..." line names the offending line, which is the
      // half of the message that says where the problem is.
      const context = lines
        .slice(i + 1, i + 4)
        .map((l) => l.trim())
        .find((l) => /^l\.\d+/.test(l));
      errors.push(context ? `${t}\n  ${context}` : t);
    }
    // ./file.tex:42: Error message
    else if (/^\.?\/?.*:\d+:/.test(t) && /error/i.test(t)) errors.push(t);
    // LaTeX Error
    else if (/LaTeX Error/i.test(t)) errors.push(t);
    // Package errors
    else if (/Package .* Error/i.test(t)) errors.push(t);
    // Missing file, in the forms that do not match the pattern above
    else if (/File .* not found/i.test(t)) errors.push(t);
    // Fatal error
    else if (/Fatal error/i.test(t)) errors.push(t);
    // Emergency stop
    else if (/Emergency stop/i.test(t)) errors.push(t);
  }

  return [...new Set(errors)];
}

// ── Check which engines are available ─────────────────────────
function getAvailableEngines() {
  const engines = ["pdflatex", "xelatex", "lualatex", "latex"];
  const available = [];
  const isWin = os.platform() === "win32";
  const command = isWin ? "where" : "which";

  for (const eng of engines) {
    try {
      require("child_process").execFileSync(command, [eng], { stdio: "pipe" });
      available.push(eng);
    } catch {
      // Engine not installed
    }
  }
  return available;
}

// ── Start server ──────────────────────────────────────────────
// ── Startup Cleanup ───────────────────────────────────────────
function cleanStaleJobs() {
  const tempDir = path.join(os.tmpdir(), "texer-jobs");
  if (!fs.existsSync(tempDir)) return;

  console.log(`[Cleanup] Checking for stale jobs in ${tempDir}`);
  const now = Date.now();
  let deletedCount = 0;

  try {
    const jobs = fs.readdirSync(tempDir);
    for (const job of jobs) {
      const jobPath = path.join(tempDir, job);
      try {
        const stats = fs.statSync(jobPath);
        if (now - stats.mtimeMs > CLEANUP_AGE_MS) {
          fs.rmSync(jobPath, { recursive: true, force: true });
          deletedCount++;
        }
      } catch (e) {
        // Ignore errors for individual files
      }
    }
    if (deletedCount > 0) {
      console.log(`[Cleanup] Removed ${deletedCount} stale job directories.`);
    }
  } catch (e) {
    console.error("[Cleanup] Error during cleanup:", e);
  }
}

// ── Start server ──────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Eneles Compiler Service running on port ${PORT}`);
  console.log(
    `Available engines: ${getAvailableEngines().join(", ") || "none (not in Docker?)"}`,
  );

  // Confirm the standalone `synctex` CLI is present (required for reverse
  // search). If this logs MISSING in deployment, the image needs the binary.
  try {
    const out = require("child_process")
      .execFileSync("synctex", ["--version"], { stdio: "pipe" })
      .toString()
      .split("\n")[0];
    console.log(`SyncTeX CLI: available (${out.trim()})`);
  } catch {
    console.warn(
      "SyncTeX CLI: MISSING. Reverse search will not work on this instance",
    );
  }

  // Run cleanup on startup
  cleanStaleJobs();
  // And every hour
  setInterval(cleanStaleJobs, 60 * 60 * 1000);
});

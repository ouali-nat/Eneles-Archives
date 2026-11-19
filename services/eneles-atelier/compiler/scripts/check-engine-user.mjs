#!/usr/bin/env node
// Checks that a document cannot read the compiler's own environment, where
// its secrets live. Run it against a compiler started from the Docker image:
//
//   docker build -t texer-compiler . && docker run --rm -p 3500:3500 texer-compiler
//   node scripts/check-engine-user.mjs http://localhost:3500
//
// The document spells /proc/ indirectly, which the text filter does not catch
// (and is not meant to: TeX can build any path). What has to stop it is TeX
// running as its own user (TEX_RUN_UID), which may not read another user's
// /proc/<pid>/environ. Exit code 0 means the environment was out of reach.
//
// Optional second argument: the compiler's process id, when it is not 1
// (it is 1 inside the container).

const url = (process.argv[2] || "http://localhost:3500").replace(/\/$/, "");
const pid = process.argv[3] || "1";

const tex = String.raw`\documentclass{article}
\begin{document}
\def\p{pr}\def\q{oc}
\IfFileExists{/\p\q/${pid}/environ}{\typeout{ENGINE-USER-CHECK: READABLE}}{\typeout{ENGINE-USER-CHECK: BLOCKED}}
Engine user check.
\end{document}
`;

const res = await fetch(`${url}/compile`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ files: [{ path: "main.tex", content: tex }], mainFile: "main.tex" }),
});
const body = await res.json().catch(() => ({}));
const log = String(body.log ?? body.logs ?? JSON.stringify(body));
const verdict = log.match(/ENGINE-USER-CHECK: (READABLE|BLOCKED)/)?.[1];

if (verdict === "BLOCKED") {
  console.log(`PASS: a document cannot open /proc/${pid}/environ (HTTP ${res.status}).`);
  process.exit(0);
}
if (verdict === "READABLE") {
  console.log(`FAIL: a document can open /proc/${pid}/environ. TeX is running as the compiler's own user.`);
  process.exit(1);
}
console.log(`UNKNOWN: the compile did not report a result (HTTP ${res.status}).`);
console.log(log.slice(0, 2000));
process.exit(2);

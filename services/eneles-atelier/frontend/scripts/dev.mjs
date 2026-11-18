// `npm run dev`: brings the manuals and the TikZ library in (scripts/sync-content.mjs), keeps them in step with the sibling docs/, learn/, and library/ folders while you edit, and runs the Next.js dev server. Extra arguments go to `next dev`.
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const node = process.execPath;
const sync = path.join(root, "scripts/sync-content.mjs");

execFileSync(node, [sync, "--soft"], { cwd: root, stdio: "inherit" });
const watcher = spawn(node, [sync, "--watch", "--soft"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
const next = spawn(node, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--turbopack", "-p", "2160", ...process.argv.slice(2)], { cwd: root, stdio: "inherit" });

const stop = () => {
  watcher.kill();
  next.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", (code) => {
  watcher.kill();
  process.exit(code ?? 0);
});

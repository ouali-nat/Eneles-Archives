// Copies the webpack build output (../dist) into ./public so it can be
// bundled by `pkg` as a plain relative asset path. Run automatically by
// `npm start` and `npm run build:exe`. Never needs to be run by hand.
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "..", "dist");
const dest = path.join(__dirname, "..", "public");

if (!fs.existsSync(src)) {
  console.error(`[texer-ppt] ${src} does not exist yet. Run "npm run build" in powerpoint/ first.`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`[texer-ppt] Copied ${src} -> ${dest}`);

// Copies the single packaged exe out to powerpoint/release/. That file, alone,
// is the entire distributable. No install scripts, no manifest.xml sitting
// next to it, nothing else: Eneles-PPT.exe installs itself on first run.
//
// Run `npm run release` from powerpoint/. It builds everything first.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const releaseDir = path.join(root, "release");
const src = path.join(root, "app", "release", "Eneles-PPT.exe");

if (!fs.existsSync(src)) {
  console.error(`[texer-ppt] Missing ${src}`);
  console.error(`[texer-ppt] Run "npm run build" in powerpoint/ and "npm run build:exe" in powerpoint/app/ first.`);
  process.exit(1);
}

fs.mkdirSync(releaseDir, { recursive: true });
fs.copyFileSync(src, path.join(releaseDir, "Eneles-PPT.exe"));

console.log(`[texer-ppt] Release ready: ${path.join(releaseDir, "Eneles-PPT.exe")}`);
console.log(`[texer-ppt] That's the entire distributable. Hand it to a user; double-clicking it is the whole install.`);

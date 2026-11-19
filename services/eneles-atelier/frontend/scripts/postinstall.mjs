// Runs after `npm install`. Copies three sets of static assets out of node_modules into public/, where the browser can fetch them. All are generated, so none is committed.
//   1. The pdf.js worker, so the PDF viewer does not depend on a CDN.
//   2. Material Icon Theme (MIT): every icon as an SVG, plus a small manifest that maps file names, extensions, and folder names to an icon. The file tree reads the manifest at runtime (components/editor/FileTypeIcon.tsx).
//   3. Country flags (flag-icons, MIT), one SVG per ISO code, for the admin panel. Emoji flags do not draw on every system; these do.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

fs.copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.mjs");

const { generateManifest } = require("material-icon-theme");
const manifest = generateManifest();
const source = path.join(path.dirname(require.resolve("material-icon-theme/package.json")), "icons");
const target = "public/file-icons";
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const file of fs.readdirSync(source)) if (file.endsWith(".svg")) fs.copyFileSync(path.join(source, file), path.join(target, file));

// Only what the tree needs. An expanded folder's icon is always "<icon>-open", so the expanded tables are left out.
const pick = (m) => ({ extensions: m.fileExtensions ?? {}, names: m.fileNames ?? {}, folders: m.folderNames ?? {} });
fs.writeFileSync(
  path.join(target, "manifest.json"),
  JSON.stringify({ file: manifest.file, folder: manifest.folder, ...pick(manifest), light: pick(manifest.light ?? {}) }),
);
console.log(`file icons: ${fs.readdirSync(target).length - 1} icons copied to ${target}`);

const flags = path.join(path.dirname(require.resolve("flag-icons/package.json")), "flags", "4x3");
fs.rmSync("public/flags", { recursive: true, force: true });
fs.mkdirSync("public/flags", { recursive: true });
for (const file of fs.readdirSync(flags)) if (/^[a-z]{2}\.svg$/.test(file)) fs.copyFileSync(path.join(flags, file), path.join("public/flags", file));
console.log(`flags: ${fs.readdirSync("public/flags").length} copied to public/flags`);

#!/usr/bin/env node
/**
 * Writes backend/scripts/tikz-examples.json from the library catalog (lib/tikz/libraries.ts), for the bucket prebuild (backend/scripts/prebuild-tikz-components.mjs).
 * Run from frontend/: node scripts/sync-tikz-examples.mjs
 */
import path from "node:path";
import fs from "node:fs";
import { createJiti } from "jiti";

const ROOT = path.resolve(import.meta.dirname, "..");
const jiti = createJiti(import.meta.url, { alias: { "@": ROOT } });
const { getTikzExamplesForPrebuild } = await jiti.import(path.join(ROOT, "lib/tikz/libraries.ts"));
const data = getTikzExamplesForPrebuild();
const outPath = path.join(ROOT, "../backend/scripts/tikz-examples.json");
fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
const total = data.reduce((s, l) => s + l.examples.length, 0);
console.log(`Wrote ${data.length} libraries, ${total} examples to ${outPath}`);

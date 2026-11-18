#!/usr/bin/env node
/**
 * Output latex-templates.json for api prebuild.
 * Run from api/: node ../web/scripts/sync-latex-templates.mjs
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../../api/package.json'));

require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS' } });
const { LATEX_TEMPLATES } = require(path.join(__dirname, '../lib/latex-templates.ts'));
const data = LATEX_TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  content: t.content,
  mainFile: t.mainFile ?? 'main.tex',
}));
const outPath = path.join(__dirname, '../../api/scripts/latex-templates.json');
fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
console.log(`Wrote ${data.length} templates to ${outPath}`);

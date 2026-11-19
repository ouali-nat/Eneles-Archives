#!/usr/bin/env node
/**
 * Prebuild: Compile all TikZ library examples → PNG → upload to builds bucket.
 * Path: tikz-components/{libraryId}/{exampleId}.png (permanent, exclude from lifecycle).
 *
 * Requires: COMPILER_URL, BUILDS_BUCKET_NAME, BUILDS_BUCKET_ACCESS_KEY_ID, BUILDS_BUCKET_SECRET_ACCESS_KEY
 * Run: node scripts/prebuild-tikz-components.mjs (from api/) or npm run prebuild:tikz
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const TIKZ_PREFIX = 'tikz-components';

/**
 * The compiler rate limits editor traffic to one request per second per IP,
 * and exempts prebuild runs. That exemption is only honoured when the caller
 * proves it is internal: `X-Request-Source` is ignored unless
 * `X-Internal-Token` matches the compiler's COMPILER_INTERNAL_SECRET.
 *
 * Without the token this script is treated as an anonymous editor client and
 * most of the run fails with "Rate limit exceeded", which is what a bare
 * `X-Request-Source` header bought us previously.
 */
const INTERNAL_SECRET = process.env.COMPILER_INTERNAL_SECRET || '';

/** Retry a 429 with backoff, so a throttled request is never a lost example. */
async function withRetry(label, fn, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!err.rateLimited || attempt === attempts - 1) throw err;
      // 1s, 2s, 4s, 8s. The limiter's window is one second, so the first
      // retry usually clears it.
      const waitMs = 1000 * 2 ** attempt;
      process.stdout.write(`\n[retry ${attempt + 1}/${attempts - 1}] ${label} in ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

function constructLatex(source) {
  if (source.includes('\\documentclass')) return source.trim();
  const preamble = [
    '\\documentclass{article}',
    '\\usepackage[paperwidth=20cm,paperheight=20cm,margin=0cm]{geometry}',
    '\\usepackage{xcolor}',
    '\\nopagecolor',
    '\\usepackage{amsmath}',
    '\\usepackage{amssymb}',
    '\\usepackage{tikz}',
    '\\pagestyle{empty}',
  ];
  const lines = source.split('\n');
  const body = [];
  const preRegex = /^\\(usepackage|usetikzlibrary|usepgfplotslibrary|pgfplotsset|tdplotset|tikzset|ctikzset)/;
  for (const line of lines) {
    if (line.trim().match(preRegex)) preamble.push(line.trim());
    else body.push(line);
  }
  return `${preamble.join('\n')}\n\n\\begin{document}\n\\vspace*{\\fill}\\centering\n${body.join('\n')}\n\\vspace*{\\fill}\\end{document}`;
}

async function compileTikz(compilerUrl, latex) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Request-Source': 'tikz-components-prebuild',
  };
  if (INTERNAL_SECRET) headers['X-Internal-Token'] = INTERNAL_SECRET;

  const res = await fetch(`${compilerUrl}/compile`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      files: [{ path: 'main.tex', content: latex }],
      mainFile: 'main.tex',
      engine: 'pdflatex',
      stopOnFirstError: true,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json();
  if (!res.ok || !data.success || !data.pdf) {
    const message = data.errors?.[0] || data.log?.slice(-500) || `HTTP ${res.status}`;
    const error = new Error(message);
    // Flagged so withRetry can distinguish throttling from a real LaTeX error,
    // which no amount of retrying will fix.
    error.rateLimited = res.status === 429;
    throw error;
  }
  return Buffer.from(data.pdf, 'base64');
}

async function pdfToPng(pdfBuffer) {
  const { pdf } = await import('pdf-to-img');
  const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
  const doc = await pdf(dataUrl, { scale: 2 });
  const png = await doc.getPage(1);
  return png;
}

async function uploadToS3(pngBuffer, key) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const region = process.env.BUILDS_BUCKET_REGION;
  const bucket = process.env.BUILDS_BUCKET_NAME;
  const accessKeyId = process.env.BUILDS_BUCKET_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BUILDS_BUCKET_SECRET_ACCESS_KEY;
  const endpoint = process.env.BUILDS_BUCKET_ENDPOINT_URL;

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('BUILDS_BUCKET_NAME, BUILDS_BUCKET_ACCESS_KEY_ID, BUILDS_BUCKET_SECRET_ACCESS_KEY required');
  }

  const client = new S3Client({
    region: region || 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
    endpoint: endpoint || undefined,
    forcePathStyle: !!endpoint,
  });

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: pngBuffer,
    ContentType: 'image/png',
  }));
  return key;
}

async function main() {
  const jsonPath = path.join(__dirname, 'tikz-examples.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('Create api/scripts/tikz-examples.json (see web/lib/tikz-libraries.ts)');
    process.exit(1);
  }
  const tikzLibraries = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const compilerUrl = (process.env.COMPILER_URL || 'http://localhost:3500').replace(/\/+$/, '');
  if (!compilerUrl.startsWith('http')) {
    throw new Error('COMPILER_URL must be set (e.g. http://localhost:3500)');
  }

  const count = tikzLibraries.reduce((s, l) => s + l.examples.length, 0);
  console.log(`[TikZ prebuild] Compiling ${count} examples to ${TIKZ_PREFIX}/...`);

  if (!INTERNAL_SECRET) {
    console.warn(
      '[TikZ prebuild] WARNING: COMPILER_INTERNAL_SECRET is not set.\n' +
        '  Without it the compiler cannot tell this apart from anonymous editor\n' +
        '  traffic and applies its 1 request/second limit. The run will still\n' +
        '  complete via retry backoff, but it will be far slower.\n' +
        '  Set COMPILER_INTERNAL_SECRET to the same value the compiler uses.\n',
    );
  }

  let ok = 0;
  let fail = 0;

  for (const lib of tikzLibraries) {
    for (const ex of lib.examples) {
      const key = `${TIKZ_PREFIX}/${lib.id}/${ex.id}.png`;
      const label = `${lib.id}/${ex.id}`;
      try {
        const latex = constructLatex(ex.source);
        const pdfBuffer = await withRetry(label, () =>
          compileTikz(compilerUrl, latex),
        );
        const pngBuffer = await pdfToPng(pdfBuffer);
        await uploadToS3(pngBuffer, key);
        ok++;
        process.stdout.write('.');
      } catch (err) {
        fail++;
        console.error(`\n[FAIL] ${label}: ${err.message}`);
      }
    }
  }

  console.log(`\n[TikZ prebuild] Done: ${ok} ok, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

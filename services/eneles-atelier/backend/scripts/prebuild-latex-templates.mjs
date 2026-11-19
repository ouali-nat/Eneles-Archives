#!/usr/bin/env node
/**
 * Prebuild: Compile all LaTeX templates → PDF + first-page thumbnail → upload to builds bucket.
 * Path: latex-templates/{templateId}.pdf, latex-templates/{templateId}-thumb.png
 * (permanent, exclude from lifecycle, same as tikz-components)
 *
 * Requires: COMPILER_URL, BUILDS_BUCKET_NAME, BUILDS_BUCKET_ACCESS_KEY_ID, BUILDS_BUCKET_SECRET_ACCESS_KEY
 * Run: node scripts/prebuild-latex-templates.mjs (from api/) or npm run prebuild:templates
 *
 * Sync templates first: node ../web/scripts/sync-latex-templates.mjs
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const TEMPLATES_PREFIX = 'latex-templates';

/**
 * The compiler exempts prebuild runs from its per-IP rate limit, but only
 * honours `X-Request-Source` when `X-Internal-Token` matches its
 * COMPILER_INTERNAL_SECRET. Without the token this is treated as anonymous
 * editor traffic and throttled to one request per second.
 */
const INTERNAL_SECRET = process.env.COMPILER_INTERNAL_SECRET || '';

/** Retry a 429 with backoff, so a throttled request is never a lost template. */
async function withRetry(label, fn, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!err.rateLimited || attempt === attempts - 1) throw err;
      const waitMs = 1000 * 2 ** attempt;
      process.stdout.write(`\n[retry ${attempt + 1}/${attempts - 1}] ${label} in ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

function formatFetchError(err) {
  const cause = err?.cause?.code || err?.cause?.errno || err?.code;
  const msg = err?.message || 'Unknown error';
  if (cause === 'ECONNREFUSED' || cause === 'ENOTFOUND') {
    return `${msg}. Is the compiler running? Try: cd compiler ; npm run dev (or docker)`;
  }
  return cause ? `${msg} (${cause})` : msg;
}

async function compileLatex(compilerUrl, latex, mainFile) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Request-Source': 'latex-templates-prebuild',
  };
  if (INTERNAL_SECRET) headers['X-Internal-Token'] = INTERNAL_SECRET;

  const res = await fetch(`${compilerUrl}/compile`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      files: [{ path: mainFile, content: latex }],
      mainFile,
      engine: 'pdflatex',
      stopOnFirstError: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json();
  if (!res.ok || !data.success || !data.pdf) {
    const message = data.errors?.[0] || data.log?.slice(-500) || `HTTP ${res.status}`;
    const error = new Error(message);
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

async function uploadToS3(buffer, key, contentType) {
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
    Body: buffer,
    ContentType: contentType,
  }));
  return key;
}

async function main() {
  const jsonPath = path.join(__dirname, 'latex-templates.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('Run sync first: node ../web/scripts/sync-latex-templates.mjs');
    process.exit(1);
  }
  const templates = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const compilerUrl = (process.env.COMPILER_URL || 'http://localhost:3500').replace(/\/+$/, '');
  if (!compilerUrl.startsWith('http')) {
    throw new Error('COMPILER_URL must be set (e.g. http://localhost:3500)');
  }

  console.log(`[LaTeX templates prebuild] Compiling ${templates.length} templates to ${TEMPLATES_PREFIX}/...`);

  // Preflight: check compiler is reachable
  try {
    const health = await fetch(`${compilerUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (!health.ok) throw new Error(`Compiler returned ${health.status}`);
  } catch (err) {
    console.error(`[LaTeX templates prebuild] Compiler not reachable at ${compilerUrl}`);
    console.error(`  ${formatFetchError(err)}`);
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;

  if (!INTERNAL_SECRET) {
    console.warn(
      '\n[LaTeX templates prebuild] WARNING: COMPILER_INTERNAL_SECRET is not set.\n' +
        '  Without it the compiler cannot tell this apart from anonymous editor\n' +
        '  traffic and applies its 1 request/second limit. The run will still\n' +
        '  complete via retry backoff, but it will be far slower.\n',
    );
  }

  for (const t of templates) {
    try {
      const pdfBuffer = await withRetry(t.id, () =>
        compileLatex(compilerUrl, t.content, t.mainFile),
      );
      const pdfKey = `${TEMPLATES_PREFIX}/${t.id}.pdf`;
      await uploadToS3(pdfBuffer, pdfKey, 'application/pdf');

      const pngBuffer = await pdfToPng(pdfBuffer);
      const thumbKey = `${TEMPLATES_PREFIX}/${t.id}-thumb.png`;
      await uploadToS3(pngBuffer, thumbKey, 'image/png');

      ok++;
      process.stdout.write('.');
    } catch (err) {
      fail++;
      const msg = err.message?.includes('fetch') ? formatFetchError(err) : err.message;
      console.error(`\n[FAIL] ${t.id}: ${msg}`);
    }
  }

  console.log(`\n[LaTeX templates prebuild] Done: ${ok} ok, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

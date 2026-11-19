import { gunzipSync } from 'zlib';

interface CompiledFile {
  path: string;
  content: string | null;
  encoding?: 'base64';
}

/** Above this the sources are left out and the editor falls back to its own copy. */
const MAX_SOURCES_BYTES = 6 * 1024 * 1024;

/** `/tmp/job/./a/../b.tex` → `/tmp/job/b.tex`. */
function normalize(name: string): string {
  const out: string[] = [];
  for (const part of name.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && out.length > 0) out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * The text of every project file TeX read during a compile, exactly as it was compiled, keyed by project path.
 *
 * SyncTeX's line numbers count the lines of the compiled text. That text is not always what the editor holds: the compile adds lines to the main file's preamble (macros, theorem environments), and people keep typing while a compile runs. Sending the compiled text back lets the editor line the two up and jump to the right line in both directions instead of one that is off by however many lines were added.
 *
 * Only files named in the SyncTeX data are returned, so a large bibliography or data file that TeX never typeset from does not travel twice.
 */
export function compiledSourcesFor(
  synctexBase64: string,
  files: CompiledFile[],
): Record<string, string> | undefined {
  let data: Buffer;
  try {
    data = gunzipSync(Buffer.from(synctexBase64, 'base64'));
  } catch {
    return undefined;
  }

  // Input records sit at the start of a line, in the preamble and between pages. Searching the bytes is far cheaper than decoding a file that can run to tens of megabytes.
  const names: string[] = [];
  const marker = Buffer.from('\nInput:');
  let at = data.subarray(0, 6).toString('latin1') === 'Input:' ? 0 : -1;
  if (at < 0) at = data.indexOf(marker);
  while (at >= 0) {
    const start = at + (data[at] === 0x0a ? 1 : 0);
    let end = data.indexOf(0x0a, start);
    if (end < 0) end = data.length;
    const line = data.subarray(start, end).toString('utf8');
    const colon = line.indexOf(':', 6);
    if (colon > 0) names.push(normalize(line.slice(colon + 1).trim()));
    at = data.indexOf(marker, end);
  }

  const sources: Record<string, string> = {};
  let total = 0;
  for (const file of files) {
    if (file.encoding === 'base64' || file.content === null) continue;
    const path = normalize(file.path);
    if (!names.some((name) => name === path || name.endsWith('/' + path))) {
      continue;
    }
    total += file.content.length;
    if (total > MAX_SOURCES_BYTES) return undefined;
    sources[file.path] = file.content;
  }
  return sources;
}

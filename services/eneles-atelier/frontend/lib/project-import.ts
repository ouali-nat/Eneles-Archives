/**
 * Bringing a folder of files into a new project: a ZIP someone uploads, or
 * an arXiv source archive. Text files become editable files, everything else
 * (figures, PDFs, fonts) is uploaded as is, and folders are kept.
 */
import JSZip from "jszip";
import { API_URL, apiFetch, projectsAPI, type Project } from "@/lib/api";

export interface ImportEntry {
  path: string;
  data: Uint8Array;
}

const TEXT_FILE =
  /\.(tex|ltx|bib|bst|bbx|cbx|lbx|cls|sty|clo|cfg|def|dtx|ins|ist|txt|md|markdown|csv|tsv|dat|json|ya?ml|xml|lua|py|m|r|tikz|pgf|gp|gnuplot|bbl|latexmkrc)$/i;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Text is what decodes as UTF-8 and holds no NUL bytes. */
export function isText(path: string, data: Uint8Array): boolean {
  if (TEXT_FILE.test(path)) return true;
  if (data.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(0, 65536));
    return true;
  } catch {
    return false;
  }
}

/** A path the API accepts: relative, no "..", no hidden or system folders. */
function cleanPath(path: string): string | null {
  const p = path.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!p || p.endsWith("/")) return null;
  const parts = p.split("/");
  if (parts.some((s) => !s || s === "." || s === ".." || s.startsWith("."))) return null;
  if (parts[0] === "__MACOSX") return null;
  if (p.length > 300) return null;
  return p;
}

/** The files in a ZIP, without the one folder many ZIPs wrap everything in. */
export async function entriesFromZip(source: Blob | Uint8Array): Promise<ImportEntry[]> {
  const zip = await JSZip.loadAsync(source);
  const entries: ImportEntry[] = [];
  await Promise.all(
    Object.values(zip.files)
      .filter((f) => !f.dir)
      .map(async (f) => {
        const path = cleanPath(f.name);
        if (path) entries.push({ path, data: await f.async("uint8array") });
      }),
  );
  const tops = new Set(entries.map((e) => e.path.split("/")[0]));
  if (tops.size === 1 && entries.every((e) => e.path.includes("/"))) {
    const prefix = `${[...tops][0]}/`;
    for (const e of entries) e.path = e.path.slice(prefix.length);
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/** The document to compile: main.tex if there is one, else a file with \documentclass. */
export function pickMain(entries: ImportEntry[]): ImportEntry | null {
  const tex = entries.filter((e) => e.path.toLowerCase().endsWith(".tex"));
  const hasClass = (e: ImportEntry) => /\\documentclass/.test(new TextDecoder().decode(e.data.subarray(0, 200_000)));
  return (
    tex.find((e) => e.path === "main.tex" && hasClass(e)) ??
    tex.find((e) => !e.path.includes("/") && hasClass(e)) ??
    tex.find(hasClass) ??
    tex[0] ??
    null
  );
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(run));
  }
}

/**
 * Create a project from imported files. The chosen main document becomes
 * main.tex; the rest keep their paths. Returns the project and the files
 * that could not be brought in, with the reason.
 */
export async function importProject(
  title: string,
  entries: ImportEntry[],
  onProgress?: (done: number, total: number) => void,
  /** Attach the new project to another one as a reference paper instead of listing it as a project. */
  reference?: { referenceOf: string; arxivId?: string },
): Promise<{ project: Project; skipped: { path: string; reason: string }[] }> {
  const main = pickMain(entries);
  if (!main) throw new Error("There is no .tex file in it.");
  // A main document in a subfolder: its folder becomes the project's root,
  // so its relative \input and \includegraphics paths still work.
  const base = main.path.includes("/") ? main.path.slice(0, main.path.lastIndexOf("/") + 1) : "";
  const rest = entries
    .filter((e) => e !== main && e.path.startsWith(base))
    .map((e) => ({ ...e, path: e.path.slice(base.length) }))
    .filter((e) => e.path !== "main.tex");

  const project = await projectsAPI.createProject(title, new TextDecoder().decode(main.data), reference);
  const skipped: { path: string; reason: string }[] = entries
    .filter((e) => e !== main && !e.path.startsWith(base))
    .map((e) => ({ path: e.path, reason: "outside the main document's folder" }));

  const folders = new Set<string>();
  for (const e of rest) {
    const parts = e.path.split("/");
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  }
  for (const folder of [...folders].sort((a, b) => a.split("/").length - b.split("/").length)) {
    await projectsAPI.createFile(project.uid, { path: folder, isFolder: true }).catch(() => undefined);
  }

  let done = 0;
  await inBatches(rest, 4, async (e) => {
    try {
      if (e.data.length > MAX_FILE_BYTES) {
        skipped.push({ path: e.path, reason: "larger than 10 MB" });
      } else if (isText(e.path, e.data)) {
        await projectsAPI.createFile(project.uid, { path: e.path, content: new TextDecoder().decode(e.data) });
      } else {
        await projectsAPI.uploadFile(project.uid, new Blob([e.data as BlobPart]), e.path);
      }
    } catch (err) {
      skipped.push({ path: e.path, reason: err instanceof Error ? err.message : "could not be saved" });
    }
    onProgress?.(++done, rest.length);
  });
  return { project, skipped };
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A tar archive's regular files (ustar, with GNU and pax long names). */
function readTar(tar: Uint8Array): ImportEntry[] {
  const out: ImportEntry[] = [];
  const text = (from: number, len: number) => {
    const bytes = tar.subarray(from, from + len);
    const end = bytes.indexOf(0);
    return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end));
  };
  let offset = 0;
  let longName: string | null = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(text(offset + 124, 12).trim() || "0", 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    const prefix = text(offset + 345, 155);
    let name = longName ?? (prefix ? `${prefix}/${text(offset, 100)}` : text(offset, 100));
    longName = null;
    const body = tar.subarray(offset + 512, offset + 512 + size);
    if (type === "L") {
      longName = new TextDecoder().decode(body).replace(/\0+$/, "");
    } else if (type === "x") {
      const m = /\d+ path=([^\n]*)\n/.exec(new TextDecoder().decode(body));
      if (m) longName = m[1];
    } else if (type === "0" || type === "\0") {
      name = cleanPath(name) ?? "";
      if (name) out.push({ path: name, data: body.slice() });
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/**
 * An arXiv source download: a gzipped tar of the paper's files, or a single
 * gzipped .tex file, or (rarely) a ZIP.
 */
export async function entriesFromArchive(data: Uint8Array): Promise<ImportEntry[]> {
  if (data[0] === 0x50 && data[1] === 0x4b) return entriesFromZip(data);
  const raw = data[0] === 0x1f && data[1] === 0x8b ? await gunzip(data) : data;
  const isTar = new TextDecoder().decode(raw.subarray(257, 262)) === "ustar";
  if (isTar) return readTar(raw);
  return [{ path: "main.tex", data: raw }];
}

export type ArxivSource =
  | { ok: true; title: string; entries: ImportEntry[] }
  | { ok: false; needsVersion: true; message: string }
  | { ok: false; needsVersion?: false; error: string };

/** Download an arXiv paper's source by its identifier and unpack it. */
export async function fetchArxivSource(id: string): Promise<ArxivSource> {
  const res = await apiFetch(`${API_URL}/arxiv?id=${encodeURIComponent(id)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) return { ok: false, error: json.error || json.message || "Could not fetch that paper from arXiv." };
  if (json.needsVersion) return { ok: false, needsVersion: true, message: json.message };
  const binary = atob(json.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  try {
    const entries = await entriesFromArchive(bytes);
    if (!pickMain(entries)) return { ok: false, error: "This paper has no LaTeX source on arXiv." };
    return { ok: true, title: json.title || id, entries };
  } catch {
    return { ok: false, error: "Could not unpack the paper's source." };
  }
}

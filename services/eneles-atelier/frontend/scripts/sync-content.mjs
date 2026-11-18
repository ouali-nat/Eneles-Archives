// Brings the two manuals and the TikZ library into the frontend. The guides (how to use Eneles), the lessons (how to write LaTeX), and the library's diagrams are written in their own repositories, `docs`, `learn`, and `library`; this copies them into content/, where the site's pages import them, and writes the navigation each one's sidebar, search, and overview are built from. The library's current preview images are copied to public/tikz-previews/, each with a version for the dark theme beside it.
//
//   node scripts/sync-content.mjs            once (runs before `next dev` and `next build`)
//   node scripts/sync-content.mjs --watch    and again whenever a file in a sibling folder changes
//   node scripts/sync-content.mjs --soft     never fail: on an error, keep what is there or write empty manuals (used after `npm install`)
//
// Where each manual comes from, first match wins:
//   1. The folder beside this one (../docs, ../learn, ../library), when it exists. This is the setup for writing: edit a page there and the site reloads.
//   2. A Git repository, cloned at build time: DOCS_REPO, LEARN_REPO, and LIBRARY_REPO (any URL `git clone` accepts), at DOCS_REF, LEARN_REF, and LIBRARY_REF (default main). For a private repository over SSH, put its read-only deploy key in DOCS_DEPLOY_KEY, LEARN_DEPLOY_KEY, or LIBRARY_DEPLOY_KEY (the private key's text, or that text in base64).
// Set CONTENT_SOURCE=git to skip the sibling folders.
//
// content/ and public/tikz-previews/ are generated and not committed.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { darkPreview } from "./dark-preview.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "content");
const CACHE = path.join(ROOT, ".content-cache");

const MANUALS = {
  docs: { sibling: "../docs", pagesDir: "pages", repo: process.env.DOCS_REPO || "https://github.com/Eneles-org/docs.git", ref: process.env.DOCS_REF || "main", key: process.env.DOCS_DEPLOY_KEY },
  learn: { sibling: "../learn", pagesDir: "lessons", repo: process.env.LEARN_REPO || "https://github.com/Eneles-org/learn.git", ref: process.env.LEARN_REF || "main", key: process.env.LEARN_DEPLOY_KEY },
  library: { sibling: "../library", repo: process.env.LIBRARY_REPO || "https://github.com/Eneles-org/library.git", ref: process.env.LIBRARY_REF || "main", key: process.env.LIBRARY_DEPLOY_KEY },
};
const PREVIEWS = path.join(ROOT, "public", "tikz-previews");

const SLUG = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;
const args = new Set(process.argv.slice(2));

class ContentError extends Error {}
const fail = (message) => {
  throw new ContentError(message);
};

/** The folder to read a manual from: the sibling when there is one, otherwise a fresh shallow clone. */
function locate(name) {
  const manual = MANUALS[name];
  const sibling = path.resolve(ROOT, manual.sibling);
  if (process.env.CONTENT_SOURCE !== "git" && fs.existsSync(path.join(sibling, "nav.json"))) return { dir: sibling, from: manual.sibling };

  const target = path.join(CACHE, name);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(CACHE, { recursive: true });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (manual.key) {
    const keyFile = path.join(CACHE, `${name}.key`);
    const text = manual.key.includes("BEGIN") ? manual.key : Buffer.from(manual.key, "base64").toString("utf8");
    fs.writeFileSync(keyFile, text.replace(/\\n/g, "\n").trim() + "\n", { mode: 0o600 });
    env.GIT_SSH_COMMAND = `ssh -i "${keyFile}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
  }
  try {
    execFileSync("git", ["clone", "--quiet", "--depth", "1", "--branch", manual.ref, manual.repo, target], { env, stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    // The URL can carry a token; never print it.
    const where = manual.repo.replace(/\/\/[^@/]+@/, "//");
    fail(`Could not clone the ${name} manual from ${where} (${manual.ref}): ${String(err.stderr || err.message).trim().split("\n").find((line) => line.startsWith("fatal:")) ?? "git clone failed"}`);
  } finally {
    if (manual.key) fs.rmSync(path.join(CACHE, `${name}.key`), { force: true });
  }
  return { dir: target, from: `${manual.repo.replace(/\/\/[^@/]+@/, "//")}#${manual.ref}` };
}

/** One page: its frontmatter as data and its body as MDX. */
function readPage(file, slug) {
  if (!SLUG.test(slug)) fail(`"${slug}" is not a usable page name. Use lower-case letters, digits, and hyphens.`);
  if (!fs.existsSync(file)) fail(`nav.json lists "${slug}", but ${path.relative(path.dirname(path.dirname(file)), file)} does not exist.`);
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) fail(`${slug}.mdx has no frontmatter. It needs at least a title and a description between two --- lines.`);
  let meta;
  try {
    meta = parseYaml(match[1]) ?? {};
  } catch (err) {
    fail(`${slug}.mdx: the frontmatter is not valid YAML (${err.message.split("\n")[0]}).`);
  }
  for (const field of ["title", "description"]) if (typeof meta[field] !== "string" || !meta[field].trim()) fail(`${slug}.mdx: the frontmatter needs a ${field}.`);
  const body = text.slice(match[0].length).replace(/^\n+/, "");
  // Pages are text and the components the site hands them (see mdx-components.tsx). They do not import the site's code or export anything: fenced code is skipped, so examples can show either.
  const prose = body.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, "");
  const statement = /^(import|export)\s/m.exec(prose);
  if (statement) fail(`${slug}.mdx has an ${statement[1]} statement. Pages cannot import or export; use the components listed in the README.`);
  const page = { slug, title: meta.title.trim(), description: meta.description.trim() };
  // The longer description for search results and link previews (120 to 160 characters). Pages without one fall back to the description.
  if (typeof meta.summary === "string" && meta.summary.trim()) page.summary = meta.summary.trim();
  if (Array.isArray(meta.keywords) && meta.keywords.length) page.keywords = meta.keywords.map(String);
  if (typeof meta.method === "string") page.method = meta.method.toUpperCase();
  return { page, body };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    fail(`${file}: ${err.message}`);
  }
}

/** Every .mdx under a folder, as slugs. */
function slugsIn(dir, prefix = "") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? slugsIn(path.join(dir, entry.name), `${prefix}${entry.name}/`) : entry.name.endsWith(".mdx") ? [`${prefix}${entry.name.slice(0, -4)}`] : []));
}

/**
 * The TikZ library: nav.json orders categories, packages, and examples; packages/<id>/package.json describes a package; packages/<id>/<example>.tex is an example, with a comment header (Name, Description, Tags, and optionally Engine) above its source. Writes content/library.json, which lib/tikz/libraries.ts reads, and copies each example's preview image when previews/keys.json says it was made from the example as it is now.
 */
function syncLibrary(dir, from) {
  const nav = readJson(path.join(dir, "nav.json"));
  if (!Array.isArray(nav.categories)) fail("library/nav.json needs a categories list.");
  const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const keysFile = path.join(dir, "previews", "keys.json");
  const keys = fs.existsSync(keysFile) ? readJson(keysFile) : {};
  const images = new Set();
  let count = 0;
  let withPreview = 0;
  const seen = new Set();
  const categories = nav.categories.map((category) => ({
    title: String(category.title),
    packages: (category.packages ?? []).map((entry) => {
      const id = String(entry.id ?? "");
      if (!ID.test(id)) fail(`library: "${id}" is not a usable package id.`);
      if (seen.has(id)) fail(`library/nav.json lists the package "${id}" twice.`);
      seen.add(id);
      const meta = readJson(path.join(dir, "packages", id, "package.json"));
      for (const field of ["name", "description", "ctanUrl"]) if (typeof meta[field] !== "string" || !meta[field].trim()) fail(`library: packages/${id}/package.json needs a ${field}.`);
      const examples = (entry.examples ?? []).map((exId) => {
        if (!ID.test(exId)) fail(`library: "${id}/${exId}" is not a usable example id.`);
        const file = path.join(dir, "packages", id, `${exId}.tex`);
        if (!fs.existsSync(file)) fail(`library/nav.json lists "${id}/${exId}", but packages/${id}/${exId}.tex does not exist.`);
        const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
        const header = /^((?:%[^\n]*\n)+)\n?/.exec(text);
        const head = {};
        for (const line of (header?.[1] ?? "").split("\n")) {
          const m = /^%\s*(Name|Description|Tags|Engine):\s*(.*)$/.exec(line);
          if (m) head[m[1].toLowerCase()] = m[2].trim();
        }
        if (!head.name || !head.description) fail(`library: packages/${id}/${exId}.tex needs "% Name:" and "% Description:" lines at the top.`);
        const example = { id: exId, name: head.name, description: head.description, tags: (head.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean), source: text.slice(header ? header[0].length : 0).trim() };
        if (head.engine) example.engine = head.engine;
        // The image is used only when it was made from this exact file (library/scripts/check.mjs --previews).
        const key = createHash("sha256").update(text).digest("hex").slice(0, 12);
        const image = path.join(dir, "previews", id, `${exId}.png`);
        if (keys[`${id}/${exId}`] === key && fs.existsSync(image)) {
          const published = `${id}/${exId}.${key}.png`;
          const target = path.join(PREVIEWS, published);
          if (!fs.existsSync(target)) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(image, target);
          }
          images.add(published);
          example.preview = `/tikz-previews/${published}`;
          withPreview++;
          // The dark theme's version: the same figure on a transparent ground, its colors kept and its black ink made light (scripts/dark-preview.mjs). Made once per image, like the copy above.
          const darkPublished = `${id}/${exId}.${key}.dark.png`;
          const darkTarget = path.join(PREVIEWS, darkPublished);
          if (!fs.existsSync(darkTarget)) {
            const dark = darkPreview(fs.readFileSync(image));
            if (dark) fs.writeFileSync(darkTarget, dark);
          }
          if (fs.existsSync(darkTarget)) {
            images.add(darkPublished);
            example.previewDark = `/tikz-previews/${darkPublished}`;
          }
        }
        count++;
        return example;
      });
      const pkg = { id, name: meta.name.trim(), description: meta.description.trim(), category: String(category.title), ctanUrl: meta.ctanUrl, tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [], examples };
      if (meta.custom === true) pkg.custom = true;
      if (typeof meta.engine === "string") pkg.engine = meta.engine;
      return pkg;
    }),
  }));
  // Images of examples that changed or went away are removed.
  if (fs.existsSync(PREVIEWS)) {
    for (const pkg of fs.readdirSync(PREVIEWS)) {
      const folder = path.join(PREVIEWS, pkg);
      if (!fs.statSync(folder).isDirectory()) continue;
      for (const file of fs.readdirSync(folder)) if (!images.has(`${pkg}/${file}`)) fs.rmSync(path.join(folder, file));
      if (!fs.readdirSync(folder).length) fs.rmSync(folder, { recursive: true });
    }
  }
  writeIfChanged(path.join(OUT, "library.json"), JSON.stringify({ categories }, null, 2) + "\n");
  console.log(`content: library: ${count} examples in ${seen.size} packages (${withPreview} with a preview image, each also in a dark version) from ${from}`);
}

function sync(name) {
  const manual = MANUALS[name];
  const { dir, from } = locate(name);
  if (name === "library") return syncLibrary(dir, from);
  const nav = readJson(path.join(dir, "nav.json"));
  const pagesDir = path.join(dir, manual.pagesDir);
  const bodies = new Map();
  const take = (slug) => {
    if (bodies.has(slug)) fail(`nav.json lists "${slug}" twice.`);
    const { page, body } = readPage(path.join(pagesDir, `${slug}.mdx`), slug);
    bodies.set(slug, body);
    return page;
  };

  let manifest;
  if (name === "docs") {
    if (!Array.isArray(nav.groups)) fail("docs/nav.json needs a groups list.");
    // A string is a page in pages/. An object is a page built into the site (the overview pages), listed here so it has a place in the sidebar.
    manifest = { groups: nav.groups.map((group) => ({ title: String(group.title), items: (group.pages ?? []).map((entry) => (typeof entry === "string" ? take(entry) : { slug: String(entry.slug ?? ""), title: String(entry.title), description: String(entry.description ?? ""), keywords: entry.keywords ?? [], builtIn: true })) })) };
  } else {
    if (!Array.isArray(nav.tracks)) fail("learn/nav.json needs a tracks list.");
    manifest = { tracks: nav.tracks.map((track) => ({ id: String(track.id), title: String(track.title), description: String(track.description ?? ""), lessons: (track.lessons ?? []).map(take) })) };
  }

  const unlisted = slugsIn(pagesDir).filter((slug) => !bodies.has(slug));
  if (unlisted.length) console.warn(`content: ${name} has pages that nav.json does not list, so the site will not show them: ${unlisted.join(", ")}`);

  // Only what changed is written and only what is gone is removed, so a running dev server reloads one page, not all of them.
  const target = path.join(OUT, name);
  for (const [slug, body] of bodies) writeIfChanged(path.join(target, `${slug}.mdx`), body);
  for (const slug of slugsIn(target)) if (!bodies.has(slug)) fs.rmSync(path.join(target, `${slug}.mdx`));
  writeIfChanged(path.join(OUT, `${name}.json`), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`content: ${name}: ${bodies.size} pages from ${from}`);
}

/** The manifest is imported by the site, so rewriting it unchanged would rebuild every page that reads it. */
function writeIfChanged(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text);
}

function run(name, soft) {
  try {
    sync(name);
    return true;
  } catch (err) {
    if (!(err instanceof ContentError)) throw err;
    if (!soft) {
      console.error(`content: ${err.message}`);
      process.exit(1);
    }
    console.warn(`content: ${err.message}`);
    // Type checking and the dev server still need the manifest to exist.
    const manifest = path.join(OUT, `${name}.json`);
    if (!fs.existsSync(manifest)) writeIfChanged(manifest, JSON.stringify(name === "docs" ? { groups: [] } : name === "library" ? { categories: [] } : { tracks: [] }, null, 2) + "\n");
    return false;
  }
}

const soft = args.has("--soft");
for (const name of Object.keys(MANUALS)) run(name, soft);

if (args.has("--watch")) {
  for (const [name, manual] of Object.entries(MANUALS)) {
    const sibling = path.resolve(ROOT, manual.sibling);
    if (!fs.existsSync(path.join(sibling, "nav.json"))) continue;
    let timer;
    fs.watch(sibling, { recursive: true }, (_event, file) => {
      if (!file || file.startsWith(".git")) return;
      clearTimeout(timer);
      // A save is often several writes; wait for them to stop. A page that is broken mid-edit is reported, not fatal.
      timer = setTimeout(() => run(name, true), 150);
    });
  }
}

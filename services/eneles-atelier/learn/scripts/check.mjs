// Checks this repository's pages before they are published: every page nav.json lists exists and has a title and a description, every page is listed, names are usable in an address, and no page imports or exports anything. Run it with `node scripts/check.mjs`. It needs nothing installed.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const nav = JSON.parse(fs.readFileSync(path.join(root, "nav.json"), "utf8"));
// The docs repository groups pages/ under groups; the learn repository groups lessons/ under tracks.
const folder = nav.tracks ? "lessons" : "pages";
const listed = (nav.tracks ?? nav.groups).flatMap((group) => (group.lessons ?? group.pages ?? []).filter((entry) => typeof entry === "string"));

const problems = [];
const seen = new Set();
for (const slug of listed) {
  if (seen.has(slug)) problems.push(`nav.json lists "${slug}" twice.`);
  seen.add(slug);
  if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(slug)) problems.push(`"${slug}": use lower-case letters, digits, and hyphens.`);
  const file = path.join(root, folder, `${slug}.mdx`);
  if (!fs.existsSync(file)) {
    problems.push(`nav.json lists "${slug}", but ${folder}/${slug}.mdx does not exist.`);
    continue;
  }
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!frontmatter) {
    problems.push(`${slug}.mdx has no frontmatter.`);
    continue;
  }
  for (const field of ["title", "description"]) if (!new RegExp(`^${field}:\\s*\\S`, "m").test(frontmatter[1])) problems.push(`${slug}.mdx: the frontmatter needs a ${field}.`);
  // The summary is what search engines and link previews show. Longer than 160 characters it is cut off; shorter than 120 it is often replaced by text from the page.
  const summary = /^summary:\s*(.+)$/m.exec(frontmatter[1]);
  if (summary) {
    const text = summary[1].trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\\\\/g, "\\");
    if (text.length < 120 || text.length > 160) problems.push(`${slug}.mdx: the summary is ${text.length} characters. Keep it between 120 and 160.`);
  }
  const prose = text.slice(frontmatter[0].length).replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, "");
  const statement = /^(import|export)\s/m.exec(prose);
  if (statement) problems.push(`${slug}.mdx has an ${statement[1]} statement. Pages cannot import or export.`);
}

const walk = (dir, prefix = "") => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name), `${prefix}${entry.name}/`) : entry.name.endsWith(".mdx") ? [`${prefix}${entry.name.slice(0, -4)}`] : []));
for (const slug of walk(path.join(root, folder))) if (!seen.has(slug)) problems.push(`${folder}/${slug}.mdx is not listed in nav.json, so the site will not show it.`);

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${listed.length} pages, no problems.`);

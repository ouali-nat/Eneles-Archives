import fs from "node:fs";
import path from "node:path";
import { siteConfig } from "@/config/site";
import { getExampleById, getLibraryById } from "@/lib/tikz/libraries";
import { constructLatex } from "@/lib/tikz/utils";
import { getTemplateById } from "@/lib/latex/templates";
import { absoluteUrl, markdownPath, seoPage, seoPages, type SeoPage } from "@/lib/seo/pages";

/**
 * Plain Markdown copies of the reference pages, for AI assistants and anything else that reads text rather than a rendered page: each guide and lesson at its own address with .md appended, each package, example, and template likewise, and the site-wide llms.txt and llms-full.txt.
 *
 * Guides and lessons come from the same MDX the pages render (content/, written by scripts/sync-content.mjs). The few components a page can use (see mdx-components.tsx) become ordinary Markdown here: a Callout a quotation, a ShortcutsTable a table, an Endpoint a heading with its request and response, and the compiled-example fences plain `latex` fences.
 */

const CONTENT = path.join(process.cwd(), "content");

/** Replaces fenced code blocks with one-line placeholders while the prose around them is rewritten, so nothing inside code is ever touched. */
function protectFences(text: string): { text: string; fences: string[] } {
  const fences: string[] = [];
  const out = text.replace(/^(```|~~~)([^\n]*)\n[\s\S]*?^\1[^\n]*$/gm, (block, _fence: string, info: string) => {
    const language = info.trim();
    // A lesson's compiled example is, as text, simply LaTeX.
    const fixed = language === "latex-example" || language === "latex-document" ? block.replace(/^(```|~~~)[^\n]*/, "$1latex") : block;
    fences.push(fixed);
    return `\u0000FENCE${fences.length - 1}\u0000`;
  });
  return { text: out, fences };
}

function restoreFences(text: string, fences: string[]): string {
  // A fence inside a quotation gets the quotation's prefix on each of its lines.
  return text.replace(/^(.*?)\u0000FENCE(\d+)\u0000/gm, (_m, prefix: string, index: string) =>
    fences[Number(index)]
      .split("\n")
      .map((line) => `${prefix}${line}`.trimEnd())
      .join("\n"),
  );
}

/** A JavaScript string literal's text, as MDX attribute values and template literals hold it. */
function unescapeQuoted(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/\n/g, "\\n")}"`) as string;
  } catch {
    return value;
  }
}

function unescapeTemplate(value: string): string {
  return value.replace(/\\([\\`$])/g, "$1");
}

function dedent(text: string): string {
  const lines = text.replace(/^\n+|\s+$/g, "").split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n");
}

const cell = (text: string) => text.replace(/\|/g, "\\|");

function convertCallouts(text: string): string {
  return text.replace(/<Callout\b([^>]*)>([\s\S]*?)<\/Callout>/g, (_m, attrs: string, body: string) => {
    const type = /type="([^"]*)"/.exec(attrs)?.[1] ?? "note";
    const title = /title="((?:[^"\\]|\\.)*)"/.exec(attrs)?.[1];
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    const heading = title ? `**${label}: ${unescapeQuoted(title)}**` : `**${label}**`;
    const lines = [heading, "", ...dedent(body).split("\n")];
    return lines.map((line) => (line ? `> ${line}` : ">")).join("\n");
  });
}

function convertShortcutTables(text: string): string {
  return text.replace(/<ShortcutsTable\s+shortcuts=\{\[([\s\S]*?)\]\}\s*\/>/g, (_m, list: string) => {
    const rows = [...list.matchAll(/\{([^{}]*)\}/g)].map((entry) => {
      const fields: Record<string, string> = {};
      for (const f of entry[1].matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)) fields[f[1]] = unescapeQuoted(f[2]);
      return fields;
    });
    const hasMac = rows.some((r) => r.keysMac);
    const head = hasMac ? "| Windows and Linux | Mac | Action |\n|---|---|---|" : "| Keys | Action |\n|---|---|";
    const body = rows.map((r) => (hasMac ? `| ${cell(r.keys ?? "")} | ${cell(r.keysMac ?? r.keys ?? "")} | ${cell(r.description ?? "")} |` : `| ${cell(r.keys ?? "")} | ${cell(r.description ?? "")} |`));
    return [head, ...body].join("\n");
  });
}

function convertEndpoints(text: string, fences: string[]): string {
  return text.replace(/<Endpoint\b([\s\S]*?)\/>/g, (_m, attrs: string) => {
    const props: Record<string, string> = {};
    for (const a of attrs.matchAll(/(\w+)=(?:"((?:[^"\\]|\\.)*)"|\{`([\s\S]*?)`\})/g)) props[a[1]] = a[2] !== undefined ? unescapeQuoted(a[2]) : unescapeTemplate(a[3]);
    const out = [`### ${props.method ?? ""} ${props.path ?? ""}`.trim(), ""];
    if (props.description) out.push(props.description, "");
    if (props.auth) out.push(`Authentication: ${props.auth}`, "");
    // The request and response are code: they go in as fences, so the link and heading rewrites below leave them alone.
    const fence = (language: string, code: string) => {
      fences.push(`\`\`\`${language}\n${code}\n\`\`\``);
      return `\u0000FENCE${fences.length - 1}\u0000`;
    };
    if (props.request) out.push("Request:", "", fence("bash", props.request), "");
    if (props.response) out.push("Response:", "", fence("json", props.response), "");
    return out.join("\n").trimEnd();
  });
}

/** Site-relative links become absolute, so the text still points somewhere once it is copied out of the site. */
function absoluteLinks(text: string, pagePath: string): string {
  return text.replace(/\]\((\/[^)\s]*|#[^)\s]*)\)/g, (_m, href: string) => `](${absoluteUrl(href.startsWith("#") ? `${pagePath}${href}` : href)})`);
}

/** The Markdown body of a guide or lesson, without its frontmatter and its own first heading. */
function manualBody(manual: "docs" | "learn", slug: string, pagePath: string): string | null {
  const file = path.join(CONTENT, manual, `${slug}.mdx`);
  if (!fs.existsSync(file)) return null;
  let text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  text = text.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/^\s*# [^\n]*\n+/, "");
  const { text: prose, fences } = protectFences(text);
  let out = convertEndpoints(prose, fences);
  out = convertCallouts(out);
  out = convertShortcutTables(out);
  out = absoluteLinks(out, pagePath);
  out = out.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  return restoreFences(out, fences).replace(/\n{3,}/g, "\n\n").trim();
}

function header(page: SeoPage, where: string): string {
  return `# ${page.name}\n\n> ${page.description}\n\n${where}: ${absoluteUrl(page.path)}\n`;
}

const fence = (code: string, language = "latex") => {
  const ticks = code.includes("```") ? "````" : "```";
  return `${ticks}${language}\n${code.replace(/\s+$/, "")}\n${ticks}`;
};

function packageMarkdown(page: SeoPage, libraryId: string): string | null {
  const lib = getLibraryById(libraryId);
  if (!lib) return null;
  const examples = lib.examples.map((ex) => `- [${ex.name}](${absoluteUrl(markdownPath(`${page.path}/${ex.id}`))}): ${ex.description.replace(/\$/g, "")}`);
  return [header(page, `A package in the ${siteConfig.name} TikZ library`), `Category: ${lib.category}. On CTAN: ${lib.ctanUrl}`, "", lib.tags.length ? `Tags: ${lib.tags.join(", ")}\n` : "", "## Examples", "", ...examples, ""].join("\n");
}

function exampleMarkdown(page: SeoPage, libraryId: string, exampleId: string): string | null {
  const lib = getLibraryById(libraryId);
  const ex = getExampleById(libraryId, exampleId);
  if (!lib || !ex) return null;
  const complete = constructLatex(ex.source);
  return [
    header(page, `A ${lib.name} example in the ${siteConfig.name} TikZ library`),
    `Package: [${lib.name}](${absoluteUrl(markdownPath(`/library/${lib.id}`))}), on CTAN at ${lib.ctanUrl}.`,
    ex.tags.length ? `\nTags: ${ex.tags.join(", ")}` : "",
    "",
    "## Source",
    "",
    fence(ex.source),
    "",
    ...(complete !== ex.source.trim() ? ["## As a complete document", "", "The same example in a document that compiles on its own with pdfLaTeX:", "", fence(complete), ""] : []),
  ].join("\n");
}

function templateMarkdown(page: SeoPage, templateId: string): string | null {
  const template = getTemplateById(templateId);
  if (!template) return null;
  return [header(page, `A template in the ${siteConfig.name} library`), `Category: ${template.category}.`, "", `## ${template.mainFile ?? "main.tex"}`, "", fence(template.content), ""].join("\n");
}

/** The Markdown copy of the page at `pagePath` (such as /docs/compiling), or null when it has none. */
export function markdownFor(pagePath: string): string | null {
  const page = seoPage(pagePath);
  if (!page?.markdown) return null;
  const parts = page.path.split("/").filter(Boolean);
  switch (page.kind) {
    case "doc": {
      const body = manualBody("docs", parts.slice(1).join("/"), page.path);
      return body === null ? null : `${header(page, `From the ${siteConfig.name} docs${page.group ? ` (${page.group})` : ""}`)}\n${body}\n`;
    }
    case "lesson": {
      const body = manualBody("learn", parts[1], page.path);
      return body === null ? null : `${header(page, `A lesson in Learn LaTeX${page.group ? ` (${page.group})` : ""}, from ${siteConfig.name}`)}\n${body}\n`;
    }
    case "package":
      return packageMarkdown(page, parts[1]);
    case "example":
      return exampleMarkdown(page, parts[1], parts[2]);
    case "template":
      return templateMarkdown(page, parts[2]);
    default:
      return null;
  }
}

/** Every page that has a Markdown copy, as path segments for generateStaticParams. */
export function markdownPaths(): string[][] {
  return seoPages.filter((p) => p.markdown).map((p) => p.path.split("/").filter(Boolean));
}

const SUMMARY = `${siteConfig.name} is a collaborative LaTeX workspace in the browser: real-time co-editing, comments and track changes, compiling to PDF, handwriting and PDF conversion to LaTeX, a TikZ library, an AI assistant, and GitHub sync. This file lists its documentation, its LaTeX lessons, and its library of TikZ examples and document templates, each as plain Markdown.`;

const link = (page: SeoPage) => `- [${page.name}](${absoluteUrl(page.markdown ? markdownPath(page.path) : page.path)}): ${page.description}`;

/** llms.txt (https://llmstxt.org): the site's name, a summary, and its reference pages by section. */
export function llmsTxt(): string {
  const of = (...kinds: SeoPage["kind"][]) => seoPages.filter((p) => kinds.includes(p.kind));
  const guides = of("doc").filter((p) => !p.path.startsWith("/docs/api/"));
  const api = of("doc").filter((p) => p.path.startsWith("/docs/api/"));
  return [
    `# ${siteConfig.name}`,
    "",
    `> ${SUMMARY}`,
    "",
    `Every page below is also a web page at the same address without the .md ending. The full text of the docs and the lessons in one file is at ${absoluteUrl("/llms-full.txt")}.`,
    "",
    "## Docs",
    "",
    "How to use Eneles: projects, compiling, collaboration, review, the assistant, and account settings.",
    "",
    ...guides.map(link),
    "",
    "## API reference",
    "",
    `The Eneles REST API. Shared behaviour (base URL, authentication, pagination, errors, rate limits) is at ${absoluteUrl("/docs/api")}.`,
    "",
    ...api.map(link),
    "",
    "## Learn",
    "",
    "LaTeX itself, in short lessons read in order, from the first document to bibliographies, slides, and TikZ.",
    "",
    ...of("lesson").map(link),
    "",
    "## Library",
    "",
    "TikZ packages with rendered examples and their complete source, and document templates.",
    "",
    ...of("package", "template").map(link),
    "",
    "## Optional",
    "",
    ...of("example").map(link),
    "",
  ].join("\n");
}

/** llms-full.txt: every guide and lesson in full, one after another. */
export function llmsFullTxt(): string {
  const pages = seoPages.filter((p) => p.kind === "doc" || p.kind === "lesson");
  const parts = [`# ${siteConfig.name}: documentation and LaTeX lessons`, "", `> ${SUMMARY}`, "", `The index of these pages, and of the TikZ library, is at ${absoluteUrl("/llms.txt")}.`];
  for (const page of pages) {
    const text = markdownFor(page.path);
    // A rule between pages; each page then opens with its own title and address.
    if (text) parts.push("", "---", "", text.trim());
  }
  return `${parts.join("\n")}\n`;
}

import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import { SITE_URL } from "@/lib/site-urls";
import { docsGroups, docHref, type DocPage } from "@/lib/docs-nav";
import { learnTracks } from "@/lib/learn-nav";
import { libraryEntries, libraryHref, exampleHref, templateHref, totalExampleCount } from "@/lib/library-nav";
import { LATEX_TEMPLATES } from "@/lib/latex/templates";

/**
 * Every public reference page (Docs, Learn, and the Library) as search engines and AI assistants see it: its address, its title, its description, and where it sits. The pages' metadata, the sitemap, llms.txt, the Markdown copies, the Open Graph images, and the structured data are all built from this one list, which is itself built from the same navigation data the pages render, so a new page cannot be left out of any of them.
 */

export type SeoSection = "docs" | "learn" | "library";

export type SeoKind = "docs-index" | "api-index" | "doc" | "learn-index" | "lesson" | "library-index" | "package" | "example" | "template";

export interface SeoCrumb {
  name: string;
  path: string;
}

export interface SeoPage {
  /** The page's path, such as /docs/compiling. */
  path: string;
  section: SeoSection;
  kind: SeoKind;
  /** The page's own name, as its heading shows it. */
  name: string;
  /** The whole <title>, with the section and the site's name. */
  title: string;
  /** For search results and link previews: 120 to 160 characters wherever the content allows. */
  description: string;
  /** The sidebar group, track, or category the page belongs to. */
  group?: string;
  keywords?: string[];
  /** The trail from the home page to this page, this page last. */
  crumbs: SeoCrumb[];
  /** Whether a plain Markdown copy is served at the same address with .md appended. */
  markdown: boolean;
  /** For a lesson, its place in the course (1-based). */
  position?: number;
}

/** The section names used in titles, crumbs, and the Open Graph images. */
export const SECTION_NAMES: Record<SeoSection, string> = {
  docs: "Docs",
  learn: "Learn LaTeX",
  library: "Library",
};

export function absoluteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

/** The address of a page's Markdown copy. */
export function markdownPath(path: string): string {
  return `${path}.md`;
}

/** The address of a page's Open Graph image (app/og/[...path]/route.tsx). */
export function ogImagePath(path: string): string {
  return `/og${path}`;
}

/** Library descriptions may hold inline maths between dollar signs; a description in a search result is plain text. */
export function plainText(text: string): string {
  return text
    .replace(/(?<!\\)\$([^$]*)\$/g, "$1")
    .replace(/\\\$/g, "$")
    .replace(/\s+/g, " ")
    .trim();
}

const sentence = (text: string) => {
  const t = plainText(text);
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/**
 * A description of 120 to 160 characters from the content's own words: the base text, then the first of the longer-to-shorter follow-ups that still fits. When even the base is longer than 160 characters it is cut at a word boundary.
 */
export function fitDescription(base: string, ...followUps: string[]): string {
  const start = sentence(base);
  for (const extra of followUps) {
    const joined = `${start} ${extra}`;
    if (joined.length <= 160) return joined;
  }
  if (start.length <= 160) return start;
  const cut = start.slice(0, 157);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

const HOME: SeoCrumb = { name: "Home", path: "/" };
const DOCS: SeoCrumb = { name: "Docs", path: "/docs" };
const API: SeoCrumb = { name: "API reference", path: "/docs/api" };
const LEARN: SeoCrumb = { name: "Learn LaTeX", path: "/learn" };
const LIBRARY: SeoCrumb = { name: "Library", path: "/library" };

function docEntry(page: DocPage, group: string): SeoPage {
  const path = docHref(page.slug);
  const inApi = page.slug.startsWith("api/");
  return {
    path,
    section: "docs",
    kind: "doc",
    name: page.title,
    title: inApi ? `${page.title} - Eneles API reference` : `${page.title} - Eneles docs`,
    description: page.summary ?? fitDescription(page.description, inApi ? "Part of the Eneles REST API reference." : "A guide in the Eneles documentation."),
    group,
    keywords: page.keywords,
    crumbs: inApi ? [HOME, DOCS, API, { name: page.title, path }] : [HOME, DOCS, { name: page.title, path }],
    markdown: true,
  };
}

function buildPages(): SeoPage[] {
  const pages: SeoPage[] = [];

  // Docs. The two overview pages are part of the site rather than the docs repository, so their descriptions are written here.
  for (const group of docsGroups) {
    for (const page of group.items) {
      if (page.slug === "") {
        pages.push({
          path: "/docs",
          section: "docs",
          kind: "docs-index",
          name: "Documentation",
          title: "Documentation - Eneles docs",
          description: "Guides and API reference for Eneles, the LaTeX workspace: projects, compiling, collaboration, review, TikZ, GitHub sync, self-hosting, and the REST API.",
          crumbs: [HOME, DOCS],
          markdown: false,
        });
      } else if (page.slug === "api" && page.builtIn) {
        pages.push({
          path: "/docs/api",
          section: "docs",
          kind: "api-index",
          name: "API overview",
          title: "API overview - Eneles API reference",
          description: "The Eneles REST API: the base URL, authentication with a session token or an API key, pagination, the error format, rate limits, and identifiers.",
          group: group.title,
          crumbs: [HOME, DOCS, API],
          markdown: false,
        });
      } else if (!page.builtIn) {
        pages.push(docEntry(page, group.title));
      }
    }
  }

  // Learn.
  const lessonCount = learnTracks.reduce((n, track) => n + track.lessons.length, 0);
  pages.push({
    path: "/learn",
    section: "learn",
    kind: "learn-index",
    name: "Learn LaTeX",
    title: "Learn LaTeX - Eneles",
    description: fitDescription(`${lessonCount} short LaTeX lessons with examples compiled on the page: documents, mathematics, figures, tables, references, layout, slides, and drawing`, "Free, from your first document onward."),
    crumbs: [HOME, LEARN],
    markdown: false,
  });
  let position = 0;
  for (const track of learnTracks) {
    for (const lesson of track.lessons) {
      position += 1;
      const path = `/learn/${lesson.slug}`;
      pages.push({
        path,
        section: "learn",
        kind: "lesson",
        name: lesson.title,
        title: `${lesson.title} - Learn LaTeX - Eneles`,
        description: lesson.summary ?? fitDescription(lesson.description, "A LaTeX lesson with examples compiled on the page."),
        group: track.title,
        keywords: lesson.keywords,
        crumbs: [HOME, LEARN, { name: lesson.title, path }],
        markdown: true,
        position,
      });
    }
  }

  // Library.
  pages.push({
    path: "/library",
    section: "library",
    kind: "library-index",
    name: "Library",
    title: "TikZ library and LaTeX templates - Eneles",
    description: fitDescription(
      `${libraryEntries.length} TikZ packages with ${totalExampleCount} rendered examples and their LaTeX source, and ${LATEX_TEMPLATES.length} document templates`,
      "Copy the code or open any of them in a Eneles project.",
      "Copy the code or open it in Eneles.",
    ),
    crumbs: [HOME, LIBRARY],
    markdown: false,
  });
  for (const lib of libraryEntries) {
    const path = libraryHref(lib.id);
    const count = `${lib.examples.length} ${lib.examples.length === 1 ? "example" : "examples"}`;
    pages.push({
      path,
      section: "library",
      kind: "package",
      name: lib.name,
      title: `${lib.name} examples - TikZ library - Eneles`,
      description: fitDescription(
        lib.description,
        `${count} of ${lib.name} in LaTeX, each rendered, with complete source to copy or to open in a Eneles project.`,
        `${count}, each rendered, with complete LaTeX source to copy or open in Eneles.`,
        `${count}, rendered, with LaTeX source to copy or open in Eneles.`,
        `${count} with complete LaTeX source to copy.`,
        `${count} with LaTeX source.`,
      ),
      group: lib.category,
      crumbs: [HOME, LIBRARY, { name: lib.name, path }],
      markdown: true,
    });
    for (const ex of lib.examples) {
      const examplePath = exampleHref(lib.id, ex.id);
      pages.push({
        path: examplePath,
        section: "library",
        kind: "example",
        name: ex.name,
        title: `${ex.name} - ${lib.name} example - Eneles`,
        description: fitDescription(
          ex.description,
          `A ${lib.name} example for LaTeX, rendered, with its complete source, ready to copy or to open in a Eneles project.`,
          `A ${lib.name} example with its complete LaTeX source, ready to copy or open in Eneles.`,
          `A ${lib.name} example with its LaTeX source.`,
        ),
        group: lib.name,
        keywords: ex.tags,
        crumbs: [HOME, LIBRARY, { name: lib.name, path }, { name: ex.name, path: examplePath }],
        markdown: true,
      });
    }
  }
  for (const template of LATEX_TEMPLATES) {
    const path = templateHref(template.id);
    pages.push({
      path,
      section: "library",
      kind: "template",
      name: template.name,
      title: `${template.name} LaTeX template - Eneles`,
      description: fitDescription(
        template.description,
        "A LaTeX template with a PDF preview and the full source, to copy, to download as a ZIP, or to start a new Eneles project from.",
        "A LaTeX template with a PDF preview and the full source, to copy or to start a Eneles project from.",
        "A LaTeX template with its full source.",
      ),
      group: template.category,
      crumbs: [HOME, LIBRARY, { name: template.name, path }],
      markdown: true,
    });
  }

  return pages;
}

export const seoPages: SeoPage[] = buildPages();

const byPath = new Map(seoPages.map((page) => [page.path, page]));

export function seoPage(path: string): SeoPage | undefined {
  return byPath.get(path);
}

/**
 * A page's metadata: its title (absolute, so the layouts' title templates cannot add the site's name a second time), description, canonical address, Markdown copy, Open Graph and Twitter cards, and an explicit permission to index.
 */
export function seoMetadata(path: string): Metadata {
  const page = seoPage(path);
  if (!page) return {};
  const url = absoluteUrl(page.path);
  const image = { url: absoluteUrl(ogImagePath(page.path)), width: 1200, height: 630, alt: `${page.name}, ${SECTION_NAMES[page.section]}, ${siteConfig.name}` };
  const article = page.kind === "doc" || page.kind === "lesson";
  return {
    title: { absolute: page.title },
    description: page.description,
    keywords: page.keywords?.length ? page.keywords.slice(0, 20) : undefined,
    alternates: {
      canonical: url,
      ...(page.markdown ? { types: { "text/markdown": absoluteUrl(markdownPath(page.path)) } } : {}),
    },
    openGraph: {
      type: article ? "article" : "website",
      url,
      siteName: siteConfig.name,
      locale: "en_US",
      title: page.title,
      description: page.description,
      images: [image],
      // No modifiedTime: the content carries no dates it could be taken from (see the report in lib/seo/jsonld.ts).
      ...(article && page.group ? { section: page.group } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [image.url],
    },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large", "max-video-preview": -1 } },
  };
}

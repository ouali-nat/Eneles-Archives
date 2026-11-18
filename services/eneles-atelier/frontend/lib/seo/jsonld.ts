import { siteConfig } from "@/config/site";
import { absoluteUrl, ogImagePath, seoPage, seoPages, type SeoPage } from "@/lib/seo/pages";

/**
 * Structured data (schema.org, as JSON-LD) for the Docs, Learn, and Library pages, rendered by components/essential/JsonLd.tsx.
 *
 * Each page gets one graph: the site and its publisher (by reference, so they are described once), the breadcrumb trail, and the node for what the page is. Types follow schema.org and Google's documented structured data: TechArticle for a guide, Article plus LearningResource for a lesson, Course and ItemList for the course, SoftwareSourceCode for an example or a template, CollectionPage and ItemList for an index.
 *
 * There is no dateModified anywhere: the guides and lessons carry no dates, and the copy the site is built from is a shallow clone without history, so any date would be made up. There is no SearchAction on the WebSite either: the site's search is a dialog, with no address that takes a query.
 */

type Node = Record<string, unknown>;

const ORGANIZATION_ID = `${absoluteUrl("/")}#organization`;
const WEBSITE_ID = `${absoluteUrl("/")}#website`;
const COURSE_ID = `${absoluteUrl("/learn")}#course`;

const organization: Node = {
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: siteConfig.name,
  url: absoluteUrl("/"),
  logo: absoluteUrl("/branding/logo/Dark.png"),
  sameAs: [siteConfig.links.source, siteConfig.links.github],
};

const website: Node = {
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  name: siteConfig.name,
  url: absoluteUrl("/"),
  description: siteConfig.description,
  inLanguage: "en",
  publisher: { "@id": ORGANIZATION_ID },
};

function pageId(page: SeoPage): string {
  return `${absoluteUrl(page.path)}#page`;
}

function breadcrumbs(page: SeoPage): Node {
  return {
    "@type": "BreadcrumbList",
    "@id": `${absoluteUrl(page.path)}#breadcrumb`,
    itemListElement: page.crumbs.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/** What every page node shares: its address, name, description, language, image, and its place in the site. */
function common(page: SeoPage): Node {
  return {
    "@id": pageId(page),
    url: absoluteUrl(page.path),
    name: page.name,
    description: page.description,
    inLanguage: "en",
    image: absoluteUrl(ogImagePath(page.path)),
    isPartOf: { "@id": WEBSITE_ID },
    breadcrumb: { "@id": `${absoluteUrl(page.path)}#breadcrumb` },
  };
}

function itemList(pages: SeoPage[]): Node {
  return {
    "@type": "ItemList",
    numberOfItems: pages.length,
    itemListElement: pages.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: absoluteUrl(p.path), name: p.name })),
  };
}

function collectionPage(page: SeoPage, items: SeoPage[]): Node {
  return { "@type": "CollectionPage", ...common(page), mainEntity: itemList(items) };
}

function graph(page: SeoPage, main: Node[]): Node {
  return { "@context": "https://schema.org", "@graph": [organization, website, breadcrumbs(page), ...main] };
}

/** A guide or an API reference page. */
export function docJsonLd(path: string): Node | null {
  const page = seoPage(path);
  if (!page) return null;
  return graph(page, [
    {
      "@type": "TechArticle",
      ...common(page),
      headline: page.name,
      ...(page.group ? { articleSection: page.group } : {}),
      ...(page.keywords?.length ? { keywords: page.keywords.join(", ") } : {}),
      mainEntityOfPage: absoluteUrl(page.path),
      author: { "@id": ORGANIZATION_ID },
      publisher: { "@id": ORGANIZATION_ID },
    },
  ]);
}

/** The docs overview and the API overview: collections of the pages under them. */
export function docsIndexJsonLd(path: string): Node | null {
  const page = seoPage(path);
  if (!page) return null;
  const items = seoPages.filter((p) => p.kind === "doc" && (page.kind === "api-index" ? p.path.startsWith("/docs/api/") : true));
  return graph(page, [collectionPage(page, items)]);
}

/** One lesson: an article that teaches, part of the course. */
export function lessonJsonLd(path: string): Node | null {
  const page = seoPage(path);
  if (!page) return null;
  return graph(page, [
    {
      "@type": ["Article", "LearningResource"],
      ...common(page),
      headline: page.name,
      learningResourceType: "Lesson",
      ...(page.group ? { articleSection: page.group } : {}),
      ...(page.keywords?.length ? { keywords: page.keywords.join(", ") } : {}),
      ...(page.position ? { position: page.position } : {}),
      isPartOf: [{ "@id": WEBSITE_ID }, { "@type": "Course", "@id": COURSE_ID, name: "Learn LaTeX", url: absoluteUrl("/learn") }],
      mainEntityOfPage: absoluteUrl(page.path),
      isAccessibleForFree: true,
      author: { "@id": ORGANIZATION_ID },
      publisher: { "@id": ORGANIZATION_ID },
    },
  ]);
}

/** The Learn front page: the course, and the list of its lessons in reading order. */
export function learnIndexJsonLd(): Node | null {
  const page = seoPage("/learn");
  if (!page) return null;
  const lessons = seoPages.filter((p) => p.kind === "lesson");
  return graph(page, [
    collectionPage(page, lessons),
    {
      "@type": "Course",
      "@id": COURSE_ID,
      name: "Learn LaTeX",
      description: page.description,
      url: absoluteUrl("/learn"),
      inLanguage: "en",
      provider: { "@id": ORGANIZATION_ID },
      isAccessibleForFree: true,
      hasPart: lessons.map((lesson) => ({ "@type": "LearningResource", name: lesson.name, url: absoluteUrl(lesson.path) })),
    },
  ]);
}

/** The Library front page: every package and template. */
export function libraryIndexJsonLd(): Node | null {
  const page = seoPage("/library");
  if (!page) return null;
  return graph(page, [collectionPage(page, seoPages.filter((p) => p.kind === "package" || p.kind === "template"))]);
}

/** One TikZ package: its examples, and what the package is (with its CTAN page). */
export function packageJsonLd(path: string, ctanUrl: string): Node | null {
  const page = seoPage(path);
  if (!page) return null;
  const examples = seoPages.filter((p) => p.kind === "example" && p.path.startsWith(`${path}/`));
  return graph(page, [{ ...collectionPage(page, examples), about: { "@type": "Thing", name: page.name, sameAs: ctanUrl } }]);
}

/** One example or one template: the source itself, in LaTeX. */
export function sourceCodeJsonLd(path: string, source: string, extra: { codeSampleType: string; packageName?: string; packagePath?: string }): Node | null {
  const page = seoPage(path);
  if (!page) return null;
  return graph(page, [
    {
      "@type": "SoftwareSourceCode",
      ...common(page),
      programmingLanguage: { "@type": "ComputerLanguage", name: "LaTeX", url: "https://www.latex-project.org/" },
      codeSampleType: extra.codeSampleType,
      text: source,
      ...(page.keywords?.length ? { keywords: page.keywords.join(", ") } : {}),
      ...(extra.packagePath ? { isPartOf: [{ "@id": WEBSITE_ID }, { "@type": "CollectionPage", "@id": `${absoluteUrl(extra.packagePath)}#page`, name: extra.packageName, url: absoluteUrl(extra.packagePath) }] } : {}),
      author: { "@id": ORGANIZATION_ID },
      publisher: { "@id": ORGANIZATION_ID },
      isAccessibleForFree: true,
    },
  ]);
}

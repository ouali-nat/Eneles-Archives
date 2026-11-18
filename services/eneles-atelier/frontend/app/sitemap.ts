import type { MetadataRoute } from "next"
import { absoluteUrl, seoPages } from "@/lib/seo/pages"

/**
 * Every public page. The Docs, Learn, and Library pages come from lib/seo/pages.ts, which is built from the same navigation the pages render, so a new guide, lesson, package, example, or template is listed without anyone remembering to add it here.
 *
 * No lastModified: none of these pages carries a date it was last changed, and a sitemap that claims every page changed today teaches search engines to ignore its dates.
 */
const SITE_PAGES: { path: string; changeFrequency: "weekly" | "monthly" | "yearly"; priority: number }[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/features", changeFrequency: "monthly", priority: 0.8 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/about", changeFrequency: "monthly", priority: 0.7 },
  { path: "/contribute", changeFrequency: "monthly", priority: 0.6 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.5 },
  { path: "/changelog", changeFrequency: "weekly", priority: 0.5 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/refunds", changeFrequency: "yearly", priority: 0.3 },
]

const PRIORITY: Record<(typeof seoPages)[number]["kind"], number> = {
  "docs-index": 0.8,
  "learn-index": 0.8,
  "library-index": 0.8,
  "api-index": 0.6,
  doc: 0.7,
  lesson: 0.7,
  package: 0.6,
  template: 0.6,
  example: 0.5,
}

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...SITE_PAGES.map((page) => ({ url: absoluteUrl(page.path), changeFrequency: page.changeFrequency, priority: page.priority })),
    ...seoPages.map((page) => ({ url: absoluteUrl(page.path), changeFrequency: "monthly" as const, priority: PRIORITY[page.kind] })),
  ]
}

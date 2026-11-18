import type { MetadataRoute } from "next"
import { absoluteUrl } from "@/lib/seo/pages"

/** The signed-in app, the operators' panel, invitations, and the API: nothing there is for a crawler. /md/ is where the .md copies are built; they are read at the pages' own addresses (/docs/compiling.md). */
const PRIVATE = ["/api/", "/admin", "/dashboard", "/pdfs", "/snips", "/projects", "/profile", "/settings", "/billing", "/statistics", "/invite/", "/md/"]

/** The reference sections, their plain-text copies, and their preview images, which AI assistants are invited to read and cite. */
const PUBLIC = ["/", "/docs", "/learn", "/library", "/llms.txt", "/llms-full.txt", "/og/"]

/**
 * Search engines' and AI assistants' crawlers and fetchers, allowed by name. A crawler that finds a group with its own name follows only that group, so each group repeats the private paths.
 *
 * GPTBot, OAI-SearchBot, and ChatGPT-User are OpenAI's; ClaudeBot, Claude-SearchBot, and Claude-User are Anthropic's; PerplexityBot and Perplexity-User are Perplexity's; Google-Extended and Applebot-Extended are the tokens Google and Apple read for AI use; CCBot is Common Crawl, which many models are trained on; Bingbot also feeds Copilot.
 */
const AI_AGENTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot", "Bingbot"]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      { userAgent: AI_AGENTS, allow: PUBLIC, disallow: PRIVATE },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  }
}

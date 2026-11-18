import { llmsTxt } from "@/lib/seo/markdown";

/** /llms.txt, the index for AI assistants (https://llmstxt.org), built from the same navigation as the pages. */
export const dynamic = "force-static";

export function GET() {
  return new Response(llmsTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}

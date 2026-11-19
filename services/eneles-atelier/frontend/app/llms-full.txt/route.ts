import { llmsFullTxt } from "@/lib/seo/markdown";

/** /llms-full.txt: every guide and lesson in full, as Markdown, for AI assistants that read a whole manual at once. */
export const dynamic = "force-static";

export function GET() {
  return new Response(llmsFullTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}

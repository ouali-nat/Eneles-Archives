import { absoluteUrl } from "@/lib/seo/pages";
import { markdownFor, markdownPaths } from "@/lib/seo/markdown";

/**
 * The Markdown copy of a guide, lesson, package, example, or template. Visitors and AI assistants ask for it at the page's own address with .md appended (/docs/compiling.md); proxy.ts rewrites that to this route. Built once per deploy.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return markdownPaths().map((path) => ({ path }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const pagePath = `/${(await params).path.join("/")}`;
  const text = markdownFor(pagePath);
  if (text === null) return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(text, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // The web page is the version to index and to link to; this is the same content as text.
      Link: `<${absoluteUrl(pagePath)}>; rel="canonical"`,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}

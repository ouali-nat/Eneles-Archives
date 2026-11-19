import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { docHref, docsNav, getDocBySlug } from "@/lib/docs-nav";
import { seoMetadata } from "@/lib/seo/pages";
import { docJsonLd } from "@/lib/seo/jsonld";
import { JsonLd } from "@/components/essential/JsonLd";

/**
 * Every guide and API reference page. The pages themselves are written in the docs repository and copied into content/docs by scripts/sync-content.mjs; this route renders whichever one the address names. The two overview pages (/docs and /docs/api) are components in this folder's parent and take precedence.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return docsNav.filter((page) => !page.builtIn).map((page) => ({ slug: page.slug.split("/") }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  return seoMetadata(docHref((await params).slug.join("/")));
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const slug = (await params).slug.join("/");
  const page = getDocBySlug(slug);
  if (!page || page.builtIn) notFound();
  const { default: Content } = await import(`@/content/docs/${slug}.mdx`);
  return (
    <>
      <Content />
      <JsonLd data={docJsonLd(docHref(slug))} />
    </>
  );
}

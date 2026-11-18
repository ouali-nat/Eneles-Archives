import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { learnTracks } from "@/lib/learn-nav";
import { seoMetadata } from "@/lib/seo/pages";
import { lessonJsonLd } from "@/lib/seo/jsonld";
import { JsonLd } from "@/components/essential/JsonLd";

/**
 * Every lesson. The lessons are written in the learn repository and copied into content/learn by scripts/sync-content.mjs; this route renders whichever one the address names.
 */
export const dynamicParams = false;

const lessons = learnTracks.flatMap((track) => track.lessons);

export function generateStaticParams() {
  return lessons.map((lesson) => ({ slug: lesson.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return seoMetadata(`/learn/${(await params).slug}`);
}

export default async function LessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!lessons.some((l) => l.slug === slug)) notFound();
  const { default: Content } = await import(`@/content/learn/${slug}.mdx`);
  return (
    <>
      <Content />
      <JsonLd data={lessonJsonLd(`/learn/${slug}`)} />
    </>
  );
}

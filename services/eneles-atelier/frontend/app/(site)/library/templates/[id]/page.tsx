import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LATEX_TEMPLATES, getTemplateById } from "@/lib/latex/templates";
import { templateHref } from "@/lib/library-nav";
import { JsonLd } from "@/components/essential/JsonLd";
import { seoMetadata } from "@/lib/seo/pages";
import { sourceCodeJsonLd } from "@/lib/seo/jsonld";
import { TemplateDetail } from "./TemplateDetail";

export function generateStaticParams() {
  return LATEX_TEMPLATES.map((template) => ({ id: template.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return getTemplateById(id) ? seoMetadata(templateHref(id)) : { title: "Template not found" };
}

/** A built-in template: its metadata and structured data here, the page itself in TemplateDetail. */
export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const template = getTemplateById(id);
  if (!template) notFound();
  return (
    <>
      <JsonLd data={sourceCodeJsonLd(templateHref(id), template.content, { codeSampleType: "template" })} />
      <TemplateDetail id={id} />
    </>
  );
}

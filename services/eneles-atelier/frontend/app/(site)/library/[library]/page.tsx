import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, ExternalLink } from "@/components/icons";
import { getLibraryById, isPackageName, tikzLibraries } from "@/lib/tikz/libraries";
import { exampleHref, libraryHref } from "@/lib/library-nav";
import { Breadcrumbs } from "@/components/essential/Breadcrumbs";
import { InlineTex } from "@/components/essential/InlineTex";
import { TikzThumb } from "@/components/essential/library/TikzThumb";
import { ShellPageHeader } from "@/components/essential/layout/SitePageHeader";
import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/essential/JsonLd";
import { seoMetadata } from "@/lib/seo/pages";
import { packageJsonLd } from "@/lib/seo/jsonld";

export function generateStaticParams() {
  return tikzLibraries.map((lib) => ({ library: lib.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ library: string }>;
}): Promise<Metadata> {
  const { library } = await params;
  return getLibraryById(library) ? seoMetadata(libraryHref(library)) : { title: "Package not found" };
}

export default async function LibraryPackagePage({
  params,
}: {
  params: Promise<{ library: string }>;
}) {
  const { library } = await params;
  const lib = getLibraryById(library);
  if (!lib) notFound();

  return (
    <div>
      <JsonLd data={packageJsonLd(libraryHref(lib.id), lib.ctanUrl)} />
      <Breadcrumbs
        items={[
          { label: "Library", href: "/library" },
          { label: lib.name, mono: isPackageName(lib) },
        ]}
      />

      <ShellPageHeader
        mono={isPackageName(lib)}
        title={lib.name}
        description={<InlineTex>{lib.description}</InlineTex>}
        actions={
          <Button asChild variant="outline">
            <a href={lib.ctanUrl} target="_blank" rel="noreferrer">
              {lib.custom ? "TikZ on CTAN" : "View on CTAN"}
              <ExternalLink aria-hidden />
            </a>
          </Button>
        }
        className="mb-6"
      />

      {lib.tags.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-1.5">
          {lib.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-12 mb-4 text-lg font-semibold tracking-[-0.01em]">
        Examples
      </h2>

      <div className="grid gap-3 @min-[40rem]:grid-cols-2 @5xl:grid-cols-3">
        {lib.examples.map((ex) => (
          <Link
            key={ex.id}
            href={exampleHref(lib.id, ex.id)}
            className="group flex flex-col rounded-[var(--radius-surface)] border border-line p-4 transition-colors hover:border-foreground/25"
          >
            <TikzThumb libraryId={lib.id} exampleId={ex.id} source={ex.source} name={ex.name} className="mb-4" />
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{ex.name}</h3>
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                aria-hidden
              />
            </div>
            <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
              <InlineTex>{ex.description}</InlineTex>
            </p>
            {ex.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {ex.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

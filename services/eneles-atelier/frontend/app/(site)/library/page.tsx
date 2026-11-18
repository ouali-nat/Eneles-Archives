import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "@/components/icons";
import {
  libraryEntries,
  libraryHref,
  templateHref,
  totalExampleCount,
} from "@/lib/library-nav";
import { isPackageName, tikzCategories } from "@/lib/tikz/libraries";
import { LATEX_TEMPLATES } from "@/lib/latex/templates";
import { TikzThumb } from "@/components/essential/library/TikzThumb";
import { ShellPageHeader } from "@/components/essential/layout/SitePageHeader";
import { JsonLd } from "@/components/essential/JsonLd";
import { seoMetadata } from "@/lib/seo/pages";
import { libraryIndexJsonLd } from "@/lib/seo/jsonld";

/** Title, description, canonical address, and link previews: lib/seo/pages.ts. */
export const metadata: Metadata = seoMetadata("/library");

export default function LibraryIndexPage() {
  const byCategory = tikzCategories
    .filter((c) => c !== "All")
    .map((category) => ({
      category,
      libraries: libraryEntries.filter((lib) => lib.category === category),
    }))
    .filter((group) => group.libraries.length > 0);

  return (
    <div>
      <JsonLd data={libraryIndexJsonLd()} />
      <ShellPageHeader
        title="Library"
        description={`${totalExampleCount} rendered TikZ diagrams in ${libraryEntries.length} packages and families, and ${LATEX_TEMPLATES.length} document templates. Everything here compiles with the same TeX Live the editor uses, and every diagram can be inserted from the editor.`}
      />

      <h2 className="text-xl font-semibold tracking-[-0.01em]">TikZ diagrams</h2>

      <div className="mt-6 space-y-10">
        {byCategory.map((group) => (
          <section key={group.category}>
            <h3 className="mb-3 type-small font-medium text-muted-foreground">
              {group.category}
            </h3>
            <div className="grid gap-3 @min-[40rem]:grid-cols-2 @5xl:grid-cols-3">
              {group.libraries.map((lib) => (
                <Link
                  key={lib.id}
                  href={libraryHref(lib.id)}
                  className="group flex flex-col rounded-[var(--radius-surface)] border border-line bg-card p-4 transition-colors hover:border-foreground/25"
                >
                  {lib.examples[0] && (
                    <TikzThumb
                      libraryId={lib.id}
                      exampleId={lib.examples[0].id}
                      source={lib.examples[0].source}
                      name={lib.examples[0].name}
                      className="mb-4"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <p className={`${isPackageName(lib) ? "font-mono" : ""} text-sm font-semibold`}>{lib.name}</p>
                    <ArrowRight
                      className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                      aria-hidden
                    />
                  </div>
                  <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                    {lib.description}
                  </p>
                  <p className="mt-4 text-[12px] text-muted-foreground/70">
                    {lib.examples.length} example
                    {lib.examples.length === 1 ? "" : "s"}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      <h2
        id="templates"
        className="mt-20 scroll-mt-24 text-xl font-semibold tracking-[-0.01em]"
      >
        Templates
      </h2>
      <p className="mt-2 mb-6 type-base leading-relaxed text-muted-foreground">
        Built-in templates are below. Templates other people have shared, and your own, are on
        the{" "}
        <Link href="/templates" className="text-foreground underline underline-offset-4">
          Templates
        </Link>{" "}
        page.
      </p>

      {/* Flat, unlike the packages above. Categories here are labels rather
          than groupings worth a heading each, so they ride on the card. */}
      <div className="grid gap-3 @min-[40rem]:grid-cols-2 @5xl:grid-cols-3">
        {LATEX_TEMPLATES.map((template) => (
          <Link
            key={template.id}
            href={templateHref(template.id)}
            className="group flex flex-col rounded-[var(--radius-surface)] border border-line p-5 transition-colors hover:border-foreground/25"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold">{template.name}</h3>
              <span className="shrink-0 text-[11px] text-muted-foreground/70">
                {template.category}
              </span>
            </div>
            <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
              {template.description}
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors group-hover:text-foreground">
              Open
              <ArrowRight
                className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

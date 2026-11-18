import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ExternalLink } from "@/components/icons";
import { CopyButton } from "@/components/ui/copy-button";
import { getLibraryById, getExampleById, isPackageName, tikzLibraries } from "@/lib/tikz/libraries";
import { splitTikzSource } from "@/lib/tikz/insert";
import { getAdjacentExamples, exampleHref, libraryHref } from "@/lib/library-nav";
import { TikzExamplePreview } from "@/components/essential/library/TikzExamplePreview";
import { Breadcrumbs } from "@/components/essential/Breadcrumbs";
import { InlineTex } from "@/components/essential/InlineTex";
import { LatexCode } from "@/components/essential/LatexCode";
import { ShellPageHeader } from "@/components/essential/layout/SitePageHeader";
import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/essential/JsonLd";
import { seoMetadata } from "@/lib/seo/pages";
import { sourceCodeJsonLd } from "@/lib/seo/jsonld";

export function generateStaticParams() {
  return tikzLibraries.flatMap((lib) => lib.examples.map((ex) => ({ library: lib.id, example: ex.id })));
}

export async function generateMetadata({ params }: { params: Promise<{ library: string; example: string }> }): Promise<Metadata> {
  const { library, example } = await params;
  return getExampleById(library, example) ? seoMetadata(exampleHref(library, example)) : { title: "Example not found" };
}

/**
 * A single example: rendered preview, then the source that produced it.
 *
 * The oversized hero this page used to open with is gone. Inside a browser
 * with a persistent sidebar the context is already on screen, and a full
 * viewport of title before the diagram was the main thing making the old flow
 * feel slow.
 *
 * Rendered on the server, so the description and the source are in the HTML that search engines and AI assistants read; only the preview image and the copy buttons need the browser.
 */
export default async function LibraryExamplePage({
  params,
}: {
  params: Promise<{ library: string; example: string }>;
}) {
  const { library: libId, example: exId } = await params;
  const lib = getLibraryById(libId);
  const ex = getExampleById(libId, exId);

  if (!lib || !ex) notFound();

  const { preamble, body } = splitSource(ex.source);
  const { prev, next } = getAdjacentExamples(libId, exId);

  return (
    <div>
      <JsonLd data={sourceCodeJsonLd(exampleHref(lib.id, ex.id), ex.source, { codeSampleType: "code snippet", packageName: lib.name, packagePath: libraryHref(lib.id) })} />
      <Breadcrumbs
        items={[
          { label: "Library", href: "/library" },
          { label: lib.name, href: `/library/${lib.id}`, mono: isPackageName(lib) },
          { label: ex.name },
        ]}
      />

      <ShellPageHeader
        title={ex.name}
        description={<InlineTex>{ex.description}</InlineTex>}
        actions={
          <Button asChild variant="outline">
            <a href={lib.ctanUrl} target="_blank" rel="noreferrer">
              CTAN
              <ExternalLink aria-hidden />
            </a>
          </Button>
        }
        className="mb-0"
      />

      {ex.tags.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {ex.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <TikzExamplePreview
          libraryId={lib.id}
          exampleId={ex.id}
          source={ex.source}
          alt={`${ex.name}, drawn by the source below`}
        />
      </div>

      {/* Source */}
      <div className="mt-8 space-y-4">
        {preamble && <SourceBlock title="Preamble" code={preamble} />}
        <SourceBlock title="Source" code={body} />
      </div>

      {/* Prev/next, crossing package boundaries so you can read straight
          through the whole library without going back to an index. */}
      {(prev || next) && (
        <div className="mt-12 grid gap-3 @min-[40rem]:grid-cols-2">
          {prev ? (
            <Link
              href={exampleHref(prev.libraryId, prev.exampleId)}
              className="group flex items-center gap-3 rounded-[var(--radius-surface)] border border-line p-4 transition-colors hover:border-foreground/25"
            >
              <ArrowLeft
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5"
                aria-hidden
              />
              <div className="min-w-0">
                <p className={`truncate ${isPackageName(getLibraryById(prev.libraryId) ?? {}) ? "font-mono" : ""} text-[11px] text-muted-foreground`}>
                  {prev.libraryName}
                </p>
                <p className="truncate text-sm font-medium">
                  {prev.exampleName}
                </p>
              </div>
            </Link>
          ) : (
            <div className="hidden @min-[40rem]:block" />
          )}

          {next && (
            <Link
              href={exampleHref(next.libraryId, next.exampleId)}
              className="group flex items-center justify-end gap-3 rounded-[var(--radius-surface)] border border-line p-4 text-end transition-colors hover:border-foreground/25"
            >
              <div className="min-w-0">
                <p className={`truncate ${isPackageName(getLibraryById(next.libraryId) ?? {}) ? "font-mono" : ""} text-[11px] text-muted-foreground`}>
                  {next.libraryName}
                </p>
                <p className="truncate text-sm font-medium">
                  {next.exampleName}
                </p>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function SourceBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-surface)] border border-line">
      <div className="flex items-center justify-between border-b bg-surface/40 px-4 py-2">
        {/* A heading, so the outline reads "Preamble", "Source"; it looks the same as the label it was. */}
        <h2 className="text-[11px] font-medium text-muted-foreground">
          {title}
        </h2>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-4">
        <LatexCode className="text-[12.5px] leading-relaxed text-foreground">
          {code}
        </LatexCode>
      </pre>
    </div>
  );
}

/** Split preamble directives from the diagram body so each can be copied alone: the same split the editor's template picker makes. */
function splitSource(source: string): { preamble: string; body: string } {
  const { preamble, body } = splitTikzSource(source);
  return { preamble: preamble.join("\n"), body };
}

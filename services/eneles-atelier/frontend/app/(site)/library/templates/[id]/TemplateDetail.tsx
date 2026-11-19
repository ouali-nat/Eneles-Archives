"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Contrast, Download, Plus } from "@/components/icons";
import { LoadingBar } from "@/components/essential/status/LoadingScreen";
import { CopyButton, CopyGlyph } from "@/components/ui/copy-button";
import JSZip from "jszip";
import { toast } from "sonner";
import { getTemplateById } from "@/lib/latex/templates";
import { getAdjacentTemplates, templateHref } from "@/lib/library-nav";
import { getTemplatePdfUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/essential/Breadcrumbs";
import { LatexCode } from "@/components/essential/LatexCode";
import { PDFViewer } from "@/components/essential/pdf/PDFViewer";
import { cn } from "@/lib/utils";
import { ShellPageHeader } from "@/components/essential/layout/SitePageHeader";

/**
 * A template inside the library shell. The page around it (page.tsx) is rendered on the server and adds the metadata and structured data; this part needs the browser for the PDF preview and the buttons, and is still rendered on the server first, so the template's source is in the HTML.
 *
 * Compact by design: the sidebar already says which template you are looking
 * at, so the page opens on the actions and the rendered PDF rather than a
 * viewport of title. The preview is the prebuilt PDF from
 * `GET /templates/prebuilt/:id/pdf`, so it is a cached asset rather than a
 * compile per visitor.
 */
export function TemplateDetail({ id }: { id: string }) {
  const template = getTemplateById(id);

  const router = useRouter();
  const { isAuthenticated } = useAuth();

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState(false);
  const [inverted, setInverted] = useState(false);
  const [copied, setCopied] = useState(false);

  // Start each template with no preview and no error; the effect below then loads its PDF.
  const [previewId, setPreviewId] = useState(id);
  if (previewId !== id) {
    setPreviewId(id);
    setPdfUrl(null);
    setPdfError(false);
  }

  useEffect(() => {
    let cancelled = false;
    getTemplatePdfUrl(id)
      .then((url) => {
        if (!cancelled) setPdfUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPdfError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!template) return notFound();

  const { prev, next } = getAdjacentTemplates(id);
  const mainFile = template.mainFile ?? "main.tex";

  const useTemplate = () => {
    if (!isAuthenticated) {
      router.push(`/signup?redirect=/projects?template=${template.id}`);
      return;
    }
    router.push(`/projects?template=${template.id}`);
  };

  const copySource = () => {
    void navigator.clipboard.writeText(template.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadZip = async () => {
    try {
      const zip = new JSZip();
      zip.file(mainFile, template.content);
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${template.id}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not build the archive");
    }
  };

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Library", href: "/library" },
          { label: "Templates", href: "/library#templates" },
          { label: template.name },
        ]}
      />

      <ShellPageHeader title={template.name} eyebrow={template.category} description={template.description} className="mb-0" />

      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={useTemplate} className="gap-1.5">
          <Plus className="h-4 w-4" aria-hidden />
          Use this template
        </Button>
        <Button variant="outline" onClick={copySource} className="copy-button gap-1.5">
          <CopyGlyph copied={copied} className="size-4" />
          <span className="inline-grid [&>span]:[grid-area:1/1] [&>span]:invisible [&>span[data-shown]]:visible">
            <span data-shown={!copied || undefined}>Copy source</span>
            <span data-shown={copied || undefined}>Copied</span>
          </span>
        </Button>
        <Button
          variant="outline"
          onClick={() => void downloadZip()}
          className="gap-1.5"
        >
          <Download className="h-4 w-4" aria-hidden />
          Download ZIP
        </Button>
      </div>

      {/* Preview */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[11px] font-medium text-muted-foreground">
            Preview
          </p>
          <button
            type="button"
            onClick={() => setInverted((v) => !v)}
            aria-pressed={inverted}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
              inverted
                ? "border-foreground/30 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Contrast className="h-3 w-3" aria-hidden />
            {inverted ? "Inverted" : "Invert colours"}
          </button>
        </div>

        <div
          className={cn(
            "flex min-h-[24rem] items-center justify-center overflow-hidden rounded-xl border p-6 transition-colors",
            inverted ? "bg-[var(--preview-black)]" : "bg-surface/40",
          )}
        >
          {pdfError ? (
            <p className="text-[13px] text-muted-foreground">
              No preview has been generated for this template yet.
            </p>
          ) : !pdfUrl ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <LoadingBar />
              <p role="status" className="type-small">Loading preview</p>
            </div>
          ) : (
            /* The prebuilt PDF is a white page. `invert` flips it to a dark
               document, which is what makes it readable beside a dark editor. */
            <div
              className={cn(
                "flex max-w-full items-center justify-center",
                inverted && "invert",
              )}
            >
              <PDFViewer
                url={pdfUrl}
                unStyled
                singlePage
                zoom={130}
                className="pointer-events-none flex max-w-full items-center justify-center"
              />
            </div>
          )}
        </div>
      </div>

      {/* Source */}
      <div className="mt-8 overflow-hidden rounded-xl border">
        <div className="flex items-center justify-between border-b bg-surface/40 px-4 py-2">
          <span className="font-mono text-[11px] text-muted-foreground">
            {mainFile}
          </span>
          <CopyButton text={template.content} />
        </div>
        <pre className="max-h-[32rem] overflow-auto p-4">
          <LatexCode className="text-[12.5px] leading-relaxed text-foreground">
            {template.content}
          </LatexCode>
        </pre>
      </div>

      {(prev || next) && (
        <div className="mt-12 grid gap-3 @min-[40rem]:grid-cols-2">
          {prev ? (
            <Link
              href={templateHref(prev.id)}
              className="group flex items-center gap-3 rounded-xl border p-4 transition-colors hover:border-foreground/25 hover:bg-surface/40"
            >
              <ArrowLeft
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5"
                aria-hidden
              />
              <div className="min-w-0">
                <p className="truncate text-[11px] text-muted-foreground">
                  {prev.category}
                </p>
                <p className="truncate text-sm font-medium">{prev.name}</p>
              </div>
            </Link>
          ) : (
            <div className="hidden @min-[40rem]:block" />
          )}

          {next && (
            <Link
              href={templateHref(next.id)}
              className="group flex items-center justify-end gap-3 rounded-xl border p-4 text-end transition-colors hover:border-foreground/25 hover:bg-surface/40"
            >
              <div className="min-w-0">
                <p className="truncate text-[11px] text-muted-foreground">
                  {next.category}
                </p>
                <p className="truncate text-sm font-medium">{next.name}</p>
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

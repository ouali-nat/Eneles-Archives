"use client";

import { useLabelColors } from "@/hooks/useLabelColors";
import { LabelChip } from "@/components/essential/resource-list/LabelChip";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { PDF, pdfsAPI } from "@/lib/api";
import { extractPdfToTex } from "@/lib/extraction-api";
import { ResourceList } from "@/components/essential/resource-list/ResourceList";
import { FileText } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { PDFViewer } from "@/components/essential/pdf/PDFViewer";


interface PDFWithTags extends PDF {
  tags?: string[];
  title?: string;
  description?: string;
  metadata?: {
    pages: number;
    size: string;
    aiSummary: string;
  };
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export default function PDFsPage() {
  const { user, isAuthenticated } = useAuth();
  const router = useRouter();
  const [pdfs, setPdfs] = useState<PDFWithTags[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [pdfPreviewUrls, setPdfPreviewUrls] = useState<Record<string, string>>(
    {},
  );
  const { colors: tagColors, setColor: saveTagColor } = useLabelColors();

  // Show the loader again whenever a sign-in starts a new fetch. The first fetch needs nothing: `isLoading` starts true.
  const [wasAuthenticated, setWasAuthenticated] = useState(isAuthenticated);
  if (wasAuthenticated !== isAuthenticated) {
    setWasAuthenticated(isAuthenticated);
    if (isAuthenticated) setIsLoading(true);
  }

  // Fetch PDFs from API on component mount
  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchPdfs = async () => {
      try {
        const res = await pdfsAPI.getMyPdfs();
        const enhancedData = res.data.map((pdf) => ({
          ...pdf,
          pdfPath: pdf.filePath || pdf.pdfPath,
          title: pdf.title || `Document-${pdf.id}`,
          metadata: {
            pages: pdf.pageCount || 1,
            size: pdf.fileSize ? formatFileSize(pdf.fileSize) : "?",
            aiSummary:
              "This document contains important information and equations.",
          },
        }));
        setPdfs(enhancedData);

        // Fetch preview URLs for all PDFs (don't block on errors)
        const previewUrls: Record<string, string> = {};
        const previewPromises = enhancedData.map(async (pdf) => {
          try {
            const previewUrl = await pdfsAPI.getPdfPreviewUrl(pdf.id.toString(),
            );
            previewUrls[pdf.id] = previewUrl;
          } catch (error) {
            console.error(`Failed to get preview URL for PDF ${pdf.id}:`, error);
          }
        });
        await Promise.allSettled(previewPromises);
        setPdfPreviewUrls(previewUrls);
      } catch (error: any) {
        console.error("Error fetching PDFs:", error);
        toast.error(error?.message || "Failed to load your PDFs");
        setPdfs([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPdfs();
  }, [isAuthenticated]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge variant="default" className="bg-hue-green">
            Completed
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="default" className="bg-hue-amber">
            Processing
          </Badge>
        );
      case "error":
        return <Badge variant="destructive">Error</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  const handlePDFUpload = async (file: File) => {
    if (!isAuthenticated) {
      toast.error("You must be logged in to upload");
      return;
    }

    setIsUploading(true);

    try {
      const newPdf = (await pdfsAPI.create(file,
        file.name,
      )) as PDFWithTags;

      newPdf.title = file.name;
      newPdf.fileSize = file.size;
      newPdf.metadata = {
        pages: newPdf.pageCount || 1,
        size: formatFileSize(file.size),
        aiSummary:
          "This document contains important information and equations.",
      };

      // Update status to processing
      newPdf.status = "processing";
      setPdfs((prevPdfs) => [newPdf, ...prevPdfs]);

      // Fetch preview URL for new PDF
      try {
        const previewUrl = await pdfsAPI.getPdfPreviewUrl(newPdf.id.toString(),
        );
        setPdfPreviewUrls((prev) => ({ ...prev, [newPdf.id]: previewUrl }));
      } catch (error) {
        console.error(`Failed to get preview URL for PDF ${newPdf.id}:`, error);
      }

      toast.success("PDF uploaded successfully. Processing...");

      // Automatically process the PDF: try NestJS backend first, then extraction service
      try {
        const result = await pdfsAPI.processPdf(newPdf.id.toString());

        // Update the PDF with processing results
        setPdfs((prevPdfs) =>
          prevPdfs.map((pdf) =>
            pdf.id === newPdf.id
              ? {
                  ...pdf,
                  status: result.status as any,
                  latexContent: result.latexContent,
                  pageCount: result.pageCount || pdf.pageCount,
                }
              : pdf,
          ),
        );

        toast.success("PDF processed successfully");
      } catch (backendError: any) {
        console.warn(
          "NestJS backend processing failed, trying extraction service...",
          backendError.message,
        );

        // Fallback: send the original file to the extraction service directly
        try {
          const extractResult = await extractPdfToTex(file);

          setPdfs((prevPdfs) =>
            prevPdfs.map((pdf) =>
              pdf.id === newPdf.id
                ? {
                    ...pdf,
                    status: "completed" as any,
                    latexContent: extractResult.tex,
                    pageCount: extractResult.pages || pdf.pageCount,
                  }
                : pdf,
            ),
          );

          // Try to save the extracted content back to the backend (best-effort)
          try {
            await pdfsAPI.updatePdf(newPdf.id.toString(), {
              latexCode: extractResult.tex,
              processingStatus: "completed",
            });
          } catch {
            /* ignore, backend might be down */
          }

          toast.success("PDF extracted successfully via extraction service");
        } catch (extractionError: any) {
          console.error("Extraction service also failed:", extractionError);
          // Set status to pending on error so user can retry
          setPdfs((prevPdfs) =>
            prevPdfs.map((pdf) =>
              pdf.id === newPdf.id
                ? {
                    ...pdf,
                    status: "pending" as any,
                  }
                : pdf,
            ),
          );
          toast.error("Processing failed. You can retry from the detail page.");
        }
      }
    } catch (error: any) {
      console.error("Error uploading PDF:", error);
      toast.error(error.message || "Failed to upload PDF");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!isAuthenticated) return;

    try {
      await pdfsAPI.deletePdf(id);
      setPdfs((prev) => prev.filter((pdf) => pdf.id !== id));
    } catch (error) {
      console.error("Error deleting PDF:", error);
      throw error;
    }
  };

  const handleArchive = async (ids: string[]) => {
    if (!isAuthenticated) return;

    try {
      await Promise.all(
        ids.map(async (id) => {
          const pdf = pdfs.find((p) => p.id === id);
          if (!pdf) return;
          const currentTags = pdf.tags || [];
          const updatedTags = currentTags.includes("archived")
            ? currentTags.filter((t) => t !== "archived")
            : [...currentTags, "archived"];

          await pdfsAPI.updatePdf(id, {
            tags: updatedTags,
          });

          // Update local state
          setPdfs((prev) =>
            prev.map((p) => (p.id === id ? { ...p, tags: updatedTags } : p)),
          );
        }),
      );

      if (ids.length === 1) {
        toast.success("PDF archived");
      } else {
        toast.success(`${ids.length} PDF(s) archived`);
      }
    } catch (error) {
      console.error("Error archiving PDFs:", error);
      toast.error("Failed to archive PDF(s)");
    }
  };

  const handleLabel = async (ids: string[], tag: string, color?: string) => {
    if (!isAuthenticated) return;
    try {
      await Promise.all(
        ids.map(async (id) => {
          const pdf = pdfs.find((p) => p.id === id);
          if (!pdf) return;
          const currentTags = pdf.tags || [];
          const updatedTags = currentTags.includes(tag)
            ? currentTags.filter((t) => t !== tag)
            : [...currentTags, tag];
          await pdfsAPI.updatePdf(id, { tags: updatedTags });
          setPdfs((prev) =>
            prev.map((p) => (p.id === id ? { ...p, tags: updatedTags } : p)),
          );
        }),
      );
      if (color) saveTagColor(tag, color);
      toast.success(
        ids.length === 1
          ? `Label "${tag}" updated`
          : `Label "${tag}" updated for ${ids.length} PDF(s)`,
      );
    } catch (error) {
      console.error("Error updating label:", error);
      toast.error("Failed to update label");
    }
  };

  return (
    <ResourceList<PDFWithTags>
      items={pdfs}
      isLoading={isLoading}
      isUploading={isUploading}
      title="PDFs"
      itemNoun="PDFs"
      preview="page"
      description="Upload and extract LaTeX from PDF documents"
      acceptFileType="application/pdf"
      fileTypeLabel="PDF"
      onUpload={handlePDFUpload}
      onDelete={handleDelete}
      onArchive={handleArchive}
      onLabel={handleLabel}
      onItemClick={(pdf) => router.push(`/pdfs/${pdf.id}`)}
      getPreviewUrl={(pdf) => pdfPreviewUrls[pdf.id] || null}
      formatFileSize={(pdf) => pdf.metadata?.size || null}
      getMetadata={(pdf) => pdf.metadata || null}
      renderItemPreview={(pdf, previewUrl) => (
        <div className="w-24 h-32 bg-surface rounded-md overflow-hidden shrink-0 border flex">
          {previewUrl ? (
            <PDFViewer
              url={previewUrl}
              fitToContainer
              className="w-full h-full min-w-0 min-h-0 pointer-events-none"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
          )}
        </div>
      )}
      renderItemMetadata={(pdf, metadata) => {
        const pdfTags = (pdf.tags || []).filter(
          (t: string) => t !== "archived",
        );
        return (
          <div className="flex items-center gap-1.5">
            {metadata?.pages && (
              <span className="text-[10px] text-muted-foreground">
                {metadata.pages}p
              </span>
            )}
            {metadata?.size && (
              <span className="text-[10px] text-muted-foreground">
                {metadata.size}
              </span>
            )}
            {pdfTags.map((tag: string) => {
              return <LabelChip key={tag} label={tag} color={tagColors[tag]} />;
            })}
          </div>
        );
      }}
      getStatusBadge={getStatusBadge}
      tagColors={tagColors}
    />
  );
}

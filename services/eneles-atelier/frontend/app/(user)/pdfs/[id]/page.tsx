"use client";

import { LoadingScreen } from "@/components/essential/status/LoadingScreen";
import { StatusPage } from "@/components/essential/status/StatusPage";
import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { PDF, pdfsAPI, projectsAPI } from "@/lib/api";
import { extractPdfToTex } from "@/lib/extraction-api";
import { markdownToLatex, type ImageRef } from "@/lib/markdown-to-latex";
import { ArrowLeft, FileText, Copy, Download, Play, Loader2, ChevronLeft, ChevronRight, Info, RotateCcw, Sparkles, Eye, Code, PenLine, ZoomIn, ZoomOut, ImageIcon, Columns2, PanelRight, PanelLeft, Moon } from "@/components/icons";
import { PDFViewer } from "@/components/essential/pdf/PDFViewer";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { MarkdownRenderer } from "@/components/essential/pdf/MarkdownRenderer";
import {
  extractImagesFromPdf,
  type ExtractedImage,
} from "@/components/essential/pdf/PdfImageExtractor";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/time";

interface PDFWithMeta extends PDF {
  title?: string;
  metadata?: { pages: number; size: string };
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export default function PDFDetailPage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const params = useParams();
  const pdfId = params.id as string;

  const [pdf, setPdf] = useState<PDFWithMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedText, setExtractedText] = useState("");
  const [originalExtractedText, setOriginalExtractedText] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [allPdfs, setAllPdfs] = useState<PDF[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"rendered" | "source">("rendered");
  const [pdfZoom, setPdfZoom] = useState(100);
  const [extractedImages, setExtractedImages] = useState<ExtractedImage[]>([]);
  const [isExtractingImages, setIsExtractingImages] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [layout, setLayout] = useState<"split" | "pdf" | "content">("split");
  const [pdfInverted, setPdfInverted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractionRunningRef = useRef(false);

  // Show the loader again whenever a new fetch starts (a sign-in or another PDF). The first fetch needs nothing: `isLoading` starts true.
  const fetchKey = isAuthenticated && pdfId ? pdfId : null;
  const [fetchedKey, setFetchedKey] = useState(fetchKey);
  if (fetchedKey !== fetchKey) {
    setFetchedKey(fetchKey);
    if (fetchKey) setIsLoading(true);
  }

  useEffect(() => {
    if (!isAuthenticated || !pdfId) return;

    const fetchPdf = async () => {
      try {
        const data = await pdfsAPI.getPdf(pdfId);
        setPdf({
          ...data,
          title: data.title || `Document-${data.id}`,
          metadata: {
            pages: data.pageCount || 1,
            size: data.fileSize ? formatFileSize(data.fileSize) : "?",
          },
        });
        const latexContent = data.latexContent || "";
        setExtractedText(latexContent);
        setOriginalExtractedText(latexContent);

        try {
          const preview = await pdfsAPI.getPdfPreviewUrl(pdfId);
          setPreviewUrl(preview);
        } catch (error) {
          console.error(`Failed to get preview URL for PDF ${pdfId}:`, error);
        }
      } catch (error) {
        console.error("Error fetching PDF:", error);
        toast.error("Failed to load PDF");
        router.push("/pdfs");
      } finally {
        setIsLoading(false);
      }
    };

    const fetchAllPdfs = async () => {
      try {
        const res = await pdfsAPI.getMyPdfs();
        setAllPdfs(res.data);
      } catch (error) {
        console.error("Error fetching all PDFs:", error);
      }
    };

    fetchPdf();
    fetchAllPdfs();
  }, [isAuthenticated, pdfId, router]);

  // Follow the open PDF's position in the list. A PDF that is not in the list leaves the position where it was.
  if (allPdfs.length > 0 && pdfId) {
    const index = allPdfs.findIndex((p) => p.id.toString() === pdfId);
    if (index !== -1 && index !== currentIndex) setCurrentIndex(index);
  }

  // Images are extracted again whenever the preview URL or the text changes while both are present, unless an extraction is already running. The hint is switched on in the same render that notices the change, and the effect below starts the work.
  const [extractionInput, setExtractionInput] = useState({ previewUrl, extractedText });
  if (extractionInput.previewUrl !== previewUrl || extractionInput.extractedText !== extractedText) {
    setExtractionInput({ previewUrl, extractedText });
    if (previewUrl && extractedText) setIsExtractingImages(true);
  }

  useEffect(() => {
    if (!previewUrl || !extractedText || extractionRunningRef.current) return;
    extractionRunningRef.current = true;
    (async () => {
      try {
        const images = await extractImagesFromPdf(previewUrl);
        setExtractedImages(images);
      } catch (err) {
        console.warn("Image extraction failed:", err);
      } finally {
        extractionRunningRef.current = false;
        setIsExtractingImages(false);
      }
    })();
  }, [previewUrl, extractedText]);

  const handleResetText = () => {
    setExtractedText(originalExtractedText);
    toast.success("Text reset to original");
  };

  const handleSaveText = async () => {
    if (!isAuthenticated || !pdfId || extractedText === originalExtractedText) return;
    try {
      await pdfsAPI.updatePdf(pdfId, { latexCode: extractedText });
      setOriginalExtractedText(extractedText);
      toast.success("Text saved successfully");
    } catch (error) {
      console.error("Error saving text:", error);
      toast.error("Failed to save text");
    }
  };

  const handleProcessPdf = async () => {
    if (!isAuthenticated || !pdfId) return;
    setIsProcessing(true);
    try {
      const result = await pdfsAPI.processPdf(pdfId);
      const latexContent = result.latexContent || "";
      setExtractedText(latexContent);
      setOriginalExtractedText(latexContent);
      setPdf((prev) =>
        prev
          ? {
              ...prev,
              latexContent,
              status: result.status as any,
              pageCount: result.pageCount || prev.pageCount,
            }
          : null,
      );
      toast.success("PDF processed successfully");
    } catch (backendError: any) {
      console.warn(
        "NestJS backend unavailable, trying extraction service...",
        backendError.message,
      );
      try {
        if (!previewUrl)
          throw new Error("No preview URL available to fetch the PDF");
        toast.info("Using extraction service...");
        const pdfResponse = await fetch(previewUrl);
        if (!pdfResponse.ok)
          throw new Error("Failed to fetch PDF from storage");
        const pdfBlob = await pdfResponse.blob();
        const pdfFile = new window.File(
          [pdfBlob],
          pdf?.title || "document.pdf",
          {
            type: "application/pdf",
          },
        );
        const result = await extractPdfToTex(pdfFile);
        const latexContent = result.tex || "";
        setExtractedText(latexContent);
        setOriginalExtractedText(latexContent);
        setPdf((prev) =>
          prev
            ? {
                ...prev,
                latexContent,
                status: "completed" as any,
                pageCount: result.pages || prev.pageCount,
              }
            : null,
        );
        toast.success("PDF extracted successfully");
      } catch (extractionError: any) {
        console.error("Extraction service also failed:", extractionError);
        toast.error(extractionError.message || "Failed to process PDF");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDirectExtract = async (file: File) => {
    setIsProcessing(true);
    try {
      toast.info("Extracting LaTeX from PDF...");
      const result = await extractPdfToTex(file);
      const latexContent = result.tex || "";
      setExtractedText(latexContent);
      setOriginalExtractedText(latexContent);
      setPdf((prev) =>
        prev
          ? {
              ...prev,
              latexContent,
              status: "completed" as any,
              pageCount: result.pages || prev.pageCount,
            }
          : null,
      );
      toast.success("PDF extracted successfully");
    } catch (error: any) {
      console.error("Direct extraction failed:", error);
      toast.error(error.message || "Extraction failed");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleDirectExtract(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenInEditor = async () => {
    if (!isAuthenticated || !extractedText) return;
    setIsCreatingProject(true);
    try {
      const title = pdf?.title?.replace(/\.pdf$/i, "") || "Untitled";
      const imgs: ImageRef[] = extractedImages.map((img, i) => ({
        src: img.src,
        page: img.page,
        caption: `Figure from page ${img.page}`,
      }));
      const latexContent = markdownToLatex(extractedText, {
        title,
        wrapDocument: true,
        images: imgs,
      });
      const project = await projectsAPI.createProject(title,
        latexContent,
      );
      toast.success("Opened in editor");
      router.push(`/projects/${project.uid}`);
    } catch (error) {
      console.error("Error creating project:", error);
      toast.error("Failed to open in editor");
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0 && allPdfs.length > 0) {
      router.push(`/pdfs/${allPdfs[currentIndex - 1].id}`);
    }
  };

  const handleNext = () => {
    if (currentIndex < allPdfs.length - 1 && allPdfs.length > 0) {
      router.push(`/pdfs/${allPdfs[currentIndex + 1].id}`);
    }
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(extractedText);
    toast.success("Copied to clipboard");
  };

  const handleDownloadText = () => {
    const title = pdf?.title?.replace(/\.pdf$/i, "") || "extracted";
    const imgs: ImageRef[] = extractedImages.map((img, i) => ({
      src: img.src,
      page: img.page,
      caption: `Figure from page ${img.page}`,
    }));
    const latexContent = markdownToLatex(extractedText, {
      title,
      wrapDocument: true,
      images: imgs,
    });
    const el = document.createElement("a");
    const file = new Blob([latexContent], { type: "text/x-tex" });
    el.href = URL.createObjectURL(file);
    el.download = `${title}.tex`;
    document.body.appendChild(el);
    el.click();
    document.body.removeChild(el);
    toast.success("Downloaded as LaTeX");
  };

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

  const calculateStats = (text: string) => {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const characters = text.length;
    const lines = text.split("\n").length;
    const math = (text.match(/\$[^$\n]+\$/g) || []).length;
    const doubleDollarMatches = (text.match(/\$\$[\s\S]*?\$\$/g) || []).length;
    const equationEnvMatches = (
      text.match(/\\begin\{(equation|equation\*|align|align\*)\}/g) || []
    ).length;
    const equations = doubleDollarMatches + equationEnvMatches;
    return { words, characters, lines, math, equations };
  };

  const stats = extractedText
    ? calculateStats(extractedText)
    : { words: 0, characters: 0, lines: 0, math: 0, equations: 0 };

  // The PDF view is a full-screen tool like the editor: while it loads it shows the quiet loading screen, and a PDF that is not there gets the status page.
  if (isLoading) return <LoadingScreen label="Loading the PDF" />;

  if (!pdf) {
    return <StatusPage kind="pdf-missing" actions={[{ label: "Go to PDFs", href: "/pdfs" }, { label: "Go back", back: true, fallback: "/pdfs" }]} />;
  }

  const imageProps = extractedImages.map((img) => ({
    src: img.src,
    page: img.page,
  }));

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-background shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => router.push("/pdfs")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h1 className="text-sm font-semibold truncate">{pdf.title}</h1>
          {getStatusBadge(pdf.status)}
        </div>

        {allPdfs.length > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handlePrevious}
              disabled={currentIndex === 0}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {currentIndex + 1}/{allPdfs.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleNext}
              disabled={currentIndex === allPdfs.length - 1}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        <Separator orientation="vertical" className="h-5" />

        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-0.5 bg-surface rounded-md p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={layout === "pdf" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setLayout("pdf")}
                >
                  <PanelLeft className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">PDF only</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={layout === "split" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setLayout("split")}
                >
                  <Columns2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Split view</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={layout === "content" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setLayout("content")}
                >
                  <PanelRight className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Content only</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>

        <Separator orientation="vertical" className="h-5" />

        <div className="flex items-center gap-1">
          {(pdf.status === "pending" ||
            (pdf.status === "error" && !extractedText)) && (
            <Button
              size="sm"
              onClick={handleProcessPdf}
              disabled={isProcessing}
              className="h-8 text-xs"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Play className="me-1.5 h-3.5 w-3.5" />
                  Process
                </>
              )}
            </Button>
          )}

          {(pdf.status === "error" || pdf.status === "completed") &&
            extractedText && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={handleProcessPdf}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                    Retrying...
                  </>
                ) : (
                  <>
                    <RotateCcw className="me-1.5 h-3.5 w-3.5" />
                    Retry
                  </>
                )}
              </Button>
            )}

          {extractedText && (
            <Button
              variant="default"
              size="sm"
              className="h-8 text-xs"
              onClick={handleOpenInEditor}
              disabled={isCreatingProject}
            >
              {isCreatingProject ? (
                <>
                  <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  Opening...
                </>
              ) : (
                <>
                  <PenLine className="me-1.5 h-3.5 w-3.5" />
                  Open in Editor
                </>
              )}
            </Button>
          )}

          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIsInfoDialogOpen(true)}
                >
                  <Info className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>File info & stats</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {layout === "split" ? (
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            <ResizablePanel defaultSize={50} minSize={25}>
              <PdfPanel
                previewUrl={previewUrl}
                zoom={pdfZoom}
                onZoomIn={() => setPdfZoom((z) => Math.min(z + 25, 300))}
                onZoomOut={() => setPdfZoom((z) => Math.max(z - 25, 25))}
                onZoomReset={() => setPdfZoom(100)}
                onZoomChange={setPdfZoom}
                isInverted={pdfInverted}
                onToggleInvert={() => setPdfInverted((v) => !v)}
              />
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={50} minSize={25}>
              <ContentPanel
                extractedText={extractedText}
                originalExtractedText={originalExtractedText}
                images={imageProps}
                isExtractingImages={isExtractingImages}
                extractedImageCount={extractedImages.length}
                rightTab={rightTab}
                onTabChange={setRightTab}
                onTextChange={setExtractedText}
                onSave={handleSaveText}
                onReset={handleResetText}
                onCopy={handleCopyText}
                onDownload={handleDownloadText}
                onProcess={handleProcessPdf}
                isProcessing={isProcessing}
                pdfStatus={pdf.status}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : layout === "pdf" ? (
          <PdfPanel
            previewUrl={previewUrl}
            zoom={pdfZoom}
            onZoomIn={() => setPdfZoom((z) => Math.min(z + 25, 300))}
            onZoomOut={() => setPdfZoom((z) => Math.max(z - 25, 25))}
            onZoomReset={() => setPdfZoom(100)}
            onZoomChange={setPdfZoom}
            isInverted={pdfInverted}
            onToggleInvert={() => setPdfInverted((v) => !v)}
          />
        ) : (
          <ContentPanel
            extractedText={extractedText}
            originalExtractedText={originalExtractedText}
            images={imageProps}
            isExtractingImages={isExtractingImages}
            extractedImageCount={extractedImages.length}
            rightTab={rightTab}
            onTabChange={setRightTab}
            onTextChange={setExtractedText}
            onSave={handleSaveText}
            onReset={handleResetText}
            onCopy={handleCopyText}
            onDownload={handleDownloadText}
            onProcess={handleProcessPdf}
            isProcessing={isProcessing}
            pdfStatus={pdf.status}
          />
        )}
      </div>

      {/* Info Dialog */}
      <Dialog open={isInfoDialogOpen} onOpenChange={setIsInfoDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>File information</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 text-sm mt-2">
            <div className="text-muted-foreground">File name</div>
            <div className="font-medium truncate" title={pdf.title}>
              {pdf.title}
            </div>
            <div className="text-muted-foreground">Pages</div>
            <div className="font-medium">
              {pdf.pageCount || pdf.metadata?.pages || "?"}
            </div>
            <div className="text-muted-foreground">File size</div>
            <div className="font-medium">{pdf.metadata?.size || "?"}</div>
            <div className="text-muted-foreground">Uploaded</div>
            <div className="font-medium">
              <RelativeTime value={pdf.createdAt} format="date" />
            </div>
            {extractedImages.length > 0 && (
              <>
                <div className="text-muted-foreground">Images found</div>
                <div className="font-medium">{extractedImages.length}</div>
              </>
            )}
            {extractedText && (
              <>
                <div className="col-span-2 pt-2">
                  <Separator />
                </div>
                <div className="text-muted-foreground">Words</div>
                <div className="font-medium">
                  {stats.words.toLocaleString()}
                </div>
                <div className="text-muted-foreground">Characters</div>
                <div className="font-medium">
                  {stats.characters.toLocaleString()}
                </div>
                <div className="text-muted-foreground">Lines</div>
                <div className="font-medium">
                  {stats.lines.toLocaleString()}
                </div>
                <div className="text-muted-foreground">Inline math</div>
                <div className="font-medium">{stats.math.toLocaleString()}</div>
                <div className="text-muted-foreground">Display equations</div>
                <div className="font-medium">
                  {stats.equations.toLocaleString()}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────── PDF Panel ─────────────────────── */

function PdfPanel({
  previewUrl,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onZoomChange,
  isInverted = false,
  onToggleInvert,
}: {
  previewUrl: string | null;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomChange?: (zoom: number) => void;
  isInverted?: boolean;
  onToggleInvert?: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-surface/30 shrink-0">
        <span className="text-xs font-medium text-muted-foreground">
          PDF Preview
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-6 w-6",
              isInverted && "bg-surface-hover text-foreground",
            )}
            onClick={onToggleInvert}
            title="Invert colors"
          >
            <Moon className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onZoomOut}
            disabled={zoom <= 25}
          >
            <ZoomOut className="h-3 w-3" />
          </Button>
          <button
            onClick={onZoomReset}
            className="text-xs text-muted-foreground hover:text-foreground tabular-nums min-w-[3rem] text-center"
          >
            {zoom}%
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onZoomIn}
            disabled={zoom >= 300}
          >
            <ZoomIn className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-surface/20">
        {previewUrl ? (
          <div className="w-full h-full">
            <PDFViewer
              url={previewUrl}
              zoom={zoom}
              isInverted={isInverted}
              className="w-full h-full"
              onZoomChange={onZoomChange}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">Preview not available</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────── Content Panel ─────────────────────── */

function ContentPanel({
  extractedText,
  originalExtractedText,
  images,
  isExtractingImages,
  extractedImageCount,
  rightTab,
  onTabChange,
  onTextChange,
  onSave,
  onReset,
  onCopy,
  onDownload,
  onProcess,
  isProcessing,
  pdfStatus,
}: {
  extractedText: string;
  originalExtractedText: string;
  images: { src: string; page?: number }[];
  isExtractingImages: boolean;
  extractedImageCount: number;
  rightTab: "rendered" | "source";
  onTabChange: (tab: "rendered" | "source") => void;
  onTextChange: (text: string) => void;
  onSave: () => void;
  onReset: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onProcess: () => void;
  isProcessing: boolean;
  pdfStatus: string;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-surface/30 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-background rounded-md border p-0.5">
            <button
              onClick={() => onTabChange("rendered")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                rightTab === "rendered"
                  ? "bg-accent text-on-accent"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Eye className="h-3 w-3" />
              Rendered
            </button>
            <button
              onClick={() => onTabChange("source")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                rightTab === "source"
                  ? "bg-accent text-on-accent"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Code className="h-3 w-3" />
              Source
            </button>
          </div>

          {isExtractingImages && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Extracting images...
            </span>
          )}

          {!isExtractingImages && extractedImageCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ImageIcon className="h-3 w-3" />
              {extractedImageCount} image{extractedImageCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {extractedText && (
          <div className="flex items-center gap-1">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={onCopy}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={onDownload}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Download .tex</TooltipContent>
              </Tooltip>
              {extractedText !== originalExtractedText && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={onReset}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reset to original</TooltipContent>
                </Tooltip>
              )}
            </TooltipProvider>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {extractedText ? (
          rightTab === "rendered" ? (
            <div className="p-6 overflow-auto h-full">
              <MarkdownRenderer content={extractedText} images={images} />
            </div>
          ) : (
            <div className="h-full flex flex-col">
              <Textarea
                value={extractedText}
                onChange={(e) => onTextChange(e.target.value)}
                onBlur={onSave}
                placeholder="Extracted content..."
                className="flex-1 font-mono text-sm border-0 rounded-none resize-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-sm font-medium mb-1">No content extracted yet</p>
            <p className="text-xs text-muted-foreground mb-4">
              Process this PDF to extract its content as LaTeX / Markdown
            </p>
            {(pdfStatus === "pending" || pdfStatus === "error") && (
              <Button onClick={onProcess} disabled={isProcessing} size="sm">
                {isProcessing ? (
                  <>
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Play className="me-1.5 h-3.5 w-3.5" />
                    Process PDF
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

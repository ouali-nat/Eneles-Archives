"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Snip, snipsAPI } from "@/lib/api";
import { ArrowLeft, ImageIcon, Copy, Download, Play, Loader2, Calendar, FileIcon, Hash, Type, Calculator, HardDrive, ChevronLeft, ChevronRight, Info, RotateCcw } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { StatusPage } from "@/components/essential/status/StatusPage";
import { Container } from "@/components/ui/container";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RelativeTime } from "@/components/ui/time";

interface SnipWithTags extends Snip {
  imageUrl?: string;
  metadata?: {
    size?: string;
  };
}

export default function SnipDetailPage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const params = useParams();
  const snipId = params.id as string;

  const [snip, setSnip] = useState<SnipWithTags | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedText, setExtractedText] = useState<string>("");
  const [originalExtractedText, setOriginalExtractedText] =
    useState<string>("");
  const [allSnips, setAllSnips] = useState<Snip[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);

  // Show the loader again whenever a new fetch starts (a sign-in or another snip). The first fetch needs nothing: `isLoading` starts true.
  const fetchKey = isAuthenticated && snipId ? snipId : null;
  const [fetchedKey, setFetchedKey] = useState(fetchKey);
  if (fetchedKey !== fetchKey) {
    setFetchedKey(fetchKey);
    if (fetchKey) setIsLoading(true);
  }

  useEffect(() => {
    if (!isAuthenticated || !snipId) return;

    const fetchSnip = async () => {
      try {
        const data = await snipsAPI.getSnip(snipId);

        // Fetch the image URL from backend
        let imageUrl: string | null = null;
        try {
          imageUrl = await snipsAPI.getSnipImageUrl(snipId);
        } catch (error) {
          console.error(`Failed to get image URL for snip ${snipId}:`, error);
        }

        setSnip({
          ...data,
          imageUrl: imageUrl || undefined,
          title: data.title || `Snip-${data.id}`,
        });
        const latexContent = data.latexContent || "";
        setExtractedText(latexContent);
        setOriginalExtractedText(latexContent);
      } catch (error) {
        console.error("Error fetching snip:", error);
        toast.error("Failed to load snip");
        router.push("/snips");
      } finally {
        setIsLoading(false);
      }
    };

    const fetchAllSnips = async () => {
      try {
        const res = await snipsAPI.getMySnips();
        setAllSnips(res.data);
      } catch (error) {
        console.error("Error fetching all snips:", error);
      }
    };

    fetchSnip();
    fetchAllSnips();
  }, [isAuthenticated, snipId, router]);

  // Follow the open snip's position in the list. A snip that is not in the list leaves the position where it was.
  if (allSnips.length > 0 && snipId) {
    const index = allSnips.findIndex((s) => s.id.toString() === snipId);
    if (index !== -1 && index !== currentIndex) {
      setCurrentIndex(index);
    }
  }

  const handlePrevious = () => {
    if (currentIndex > 0 && allSnips.length > 0) {
      const prevSnip = allSnips[currentIndex - 1];
      router.push(`/snips/${prevSnip.id}`);
    }
  };

  const handleNext = () => {
    if (currentIndex < allSnips.length - 1 && allSnips.length > 0) {
      const nextSnip = allSnips[currentIndex + 1];
      router.push(`/snips/${nextSnip.id}`);
    }
  };

  const handleResetText = () => {
    setExtractedText(originalExtractedText);
    toast.success("Text reset to original");
  };

  const handleSaveText = async () => {
    if (!isAuthenticated || !snipId || extractedText === originalExtractedText) return;

    try {
      await snipsAPI.updateSnip(snipId, {
        latexCode: extractedText,
      });
      setOriginalExtractedText(extractedText);
      toast.success("Text saved successfully");
    } catch (error) {
      console.error("Error saving text:", error);
      toast.error("Failed to save text");
    }
  };

  const handleProcessSnip = async () => {
    if (!isAuthenticated || !snipId) return;

    setIsProcessing(true);
    try {
      const result = await snipsAPI.processSnip(snipId);
      const latexContent = result.latexContent || "";
      setExtractedText(latexContent);
      setOriginalExtractedText(latexContent);

      setSnip((prev) =>
        prev
          ? {
              ...prev,
              latexContent: latexContent,
              status: result.status as any,
            }
          : null,
      );

      toast.success("Snip processed successfully");
    } catch (error: any) {
      console.error("Failed to process snip:", error);
      toast.error(error.message || "Failed to process snip");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(extractedText);
    toast.success("Text copied to clipboard");
  };

  const handleDownloadText = () => {
    const element = document.createElement("a");
    const file = new Blob([extractedText], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = snip
      ? `${snip.title?.replace(/\.[^/.]+$/, "") || "extracted"}-latex.txt`
      : "extracted-latex.txt";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success("Text file downloaded");
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

    // Count math (inline): $...$ (single dollar signs)
    const math = (text.match(/\$[^$\n]+\$/g) || []).length;

    // Count equations (display): $$...$$ or \begin{equation}, \begin{equation*}, \begin{align}, \begin{align*}
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

  if (isLoading) {
    // The page's own shape: the back button, the title and its status line, and the main card with the image's box.
    return (
      <Container>
        <div role="status" aria-label="Loading the snip" className="space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" aria-label="Back to snips" onClick={() => router.push("/snips")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1">
              <SkeletonText className="text-3xl" width="min(24rem, 70%)" />
              <SkeletonText className="mt-1" width="5rem" />
            </div>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Image & Extracted Content</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-center">
                <Skeleton className="h-[400px] w-full max-w-2xl rounded-md" />
              </div>
            </CardContent>
          </Card>
        </div>
      </Container>
    );
  }

  if (!snip) {
    return <StatusPage kind="snip-missing" frame="fill" actions={[{ label: "Go to snips", href: "/snips" }, { label: "Go back", back: true, fallback: "/snips" }]} />;
  }

  return (
    <Container>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/snips")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h2 className="text-3xl font-bold tracking-tight">{snip.title}</h2>
            <p className="text-muted-foreground mt-1">
              {getStatusBadge(snip.status)}
            </p>
          </div>

          {/* Navigation Controls */}
          {allSnips.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={handlePrevious}
                disabled={currentIndex === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground min-w-[3rem] text-center">
                {currentIndex + 1}/{allSnips.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleNext}
                disabled={currentIndex === allSnips.length - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsInfoDialogOpen(true)}
              >
                <Info className="h-4 w-4" />
              </Button>
            </div>
          )}

          {snip.status === "pending" || snip.status === "error" ? (
            <Button onClick={handleProcessSnip} disabled={isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Play className="me-2 h-4 w-4" />
                  Process snip
                </>
              )}
            </Button>
          ) : null}
        </div>

        <div className="space-y-6">
          {/* Main Card - Image and Extraction */}
          <Card>
            <CardHeader>
              <CardTitle>Image & Extracted Content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Image Preview - Centered */}
              <div className="flex justify-center">
                <div className="border rounded-md overflow-hidden bg-surface/30 max-w-2xl w-full">
                  {snip.imageUrl ? (
                    <img
                      src={snip.imageUrl}
                      alt={snip.title || "Snip"}
                      className="w-full h-auto object-contain"
                    />
                  ) : (
                    <div className="w-full h-[400px] flex items-center justify-center text-muted-foreground">
                      <p>Image not available</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Extracted Content with Tabs */}
              <Tabs defaultValue="latex" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="latex">LaTeX</TabsTrigger>
                  <TabsTrigger value="md">MD</TabsTrigger>
                  <TabsTrigger value="docx">DOCX</TabsTrigger>
                </TabsList>

                <TabsContent value="latex" className="space-y-4">
                  {extractedText ? (
                    <>
                      <div className="relative">
                        <Textarea
                          value={extractedText}
                          onChange={(e) => setExtractedText(e.target.value)}
                          onBlur={handleSaveText}
                          placeholder="Extracted LaTeX will appear here..."
                          className="h-[600px] font-mono text-sm pe-12"
                        />
                        {extractedText !== originalExtractedText && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleResetText}
                            className="absolute bottom-2 end-2 h-8 w-8"
                            title="Reset to original"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={handleCopyText}
                          disabled={!extractedText}
                        >
                          <Copy className="me-2 h-4 w-4" />
                          Copy
                        </Button>
                        <Button
                          className="flex-1"
                          onClick={handleDownloadText}
                          disabled={!extractedText}
                        >
                          <Download className="me-2 h-4 w-4" />
                          Download
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <ImageIcon className="h-10 w-10 text-muted-foreground mb-4" />
                      <p className="text-sm font-medium mb-2">
                        No content extracted
                      </p>
                      <p className="text-xs text-muted-foreground mb-4">
                        Click &quot;Process Snip&quot; to extract LaTeX from
                        this image
                      </p>
                      <Button
                        onClick={handleProcessSnip}
                        disabled={isProcessing}
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="me-2 h-3 w-3 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <Play className="me-2 h-3 w-3" />
                            Process snip
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="md" className="space-y-4">
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-sm text-muted-foreground">
                      Markdown conversion coming soon
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="docx" className="space-y-4">
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-sm text-muted-foreground">
                      DOCX conversion coming soon
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Info Dialog */}
        <Dialog open={isInfoDialogOpen} onOpenChange={setIsInfoDialogOpen}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>FileIcon Information & Statistics</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 mt-4">
              <div className="flex items-start gap-3">
                <FileIcon className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium mb-1">FileIcon Name</p>
                  <p
                    className="text-sm text-muted-foreground"
                    title={snip.title}
                  >
                    {snip.title}
                  </p>
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1 flex items-center justify-between">
                  <p className="text-sm font-medium">FileIcon Size</p>
                  <p className="text-sm text-muted-foreground">
                    {snip.fileSize
                      ? (() => {
                          const bytes = snip.fileSize;
                          if (bytes < 1024) return `${bytes} B`;
                          if (bytes < 1024 * 1024)
                            return `${(bytes / 1024).toFixed(1)} KB`;
                          return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
                        })()
                      : "?"}
                  </p>
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1 flex items-center justify-between">
                  <p className="text-sm font-medium">Uploaded</p>
                  <p className="text-sm text-muted-foreground">
                    <RelativeTime value={snip.createdAt} />
                  </p>
                </div>
              </div>
              {extractedText && (
                <>
                  <Separator />
                  <div className="flex items-center gap-3">
                    <Type className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 flex items-center justify-between">
                      <p className="text-sm font-medium">Words</p>
                      <p className="text-sm text-muted-foreground">
                        {stats.words.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-center gap-3">
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 flex items-center justify-between">
                      <p className="text-sm font-medium">Characters</p>
                      <p className="text-sm text-muted-foreground">
                        {stats.characters.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-center gap-3">
                    <FileIcon className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 flex items-center justify-between">
                      <p className="text-sm font-medium">Lines</p>
                      <p className="text-sm text-muted-foreground">
                        {stats.lines.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-center gap-3">
                    <Type className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 flex items-center justify-between">
                      <p className="text-sm font-medium">Math</p>
                      <p className="text-sm text-muted-foreground">
                        {stats.math.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-center gap-3">
                    <Calculator className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 flex items-center justify-between">
                      <p className="text-sm font-medium">Equations</p>
                      <p className="text-sm text-muted-foreground">
                        {stats.equations.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Container>
  );
}

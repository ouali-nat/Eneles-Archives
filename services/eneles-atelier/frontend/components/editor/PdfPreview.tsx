"use client";

import { forwardRef, useState, useRef, useCallback, useEffect, useImperativeHandle } from "react";
import { ZoomIn, ZoomOut, Download, Loader2, AlertCircle, Play, ChevronDown, RotateCcw, StopCircle, Moon, MousePointer2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PDFViewer } from "@/components/essential/pdf/PDFViewer";
import type { PdfHighlight } from "@/components/essential/pdf/PDFViewerClient";
import { loadSyncTex, mapInputsToProject, resolvePdfJump, resolveSourceJump, type ClickedWord, type PageGeometry, type SourceJump, type SourceTexts, type SyncFileMap, type SyncTexIndex } from "@/lib/synctex";
import { announceSourceJump, compiledSourcesOf, onShowInPdf, readEditorCursor, type EditorCursor } from "@/lib/synctex-bridge";
import { downloadCompiledPdf, pdfFileName } from "@/lib/editor/download-pdf";
import { findBibEntry, isBibliographyCallSite } from "@/lib/bib-jump";
import { toast } from "sonner";

import type { BuildKey } from "@/hooks/useCompile";
import { BusyFaces, Spinner, useBusyState } from "@/components/ui/status";


/** PDF source: either a URL string or raw binary data for react-pdf */
type PdfSource = string | { data: Uint8Array };

interface PdfPreviewProps {
  pdfUrl: PdfSource | null;
  /** S3 builds-bucket key for the archived PDF */
  buildKey?: BuildKey;
  /** Project UID, needed for the download proxy URL */
  projectId?: string;
  /** Signed in, so the archived PDF can be downloaded through the API */
  isAuthenticated?: boolean;
  /** What the downloaded file is called: the project's title. */
  fileName?: string;
  isCompiling?: boolean;
  errors?: string[];
  compileDuration?: number;
  onCompile?: () => void;
  onStopCompile?: () => void;
  autoCompile?: boolean;
  onToggleAutoCompile?: () => void;
  compileMode?: string;
  onCompileModeChange?: (mode: string) => void;
  stopOnFirstError?: boolean;
  onToggleStopOnFirstError?: () => void;
  onRecompileFromScratch?: () => void;
  /** Every text file of the project as it is now, by project path: tells project files from package files, and where lines moved since the compile */
  sourceFiles?: Record<string, string>;
  /** base64 <main>.synctex.gz from the last compile: what both directions of line jumping are resolved from */
  synctexData?: string | null;
  /** The text of each file as the last compile read it (`compiledSources` from useCompile). Without it the hook's own copy is used. */
  compiledSources?: Record<string, string> | null;
  /** Main document path (e.g. "main.tex"): the anchor for turning TeX's file names into project paths */
  mainFile?: string;
  /**
   * Called when a double-click in the PDF resolved to a source position. `line` is 1-based and already corrected for edits made since the compile; `word` is the clicked word. `target` carries the exact column and length for `LatexEditorHandle.revealSourcePosition`.
   */
  onSourceJump?: (line: number, filePath: string, word?: string, target?: SourceJump) => void;
  /** Saves the PDF in place of the browser's download (the desktop app asks where with the system's dialog). */
  onDownload?: () => Promise<void>;
  /** The PDF theme from Settings: "dark" shows the pages inverted, as the panel's own invert button does. */
  pdfTheme?: string;
}

export interface PdfPreviewHandle {
  /**
   * Scroll the PDF to where a source position was typeset and flash it. `line` is 1-based, `column` 0-based, both in the text as it is in the editor now. Without arguments, the editor's cursor is used. Resolves to false when there is nothing to show (no compile yet, or a file TeX did not read).
   */
  showSourcePosition: (path?: string, line?: number, column?: number) => Promise<boolean>;
}

export const PdfPreview = forwardRef<PdfPreviewHandle, PdfPreviewProps>(function PdfPreview({
  pdfUrl,
  buildKey,
  projectId,
  isAuthenticated,
  fileName,
  isCompiling = false,
  errors = [],
  compileDuration,
  onCompile,
  onStopCompile,
  autoCompile = false,
  onToggleAutoCompile,
  compileMode,
  onCompileModeChange,
  stopOnFirstError = false,
  onToggleStopOnFirstError,
  onRecompileFromScratch,
  sourceFiles,
  synctexData,
  compiledSources,
  mainFile,
  onSourceJump,
  onDownload,
  pdfTheme,
}, ref) {
  const compileState = useBusyState(isCompiling, errors.length > 0);
  const [zoom, setZoom] = useState(100);
  const [isInverted, setIsInverted] = useState(pdfTheme === "dark");
  // Changing the setting sets the panel's invert button to match; the button still flips it for the moment.
  useEffect(() => {
    if (pdfTheme) setIsInverted(pdfTheme === "dark");
  }, [pdfTheme]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [highlight, setHighlight] = useState<PdfHighlight | null>(null);

  const handleZoomIn = useCallback(
    () => setZoom((z) => Math.min(z + 25, 300)),
    [],
  );
  const handleZoomOut = useCallback(
    () => setZoom((z) => Math.max(z - 25, 25)),
    [],
  );
  const handleResetZoom = useCallback(() => setZoom(100), []);

  const handleDownload = useCallback(async () => {
    if (!pdfUrl) return;
    setIsDownloading(true);
    try {
      if (onDownload) await onDownload();
      else await downloadCompiledPdf({ pdfUrl, buildKey: buildKey ?? null, projectId, isAuthenticated: !!isAuthenticated, fileName: pdfFileName(fileName) });
    } catch (err) {
      console.error("PDF download failed:", err);
      toast.error("The PDF could not be downloaded. Compile again, then try once more.");
    } finally {
      setIsDownloading(false);
    }
  }, [pdfUrl, buildKey, projectId, isAuthenticated, fileName, onDownload]);

  // ── Line jumping ──
  // Everything is resolved from the SyncTeX data of the last compile (see lib/synctex.ts). The values a lookup needs are read through refs, so the handlers stay stable while files change under them.
  const sourceFilesRef = useRef(sourceFiles);
  sourceFilesRef.current = sourceFiles;
  const compiledRef = useRef(compiledSources);
  compiledRef.current = compiledSources ?? compiledSourcesOf(synctexData);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const fileMapRef = useRef<{ index: SyncTexIndex; paths: string; main: string | undefined; map: SyncFileMap } | null>(null);
  /** Each page's box and rotation, as the viewer reports them. A landscape page needs it: its text was turned by a PDF transformation SyncTeX knows nothing about. */
  const pageGeometryRef = useRef<Map<number, PageGeometry>>(new Map());
  const notePageGeometry = useCallback((page: number, geometry: PageGeometry) => {
    pageGeometryRef.current.set(page, geometry);
  }, []);

  /** The parsed SyncTeX data with TeX's file names matched to project paths; null when there is nothing to resolve against. */
  const loadIndex = useCallback(async (): Promise<{ index: SyncTexIndex; files: SyncFileMap } | null> => {
    if (!synctexData) return null;
    const index = await loadSyncTex(synctexData);
    if (!index) return null;
    const paths = Object.keys(sourceFilesRef.current ?? {});
    const key = paths.join("\n");
    const cached = fileMapRef.current;
    if (cached && cached.index === index && cached.paths === key && cached.main === mainFile) return { index, files: cached.map };
    const map = mapInputsToProject(index, paths, mainFile);
    fileMapRef.current = { index, paths: key, main: mainFile, map };
    return { index, files: map };
  }, [synctexData, mainFile]);

  /** The compiled text and the text as it is now. The open file is read from the editor itself, which is ahead of saved state while someone types. */
  const texts = useCallback((): SourceTexts => {
    const cursor = readEditorCursor();
    return {
      compiled: (path) => compiledRef.current?.[path],
      // An empty string is a file whose text is not on hand (not loaded yet), not a file known to be empty.
      current: (path) => (cursor && cursor.path === path ? cursor.text : sourceFilesRef.current?.[path] || undefined),
    };
  }, []);

  // PDF → source. SyncTeX names the file and line, the clicked word names the column, and the compiled text set against the current one moves the answer to where that line is now.
  const handleDoubleClickPosition = useCallback(
    async (page: number, xPt: number, yPt: number, text: string, word: ClickedWord | null) => {
      if (!onSourceJump) return;
      const loaded = await loadIndex();
      if (!loaded) {
        toast.info("Recompile to jump between the PDF and the source", { duration: 2500 });
        return;
      }
      const jump = resolveSourceJump(loaded.index, loaded.files, texts(), page, xPt, yPt, word, pageGeometryRef.current.get(page));
      if (!jump) {
        toast.info("Nothing in the source matches that spot", { duration: 2000 });
        return;
      }
      // A click in the reference list resolves to where the list is asked for, not to the entry. Find the entry in the project's .bib files by the words that were clicked, and go there instead.
      const landed = (texts().current(jump.path) ?? "").split("\n")[jump.line - 1];
      if (isBibliographyCallSite(landed)) {
        const bibFiles = Object.fromEntries(Object.entries(sourceFilesRef.current ?? {}).filter(([path, content]) => path.toLowerCase().endsWith(".bib") && !!content));
        const entry = findBibEntry(bibFiles, word, text);
        if (entry) {
          announceSourceJump(entry);
          onSourceJump(entry.line, entry.path, word?.word || undefined, entry);
          return;
        }
      }
      announceSourceJump(jump);
      onSourceJump(jump.line, jump.path, word?.word || text.split(" ")[0] || undefined, jump);
      if (!jump.exact) toast.info("This part changed since the last compile, so the jump is approximate. Recompile for an exact one.", { duration: 3500 });
    },
    [onSourceJump, loadIndex, texts],
  );

  // Source → PDF.
  const showSourcePosition = useCallback(
    async (path?: string, line?: number, column?: number): Promise<boolean> => {
      let cursor: EditorCursor | null = readEditorCursor();
      if (path !== undefined && line !== undefined) {
        const text = cursor && cursor.path === path ? cursor.text : (sourceFilesRef.current?.[path] ?? "");
        cursor = { path, line, column: column ?? 0, text };
      }
      if (!cursor) {
        toast.info("Open a source file to show its place in the PDF", { duration: 2500 });
        return false;
      }
      const loaded = await loadIndex();
      if (!loaded) {
        toast.info("Compile first to see where this line lands in the PDF", { duration: 2500 });
        return false;
      }
      const at = cursor;
      const base = texts();
      const jump = resolvePdfJump(loaded.index, loaded.files, { compiled: base.compiled, current: (p) => (p === at.path ? at.text : base.current(p)) }, at.path, at.line, at.column, currentPageRef.current, (page) => pageGeometryRef.current.get(page));
      if (!jump) {
        toast.info(loaded.files.tagsOfPath.has(at.path) ? "This line has no place in the PDF yet. Recompile to see it." : "This file is not part of the compiled document", { duration: 2500 });
        return false;
      }
      setHighlight({ rects: jump.rects, primary: jump.primary, word: jump.exact ? jump.word : null });
      if (!jump.current) toast.info("This line changed since the last compile, so the highlight is approximate. Recompile for an exact one.", { duration: 3500 });
      return true;
    },
    [loadIndex, texts],
  );
  useImperativeHandle(ref, () => ({ showSourcePosition }), [showSourcePosition]);
  // The editor's shortcut arrives here.
  useEffect(() => onShowInPdf((cursor) => void showSourcePosition(cursor.path, cursor.line, cursor.column)), [showSourcePosition]);
  // A highlight and the page geometry belong to the PDF they were computed for.
  useEffect(() => {
    setHighlight(null);
    pageGeometryRef.current = new Map();
  }, [synctexData]);

  return (
    <div data-tour="pdf" className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="editor-bar flex items-center gap-1 px-2 border-b border-line bg-surface/30 shrink-0">
        {/* Left: Recompile button with dropdown */}
        <div className="flex items-center gap-0.5">
          <Button
            size="sm"
            variant="default"
            className="rounded-e-none px-3 aria-busy:cursor-progress"
            aria-busy={isCompiling || undefined}
            aria-disabled={isCompiling || undefined}
            onClick={() => {
              if (!isCompiling) onCompile?.();
            }}
          >
            <BusyFaces state={compileState} busyLabel="Compiling" successLabel="Compiled" errorLabel="Failed">
              <Play className="size-4" />
              Recompile
            </BusyFaces>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="default"
                className="w-8 p-0 rounded-s-none border-s border-on-accent/20"
                disabled={isCompiling}
                aria-label="Compile options"
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={onToggleAutoCompile}>
                <span className="flex-1">Auto compile</span>
                <span className="text-xs text-muted-foreground">
                  {autoCompile ? "On" : "Off"}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  onCompileModeChange?.(
                    compileMode === "normal" ? "draft" : "normal",
                  )
                }
              >
                <span className="flex-1">Compile mode</span>
                <span className="text-xs text-muted-foreground">
                  {compileMode === "draft" ? "Draft" : "Normal"}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleStopOnFirstError}>
                <span className="flex-1">Stop on first error</span>
                <span className="text-xs text-muted-foreground">
                  {stopOnFirstError ? "On" : "Off"}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isCompiling && (
                <DropdownMenuItem onClick={onStopCompile}>
                  <StopCircle className="size-4 me-2 text-danger" />
                  Stop compilation
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onRecompileFromScratch}>
                <RotateCcw className="size-4 me-2" />
                Recompile from scratch
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Download PDF button */}
        <Button
          variant="outline"
          size="sm"
          className="size-8 p-0 ms-1"
          onClick={handleDownload}
          disabled={!pdfUrl || isCompiling || isDownloading}
          title="Download PDF"
        >
          {isDownloading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
        </Button>

        {/* Compile duration */}
        {compileDuration !== undefined && !isCompiling && (
          <span className="text-[10px] text-muted-foreground ms-1">
            {(compileDuration / 1000).toFixed(1)}s
          </span>
        )}

        {/* Center: page indicator */}
        <div className="flex-1 flex items-center justify-center">
          {totalPages > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {currentPage} / {totalPages}
            </span>
          )}
        </div>

        {/* Show the editor's cursor position in the PDF */}
        <Button
          variant="ghost"
          size="sm"
          className="size-8 p-0 me-1"
          onClick={() => void showSourcePosition()}
          disabled={!pdfUrl || !synctexData}
          title="Show cursor position in PDF"
          aria-label="Show cursor position in PDF"
        >
          <MousePointer2 className="size-4" />
        </Button>

        {/* Invert Colors Button */}
        <Button
          variant="ghost"
          size="sm"
          className={`size-8 p-0 me-1 ${isInverted ? "bg-surface-hover text-foreground" : ""}`}
          onClick={() => setIsInverted(!isInverted)}
          title="Invert colors"
        >
          <Moon className="size-4" />
        </Button>

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            onClick={handleZoomOut}
            title="Zoom out"
          >
            <ZoomOut className="size-4" />
          </Button>
          <button
            className="h-8 px-2 type-small text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleResetZoom}
            title="Reset zoom"
          >
            {zoom}%
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            onClick={handleZoomIn}
            title="Zoom in"
          >
            <ZoomIn className="size-4" />
          </Button>
        </div>
      </div>

      {/* While a compile runs over an existing PDF, the PDF stays and a thin bar moves under the toolbar. */}
      <div aria-hidden className="relative h-0.5 shrink-0 overflow-hidden">
        {isCompiling && <span className="absolute inset-y-0 start-0 w-1/3 rounded-full bg-accent [animation:indeterminate_1.1s_ease-in-out_infinite] motion-still:w-full motion-still:[animation:none] motion-still:opacity-60" />}
      </div>

      {/* ── PDF / Placeholder ── */}
      <div className="flex-1 min-h-0 overflow-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {isCompiling && !pdfUrl ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Spinner className="size-5" />
            <p className="type-base">Compiling</p>
          </div>
        ) : errors.length > 0 && !isCompiling ? (
          <div className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-danger text-sm font-medium mb-3">
              <AlertCircle className="h-4 w-4" />
              Compilation errors
            </div>
            {errors.map((e, i) => (
              <div
                key={i}
                className="bg-danger/10 border border-danger/20 rounded px-3 py-2 text-xs text-danger font-mono"
              >
                {e}
              </div>
            ))}
          </div>
        ) : pdfUrl ? (
          <PDFViewer
            url={pdfUrl}
            zoom={zoom}
            isInverted={isInverted}
            hideScrollbar
            onZoomChange={setZoom}
            onDoubleClickPosition={
              onSourceJump ? handleDoubleClickPosition : undefined
            }
            highlight={highlight}
            onPageGeometry={notePageGeometry}
            onPageChange={(page, total) => {
              setCurrentPage(page);
              setTotalPages(total);
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Play className="h-10 w-10 opacity-30" />
            <p className="text-sm">Click Recompile to generate the PDF</p>
            <p className="text-xs opacity-70">
              or press{" "}
              <kbd className="px-1.5 py-0.5 bg-surface rounded border text-[10px]">
                Ctrl+Enter
              </kbd>
            </p>
          </div>
        )}
      </div>
    </div>
  );
});

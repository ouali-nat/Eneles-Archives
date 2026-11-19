"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { PdfPagePlaceholder } from "./PdfPagePlaceholder";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { cn } from "@/lib/utils";
import { clickedWordAt, findWordInLines, normalizePdfText, pageRectToShown, rawOffsetOf, shownToPage, type ClickedWord, type PageGeometry, type SyncRect } from "@/lib/synctex";

// Use local worker file copied to public/ (avoids CDN dependency + Turbopack issues)
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const DEFAULT_PAGE_WIDTH = 595;
const DEFAULT_PAGE_HEIGHT = 842;

// Soft-dark filter: partial invert (0.96) turns white into ~#0a0a0a instead
// of pure black. No hue-rotate, which preserves original colors.
const PDF_DARK_FILTER = "invert(0.96)";

// Fixed render scale: react-pdf renders the canvas at this resolution ONCE.
// All visual zooming is handled by CSS transform, so the canvas never re-creates.
// 4.17 ≈ 300 DPI (PDF base is 72 DPI × 4.17 ≈ 300).
const RENDER_SCALE = 2.5;

/** PDF source: either a URL string or raw binary data for react-pdf */
type PdfFile = string | { data: Uint8Array };

/** Places in the PDF to flash, in PDF points from each page's top-left corner. */
export interface PdfHighlight {
  rects: SyncRect[];
  /** Index of the rectangle to bring into view. */
  primary: number;
  /** The word to pick out inside the rectangles, when it can be found in the page's text. */
  word?: ClickedWord | null;
}

/** A rectangle as shares of a page's shown width and height. */
interface ShownRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const FLASH_HOLD_MS = 1500;
const FLASH_FADE_MS = 700;

/** One run of text in a page's text layer, measured along the direction the text reads on screen. */
interface TextRun {
  node: Text;
  text: string;
  /** Quarter turns clockwise of the text as it appears on screen. */
  turns: number;
  start: number;
  end: number;
  across: number;
  thickness: number;
}

/** The text layer's runs with their place on screen. pdf.js turns the whole layer with the page and each run by its own angle; the two together say which way a run reads, so a landscape page whose text was turned back reads left to right like any other. */
function textRuns(layer: Element): TextRun[] {
  const main = Number(layer.getAttribute("data-main-rotation") || 0);
  const runs: TextRun[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    const span = node.parentElement;
    if (!text || !span) continue;
    const r = span.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const own = parseFloat(span.style.getPropertyValue("--rotate")) || 0;
    const turns = ((Math.round((main + own) / 90) % 4) + 4) % 4;
    const vertical = turns % 2 === 1;
    const reversed = turns === 2 || turns === 3;
    const from = vertical ? r.top : r.left;
    const to = vertical ? r.bottom : r.right;
    runs.push({
      node: node as Text,
      text,
      turns,
      start: reversed ? -to : from,
      end: reversed ? -from : to,
      across: vertical ? (r.left + r.right) / 2 : (r.top + r.bottom) / 2,
      thickness: vertical ? r.width : r.height,
    });
  }
  return runs;
}

/** Runs joined into one line of text, with where each run starts in it. A gap wider than a sliver of the type size is a space the PDF did not spell out, and a change of type size is a superscript or subscript, which the source writes apart from its base (mc^2). */
function joinRuns(runs: TextRun[]): { text: string; offsets: number[] } {
  runs.sort((a, b) => a.start - b.start);
  let text = "";
  const offsets: number[] = [];
  runs.forEach((run, i) => {
    const prev = runs[i - 1];
    const apart = prev && (run.start - prev.end > 0.15 * Math.max(run.thickness, prev.thickness) || Math.min(run.thickness, prev.thickness) < 0.85 * Math.max(run.thickness, prev.thickness));
    if (apart && !/\s$/.test(text) && !/^\s/.test(run.text)) text += " ";
    offsets.push(text.length);
    text += run.text;
  });
  return { text, offsets };
}

/** The word under a point of the text layer, with its neighbors on the same line of the page. */
function wordAtPoint(clientX: number, clientY: number): ClickedWord | null {
  let node: Node | null = null;
  let offset = 0;
  if ("caretPositionFromPoint" in document) {
    const caret = document.caretPositionFromPoint(clientX, clientY);
    if (caret) {
      node = caret.offsetNode;
      offset = caret.offset;
    }
  } else if ("caretRangeFromPoint" in document) {
    const range = (document as Document).caretRangeFromPoint(clientX, clientY);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const layer = node.parentElement?.closest(".textLayer");
  if (!layer) return null;
  const runs = textRuns(layer);
  const clicked = runs.find((run) => run.node === node);
  if (!clicked) return null;
  const sameLine = runs.filter((run) => run.turns === clicked.turns && Math.abs(run.across - clicked.across) < 0.5 * clicked.thickness);
  const { text, offsets } = joinRuns(sameLine);
  return clickedWordAt(text, offsets[sameLine.indexOf(clicked)] + offset);
}

interface PDFViewerProps {
  url: PdfFile;
  zoom?: number;
  isInverted?: boolean;
  className?: string;
  singlePage?: boolean;
  unStyled?: boolean;
  hideScrollbar?: boolean;
  fitToContainer?: boolean;
  /**
   * Called when the user double-clicks the PDF, with the click position in
   * PDF points (top-left origin) on the given 1-based page, plus any selected
   * text (used as a fallback when SyncTeX can't resolve the coordinate).
   */
  onDoubleClickPosition?: (
    page: number,
    xPt: number,
    yPt: number,
    text: string,
    /** The word under the pointer with its neighbors on the line, read from the page's text layer; null over whitespace or an image. */
    word: ClickedWord | null,
  ) => void;
  /** Places to flash and scroll to. Pass a new object for a new flash. */
  highlight?: PdfHighlight | null;
  /** Called with each page's box and rotation once pdf.js has loaded it: what line jumping needs to tell a landscape page from an upright one. */
  onPageGeometry?: (page: number, geometry: PageGeometry) => void;
  /** Called with new zoom value (25–300) when Ctrl+Scroll is used */
  onZoomChange?: (zoom: number) => void;
  /** Called when the visible page changes (1-based) */
  onPageChange?: (currentPage: number, totalPages: number) => void;
}

export function PDFViewerClient({
  url,
  zoom = 100,
  isInverted = false,
  className,
  singlePage = false,
  unStyled = false,
  hideScrollbar = false,
  fitToContainer = false,
  onDoubleClickPosition,
  highlight = null,
  onPageGeometry,
  onZoomChange,
  onPageChange,
}: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [fitScale, setFitScale] = useState(0.5);
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  /** Refs for each rendered page div, used by IntersectionObserver */
  const pageRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  /** Per-page intrinsic size in PDF points (scale 1), keyed by 1-based page */
  const pagePointSizesRef = useRef<Map<number, { w: number; h: number }>>(
    new Map(),
  );
  /** Per-page box and rotation as pdf.js reports them, keyed by 1-based page: in a ref for the event handlers, in state for what is drawn from it */
  const pageGeometryRef = useRef<Map<number, PageGeometry>>(new Map());
  const [pageGeometry, setPageGeometry] = useState<Map<number, PageGeometry>>(() => new Map());
  const onPageChangeRef = useRef(onPageChange);
  const onPageGeometryRef = useRef(onPageGeometry);
  useEffect(() => {
    onPageChangeRef.current = onPageChange;
    onPageGeometryRef.current = onPageGeometry;
  }, [onPageChange, onPageGeometry]);

  const geometryOf = useCallback((page: number): PageGeometry => {
    const known = pageGeometryRef.current.get(page);
    if (known) return known;
    const size = pagePointSizesRef.current.get(page) || { w: DEFAULT_PAGE_WIDTH, h: DEFAULT_PAGE_HEIGHT };
    return { view: [0, 0, size.w, size.h], rotation: 0 };
  }, []);

  // ── Flashing a place in the PDF ──
  // The highlight to draw is the prop itself until its time is up; the timers only record which highlight has started to fade and which is over.
  const [fadingFor, setFadingFor] = useState<PdfHighlight | null>(null);
  const [doneFor, setDoneFor] = useState<PdfHighlight | null>(null);
  const [flashWord, setFlashWord] = useState<{ of: PdfHighlight; page: number; rect: ShownRect } | null>(null);
  const flash = highlight && highlight.rects.length > 0 && doneFor !== highlight ? highlight : null;
  const flashFading = flash !== null && fadingFor === flash;

  useEffect(() => {
    if (!highlight) return;
    const fade = setTimeout(() => setFadingFor(highlight), FLASH_HOLD_MS);
    const clear = setTimeout(() => setDoneFor(highlight), FLASH_HOLD_MS + FLASH_FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(clear);
    };
  }, [highlight]);

  // Once the rectangles are in the page: bring the main one into view, and look for the word itself inside them.
  useEffect(() => {
    if (!flash) return;
    const container = containerRef.current;
    if (!container) return;
    const frame = requestAnimationFrame(() => {
      const primary = container.querySelector<HTMLElement>("[data-sync-primary='true']");
      if (!primary) return;
      const view = container.getBoundingClientRect();
      const target = primary.getBoundingClientRect();
      // Leave it alone when it already sits comfortably on screen; otherwise put it a third of the way down.
      const margin = Math.min(80, view.height * 0.15);
      let top = container.scrollTop;
      let left = container.scrollLeft;
      if (target.top < view.top + margin || target.bottom > view.bottom - margin) top += target.top - view.top - view.height / 3;
      if (target.left < view.left || target.right > view.right) left += target.left + target.width / 2 - (view.left + view.width / 2);
      if (top !== container.scrollTop || left !== container.scrollLeft) {
        const far = Math.abs(top - container.scrollTop) > view.height * 2;
        const still = document.documentElement.dataset.motion === "reduced" || document.documentElement.dataset.motion === "off";
        container.scrollTo({ top, left, behavior: far || still ? "auto" : "smooth" });
      }

      const word = flash.word;
      const page = flash.rects[flash.primary]?.page;
      const pageEl = page ? pageRefsRef.current.get(page) : undefined;
      const layer = pageEl?.querySelector(".textLayer");
      if (!word || !pageEl || !layer || !page) return;
      // The text layer's runs under each rectangle of this page, as one line of text per rectangle, main rectangle first.
      const boxes = Array.from(pageEl.querySelectorAll<HTMLElement>("[data-sync-rect]"));
      boxes.sort((a, b) => Number(b.dataset.syncPrimary === "true") - Number(a.dataset.syncPrimary === "true"));
      const runs = textRuns(layer);
      const lines = boxes.map((box) => {
        const r = box.getBoundingClientRect();
        const inside = runs.filter((run) => {
          const s = run.node.parentElement!.getBoundingClientRect();
          const cx = (s.left + s.right) / 2;
          const cy = (s.top + s.bottom) / 2;
          return cy >= r.top && cy <= r.bottom && s.right > r.left && s.left < r.right && cx > r.left - s.width && cx < r.right + s.width;
        });
        return { runs: inside, ...joinRuns(inside) };
      });
      const found = findWordInLines(lines.map((line) => normalizePdfText(line.text)), word);
      if (!found) return;
      const line = lines[found.index];
      const from = rawOffsetOf(line.text, found.column);
      const to = rawOffsetOf(line.text, found.column + found.length);
      let at = line.offsets.length - 1;
      while (at > 0 && line.offsets[at] > from) at--;
      const run = line.runs[at];
      if (!run) return;
      const range = document.createRange();
      const startInRun = Math.max(0, Math.min(run.text.length, from - line.offsets[at]));
      const endInRun = Math.max(startInRun, Math.min(run.text.length, to - line.offsets[at]));
      range.setStart(run.node, startInRun);
      range.setEnd(run.node, endInRun);
      const w = range.getBoundingClientRect();
      const p = pageEl.getBoundingClientRect();
      if (w.width <= 0 || p.width <= 0) return;
      setFlashWord({ of: flash, page, rect: { left: (w.left - p.left) / p.width, top: (w.top - p.top) / p.height, width: w.width / p.width, height: w.height / p.height } });
    });
    return () => cancelAnimationFrame(frame);
  }, [flash, geometryOf]);

  // Pending zoom ref for Ctrl+scroll gesture (tracks accumulated zoom)
  const pendingZoomRef = useRef(zoom);
  /** How much wider than the pane the widest page currently is, in screen pixels. */
  const overhangRef = useRef(0);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  const onDocumentLoadSuccess = ({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    onPageChangeRef.current?.(1, n);
  };

  // Track the currently visible page via IntersectionObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !numPages || singlePage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the most-visible page
        let bestPage = 1;
        let bestRatio = 0;
        for (const entry of entries) {
          const pageNum = parseInt(
            (entry.target as HTMLElement).dataset.pageNum || "1",
            10,
          );
          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestPage = pageNum;
          }
        }
        if (bestRatio > 0) {
          onPageChangeRef.current?.(bestPage, numPages);
        }
      },
      { root: container, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    // Observe all page divs
    for (const [, el] of pageRefsRef.current) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [numPages, singlePage]);

  /** Callback ref for page wrapper divs */
  const setPageRef = useCallback(
    (pageNum: number, el: HTMLDivElement | null) => {
      if (el) {
        el.dataset.pageNum = String(pageNum);
        pageRefsRef.current.set(pageNum, el);
      } else {
        pageRefsRef.current.delete(pageNum);
      }
    },
    [],
  );

  // Visual zoom: CSS transform relative to the fixed RENDER_SCALE.
  // This NEVER re-renders react-pdf canvases: instant and hardware-accelerated.
  const applyVisualZoom = useCallback((zoomPercent: number) => {
    if (!innerRef.current) return;
    // zoom=100 should show the page at "normal" size.
    // react-pdf renders at RENDER_SCALE (e.g. 1.5).
    // So CSS scale = (zoom/100) / RENDER_SCALE to get the visual size right.
    const cssScale = zoomPercent / 100 / RENDER_SCALE;
    // Pages are centered, so one wider than the pane (a landscape page, or any page zoomed in) would stick out equally on both sides, and the part to the left of a scroll container cannot be scrolled to. Shifting right by that overhang puts its left edge at the pane's.
    let widest = 0;
    for (const el of pageRefsRef.current.values()) widest = Math.max(widest, el.offsetWidth);
    const container = containerRef.current;
    const overhang = container ? Math.max(0, widest * cssScale - container.clientWidth) : 0;
    innerRef.current.style.transform = `translateX(${overhang / 2}px) scale(${cssScale})`;
    innerRef.current.style.transformOrigin = "top center";
    // Keep what was in the middle in the middle: a page that fits stays centered in the pane while a wider one further down gets its scroll room.
    if (container && Math.abs(overhang - overhangRef.current) > 0.5) {
      container.scrollLeft += (overhang - overhangRef.current) / 2;
      overhangRef.current = overhang;
    }
  }, []);

  // Apply visual zoom on mount and when the parent changes zoom (toolbar buttons), and keep the wheel gesture's running value in step. Pages arriving or the pane resizing change how much room there is, so the placement is redone then too.
  useEffect(() => {
    pendingZoomRef.current = zoom;
    applyVisualZoom(zoom);
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => applyVisualZoom(pendingZoomRef.current));
    observer.observe(el);
    return () => observer.disconnect();
  }, [zoom, applyVisualZoom, numPages, pageGeometry]);

  // Ctrl+Scroll zoom:
  // - Every tick: update pendingZoom + CSS transform (instant, zero re-render)
  // - After 200ms idle: propagate to parent so toolbar % updates
  // - react-pdf scale NEVER changes, so the canvas stays intact
  useEffect(() => {
    if (!onZoomChange) return;
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: globalThis.WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const delta = e.deltaY > 0 ? -10 : 10;
      const next = Math.min(300, Math.max(25, pendingZoomRef.current + delta));
      pendingZoomRef.current = next;

      // Instant visual feedback: only CSS, no React re-render
      applyVisualZoom(next);

      // Debounce: tell parent about the final zoom after scrolling stops
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      commitTimerRef.current = setTimeout(() => {
        onZoomChange(pendingZoomRef.current);
      }, 200);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    };
  }, [onZoomChange, applyVisualZoom]);

  useEffect(() => {
    if (!fitToContainer || !containerRef.current) return;
    const el = containerRef.current;
    const updateScale = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      const scaleX = w / DEFAULT_PAGE_WIDTH;
      const scaleY = h / DEFAULT_PAGE_HEIGHT;
      setFitScale(Math.min(scaleX, scaleY, 2));
    };
    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToContainer, url]);

  const effectiveScale = fitToContainer
    ? fitScale * (zoom / 100)
    : RENDER_SCALE;

  /**
   * Resolve the double-clicked position to a 1-based page and PDF-point
   * coordinates (top-left origin), then hand it off for SyncTeX reverse sync.
   *
   * The page wrapper div is the on-screen (CSS-transformed) box for the page,
   * so we read the click as a fraction of that box, then scale by the page's
   * intrinsic size in PDF points. This is zoom-agnostic.
   */
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onDoubleClickPosition) return;

      // Capture before the rAF: React's synthetic event may be reused.
      const clientX = e.clientX;
      const clientY = e.clientY;
      const targetEl = e.target as HTMLElement;

      // Read the word before anything else moves: the text layer is what the pointer is over right now.
      const pageAtPointer = (targetEl.closest("[data-page-num]") as HTMLElement | null) || (targetEl.closest(".react-pdf__Page") as HTMLElement | null);
      const pageNumAtPointer = pageAtPointer ? parseInt(pageAtPointer.dataset.pageNumber || pageAtPointer.dataset.pageNum || "1", 10) || 1 : 1;
      let word: ClickedWord | null = null;
      try {
        word = wordAtPoint(clientX, clientY);
      } catch {
        word = null;
      }

      // Give the browser a tick to update the Selection after dblclick.
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        const text =
          sel && !sel.isCollapsed
            ? sel.toString().replace(/\s+/g, " ").trim()
            : "";
        // A double-click selects the word under it. That selection has done its job (it is the text read above), and left on the page it is a stray highlight nobody asked for: clear it.
        sel?.removeAllRanges();

        // Find the page wrapper (has data-page-num); fall back to the
        // react-pdf page element for single-page mode.
        const pageEl = pageAtPointer;
        if (!pageEl) return;
        const pageNum = pageNumAtPointer;

        const rect = pageEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const fx = (clientX - rect.left) / rect.width;
        const fy = (clientY - rect.top) / rect.height;
        if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;

        // The click as a share of the page as shown, then through the page's box and rotation: zoom, pixel density, and the CSS transform all cancel out.
        const point = shownToPage(fx, fy, geometryOf(pageNum));

        onDoubleClickPosition(pageNum, point.x, point.y, text, word);
      });
    },
    [onDoubleClickPosition, geometryOf],
  );

  /** Record a page's intrinsic point size when react-pdf finishes loading it. */
  const handlePageLoad = useCallback(
    (
      pageNum: number,
      page: {
        originalWidth?: number;
        originalHeight?: number;
        width?: number;
        height?: number;
        view?: number[];
        getViewport?: (o: { scale: number }) => {
          width: number;
          height: number;
        };
        rotate?: number;
      },
    ) => {
      // Intrinsic page size in PDF points (scale 1). Prefer react-pdf's
      // originalWidth/Height; fall back across react-pdf/pdf.js versions so we
      // never silently use the wrong page size (which skews SyncTeX coords).
      let w = page.originalWidth ?? page.width;
      let h = page.originalHeight ?? page.height;
      if (!w || !h) {
        try {
          const vp = page.getViewport?.({ scale: 1 });
          if (vp) {
            w = vp.width;
            h = vp.height;
          }
        } catch {
          /* ignore */
        }
      }
      if ((!w || !h) && Array.isArray(page.view) && page.view.length === 4) {
        w = Math.abs(page.view[2] - page.view[0]);
        h = Math.abs(page.view[3] - page.view[1]);
      }
      if (w && h) {
        pagePointSizesRef.current.set(pageNum, { w, h });
      }
      // The page box and rotation, which is what turns a point on screen into a point of the page TeX laid out, and back.
      if (Array.isArray(page.view) && page.view.length === 4) {
        const geometry = { view: page.view.slice(), rotation: page.rotate ?? 0 };
        pageGeometryRef.current.set(pageNum, geometry);
        setPageGeometry((known) => new Map(known).set(pageNum, geometry));
        onPageGeometryRef.current?.(pageNum, geometry);
      }
    },
    [],
  );

  /** The flash rectangles of one page, laid over it. They sit outside the element that carries the dark filter, so their color is the theme's in either mode. */
  const flashLayer = (pageNum: number) => {
    if (!flash) return null;
    const { rects, primary } = flash;
    const mine = rects.map((rect, index) => ({ rect, index })).filter(({ rect }) => rect.page === pageNum);
    if (mine.length === 0) return null;
    const geometry = pageGeometry.get(pageNum) ?? { view: [0, 0, DEFAULT_PAGE_WIDTH, DEFAULT_PAGE_HEIGHT], rotation: 0 };
    const place = (r: ShownRect) => ({ left: `${r.left * 100}%`, top: `${r.top * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` });
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
        {mine.map(({ rect, index }) => (
          <span
            key={index}
            data-sync-rect
            data-sync-primary={index === primary}
            className={cn(
              // Sizes are in the page's own pixels, which the zoom transform shrinks by 2.5 at 100%.
              "absolute -m-[2px] box-content rounded-[5px] border-[2px] border-hue-amber/70 bg-hue-amber/30 transition-opacity duration-700",
              flashFading && "opacity-0",
            )}
            style={place(pageRectToShown(rect, geometry))}
          />
        ))}
        {flashWord && flashWord.of === flash && flashWord.page === pageNum && (
          <span
            data-sync-word
            className={cn("absolute -m-[2px] box-content rounded-[4px] border-[2px] border-hue-amber bg-hue-amber/45 transition-opacity duration-700", flashFading && "opacity-0")}
            style={place(flashWord.rect)}
          />
        )}
      </div>
    );
  };

  // ── Fit-to-container mode ──
  if (fitToContainer) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "relative flex-1 flex items-center justify-center overflow-hidden bg-background min-h-0 min-w-0",
          className,
        )}
      >
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={<PdfPagePlaceholder />}
          error={
            <div className="flex flex-col items-center justify-center p-4 text-danger text-xs">
              Failed to load
            </div>
          }
          className="flex items-center justify-center"
        >
          <div
            className="bg-paper shadow-sm"
            style={isInverted ? { filter: PDF_DARK_FILTER } : undefined}
          >
            <Page
              pageNumber={1}
              scale={effectiveScale}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="bg-paper"
            />
          </div>
        </Document>
      </div>
    );
  }

  // ── Unstyled (thumbnail) mode ──
  if (unStyled) {
    return (
      <div
        className={cn(
          "relative flex-1 overflow-auto",
          hideScrollbar &&
            "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
          className,
        )}
      >
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={null}
          error={null}
          className="flex flex-col items-center"
        >
          {singlePage ? (
            <div
              className="bg-transparent"
              style={isInverted ? { filter: PDF_DARK_FILTER } : undefined}
            >
              <Page
                pageNumber={1}
                scale={RENDER_SCALE}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
            </div>
          ) : (
            Array.from(new Array(numPages || 0), (_, index) => (
              <div
                key={`page_${index + 1}`}
                className="bg-transparent"
                style={isInverted ? { filter: PDF_DARK_FILTER } : undefined}
              >
                <Page
                  pageNumber={index + 1}
                  scale={RENDER_SCALE}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />
              </div>
            ))
          )}
        </Document>
      </div>
    );
  }

  // ── Standard (full editor) mode ──
  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full h-full overflow-auto bg-background",
        hideScrollbar &&
          "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
        className,
      )}
      onDoubleClick={onDoubleClickPosition ? handleDoubleClick : undefined}
    >
      {/* Inner wrapper: CSS transform handles ALL zooming.
          react-pdf renders once at RENDER_SCALE and never re-creates canvases. */}
      <div
        ref={innerRef}
        className="flex flex-col items-center gap-6 min-h-full"
        style={{ willChange: "transform" }}
      >
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={<PdfPagePlaceholder className="h-auto w-[min(36rem,90%)] pt-6" />}
          error={
            <div className="flex flex-col items-center justify-center p-12">
              <span className="text-danger text-sm font-medium">
                Failed to load PDF
              </span>
              <span className="text-muted-foreground text-xs mt-1">
                Please check your connection and try again
              </span>
            </div>
          }
          className="flex flex-col gap-6 items-center"
        >
          {singlePage ? (
            <div
              ref={(el) => setPageRef(1, el)}
              className="relative bg-paper shadow-lg ring-1 ring-line mx-auto"
            >
              <div style={isInverted ? { filter: PDF_DARK_FILTER } : undefined}>
                <Page
                  pageNumber={1}
                  scale={RENDER_SCALE}
                  renderTextLayer={!!onDoubleClickPosition}
                  renderAnnotationLayer={true}
                  onLoadSuccess={(page) => handlePageLoad(1, page)}
                  className="bg-paper"
                />
              </div>
              {flashLayer(1)}
            </div>
          ) : (
            Array.from(new Array(numPages || 0), (_, index) => (
              <div
                key={`page_${index + 1}`}
                ref={(el) => setPageRef(index + 1, el)}
                className="relative bg-paper shadow-lg ring-1 ring-line mx-auto"
              >
                <div style={isInverted ? { filter: PDF_DARK_FILTER } : undefined}>
                  <Page
                    pageNumber={index + 1}
                    scale={RENDER_SCALE}
                    renderTextLayer={!!onDoubleClickPosition}
                    renderAnnotationLayer={true}
                    onLoadSuccess={(page) => handlePageLoad(index + 1, page)}
                    className="bg-paper"
                  />
                </div>
                {flashLayer(index + 1)}
              </div>
            ))
          )}
        </Document>
      </div>
    </div>
  );
}

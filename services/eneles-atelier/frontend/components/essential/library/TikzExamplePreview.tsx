"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Zap } from "@/components/icons";
import { LoadingBar } from "@/components/essential/status/LoadingScreen";
import { API_URL } from "@/lib/api";
import { constructLatex } from "@/lib/tikz/utils";
import { prebuiltPreviewUrl } from "@/lib/tikz/previews";
import { PDFViewer } from "@/components/essential/pdf/PDFViewer";
import { cn } from "@/lib/utils";

/**
 * Renders one TikZ example.
 *
 * First choice: the image rendered ahead of time by `node scripts/check-tikz.mjs --previews` and shipped in public/tikz-previews, used when its key still matches the example's source. No request to the API at all.
 *
 * Order matters here. The prebuild script (`backend/scripts/prebuild-tikz-components.mjs`)
 * compiles every example once per deploy and uploads a PNG to the builds
 * bucket, and `GET /tikz-components/:lib/:ex` serves it from the CDN. That
 * path is a single cached image request.
 *
 * Compiling live instead means a LaTeX run per visitor per page view, which
 * for packages like quantikz and chemfig is multiple seconds and real CPU on
 * the compiler box. So: prebuilt first, live compile only as a fallback for
 * examples the prebuild has not covered yet.
 */

export type PreviewSurface = "white" | "black" | "transparent";

const SURFACES: { id: PreviewSurface; label: string; swatch: string }[] = [
  { id: "white", label: "White", swatch: "bg-paper border-line" },
  { id: "black", label: "Black", swatch: "bg-[var(--preview-black)] border-line" },
  {
    id: "transparent",
    label: "Transparent",
    swatch:
      "border-foreground/20 bg-[repeating-conic-gradient(theme(colors.zinc.400)_0%_25%,transparent_0%_50%)] bg-[length:8px_8px]",
  },
];

export function TikzExamplePreview({
  libraryId,
  exampleId,
  source,
  alt = "",
}: {
  libraryId: string;
  exampleId: string;
  source: string;
  /** What the rendered image shows, for screen readers and for search engines' image results. */
  alt?: string;
}) {
  const [surface, setSurface] = useState<PreviewSurface>("white");
  const [prebuiltUrl, setPrebuiltUrl] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usedLiveCompile, setUsedLiveCompile] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  // Guards the <img> onError fallback so a repeatedly failing URL cannot loop.
  const imageFailedRef = useRef(false);

  const liveCompile = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 4 * 60_000);

    try {
      const request = () =>
        fetch(`${API_URL}/tikz-compile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: [{ path: "main.tex", content: constructLatex(source) }],
            mainFile: "main.tex",
            engine: "pdflatex",
            stopOnFirstError: true,
          }),
          signal: controller.signal,
        });
      // The preview endpoint is rate limited per visitor. A 429 means "not yet", so wait and ask again instead of showing the limit as an error.
      let response = await request();
      for (let attempt = 0; response.status === 429 && attempt < 4; attempt++) {
        const seconds = Number(response.headers.get("retry-after")) || 15;
        await new Promise((r) => setTimeout(r, Math.min(60, seconds) * 1000));
        if (controller.signal.aborted) return;
        response = await request();
      }

      const data = await response.json().catch(() => ({}));
      const messages: string[] =
        data.errors || (data.message ? [data.message] : []);

      if (response.status === 429) {
        setError("Too many previews were rendered from your address in the last minute. Try again shortly.");
        return;
      }
      if (!response.ok) {
        setError(messages[0] || `HTTP ${response.status}`);
        return;
      }
      if (data.success && data.pdf) {
        setPdfData(`data:application/pdf;base64,${data.pdf}`);
        setUsedLiveCompile(true);
      } else {
        setError(
          messages.slice(0, 5).join("\n") ||
            data.log?.slice?.(-800) ||
            "Compilation failed",
        );
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setError("The preview took too long to render. Complex diagrams can take a while; try again in a moment.");
        return;
      }
      setError(
        err instanceof Error ? err.message : "Could not reach the compiler",
      );
    } finally {
      clearTimeout(timeout);
    }
  }, [source]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      setPrebuiltUrl(null);
      setPdfData(null);
      setUsedLiveCompile(false);
      imageFailedRef.current = false;

      // Step 0: the image shipped with the site.
      const local = prebuiltPreviewUrl(libraryId, exampleId, source);
      if (local) {
        setPrebuiltUrl(local);
        setIsLoading(false);
        return;
      }

      // Step 1: the prebuilt PNG in the builds bucket.
      try {
        const res = await fetch(
          `${API_URL}/tikz-components/${libraryId}/${exampleId}`,
        );
        if (cancelled) return;

        if (res.ok) {
          const contentType = res.headers.get("content-type") || "";
          if (contentType.startsWith("image/")) {
            setPrebuiltUrl(`${API_URL}/tikz-components/${libraryId}/${exampleId}`);
            setIsLoading(false);
            return;
          }
          const data = await res.json().catch(() => null);
          if (!cancelled && data?.url) {
            setPrebuiltUrl(data.url);
            setIsLoading(false);
            return;
          }
        }
      } catch {
        // Network failure reaching the asset endpoint. Fall through.
      }

      // Step 2: not prebuilt yet, so compile it now.
      if (cancelled) return;
      await liveCompile();
      if (!cancelled) setIsLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [libraryId, exampleId, source, liveCompile]);

  /**
   * A prebuilt URL that 404s, expires, or is blocked by CORS produces a broken
   * <img> and an empty box with no error anywhere. Treat a failed load as "not
   * prebuilt" and compile it instead.
   */
  const handleImageError = useCallback(() => {
    if (imageFailedRef.current) return;
    imageFailedRef.current = true;
    setPrebuiltUrl(null);
    setIsLoading(true);
    void liveCompile().finally(() => setIsLoading(false));
  }, [liveCompile]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {SURFACES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSurface(option.id)}
              aria-pressed={surface === option.id}
              title={`${option.label} background`}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-colors",
                surface === option.id
                  ? "border-foreground/30 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                aria-hidden
                className={cn("h-3 w-3 rounded-full border", option.swatch)}
              />
              {option.label}
            </button>
          ))}
        </div>

        {usedLiveCompile && !error && (
          <span
            className="flex items-center gap-1 text-[11px] text-muted-foreground"
            title="No prebuilt image for this example yet, so it was compiled on demand."
          >
            <Zap className="h-3 w-3" aria-hidden />
            compiled live
          </span>
        )}
      </div>

      <div
        className={cn(
          "flex min-h-[18rem] items-center justify-center overflow-hidden rounded-[var(--radius-surface)] border border-line p-6 transition-colors",
          surface === "white" && "bg-paper",
          surface === "black" && "bg-[var(--preview-black)]",
          surface === "transparent" && "bg-surface/30",
        )}
      >
        {isLoading ? (
          <div
            className={cn(
              "flex flex-col items-center gap-3",
              // The surrounding surface is fixed white or near-black, so the
              // themed muted colour is unreadable on one of them.
              surface === "white" ? "text-muted-foreground" : "",
              surface === "black" ? "text-muted-foreground" : "",
              surface === "transparent" ? "text-muted-foreground" : "",
            )}
          >
            <LoadingBar />
            <p role="status" className="type-small">Rendering</p>
          </div>
        ) : error ? (
          <div className="w-full max-w-xl">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-hue-amber dark:text-hue-amber">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Could not render this example
            </div>
            <pre className="max-h-40 overflow-auto rounded-[var(--radius)] border border-line bg-background p-3 text-[11.5px] leading-relaxed text-muted-foreground">
              <code className="whitespace-pre-wrap break-all">{error}</code>
            </pre>
            <p className="mt-3 text-[12px] text-muted-foreground">
              The source below is still correct. This is a rendering problem on
              our side, not a problem with the example.
            </p>
          </div>
        ) : prebuiltUrl ? (
          /* The prebuilt PNG has a white background baked in, because it comes
             from a PDF page. `invert` turns black-on-white into white-on-black,
             and the blend modes drop the white so the diagram sits directly on
             whatever is behind it. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={prebuiltUrl}
            alt={alt}
            onError={handleImageError}
            className={cn(
              "max-h-[26rem] max-w-full object-contain",
              surface === "black" && "invert",
              surface === "transparent" &&
                "mix-blend-multiply dark:invert dark:mix-blend-screen",
            )}
          />
        ) : pdfData ? (
          /* PDFViewer's dynamic loading state is `h-full w-full`, so this
             wrapper has to carry the sizing or the viewer collapses to nothing
             while the engine loads. */
          <div
            className={cn(
              "flex max-w-full items-center justify-center",
              surface === "black" && "invert",
              surface === "transparent" &&
                "mix-blend-multiply dark:invert dark:mix-blend-screen",
            )}
          >
            <PDFViewer
              url={pdfData}
              unStyled
              singlePage
              zoom={150}
              className="pointer-events-none flex max-w-full items-center justify-center"
            />
          </div>
        ) : (
          <p
            className={cn(
              "text-[13px]",
              surface === "white" ? "text-muted-foreground" : "text-muted-foreground",
            )}
          >
            No preview
          </p>
        )}
      </div>
    </div>
  );
}

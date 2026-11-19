"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { renderLatexPreview } from "@/lib/latex/preview";
import { constructLatex } from "@/lib/tikz/utils";
import { prebuiltPreviewDarkUrl, prebuiltPreviewUrl } from "@/lib/tikz/previews";
import { cn } from "@/lib/utils";

/**
 * A small rendered preview of a TikZ example, for cards in a list.
 *
 * A library example whose image was rendered ahead of time (`node scripts/check-tikz.mjs --previews`, served from public/tikz-previews) shows that image at once. Anything else waits until the card is near the screen, then uses the image in the builds bucket when the deploy has one, and otherwise compiles the example (see lib/latex/preview.ts). In the dark theme a prebuilt image is shown in its dark version, on the card's own ground with its colors as TeX drew them and its black ink made light; an image compiled on demand has no such version and is shown on paper.
 */
async function prebuilt(libraryId: string, exampleId: string): Promise<string | null> {
  try {
    const url = `${API_URL}/tikz-components/${libraryId}/${exampleId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (type.startsWith("image/")) return URL.createObjectURL(await res.blob());
    const data = await res.json().catch(() => null);
    return typeof data?.url === "string" ? data.url : null;
  } catch {
    return null;
  }
}

export function TikzThumb({
  libraryId,
  exampleId,
  source,
  name,
  className,
}: {
  libraryId: string;
  exampleId: string;
  source: string;
  name: string;
  className?: string;
}) {
  const key = `${libraryId}/${exampleId}`;
  const local = prebuiltPreviewUrl(libraryId, exampleId, source);
  // In the dark theme, the version made for it; an image without one (compiled on demand) stays on paper.
  const dark = local ? prebuiltPreviewDarkUrl(libraryId, exampleId) : null;
  const [fetched, setFetched] = useState<string | null>(null);
  const src = local ?? fetched;
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (src || failed) return;
    const el = root.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void (async () => {
          const url = (await prebuilt(libraryId, exampleId)) ?? (await renderLatexPreview(constructLatex(source)));
          if (cancelled) return;
          if (url) setFetched(url);
          else setFailed(true);
        })();
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [key, libraryId, exampleId, source, src, failed]);

  return (
    <div
      ref={root}
      className={cn(
        "relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[var(--radius-inset)] border border-line bg-paper",
        dark && "dark:bg-surface",
        className,
      )}
    >
      {src ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- A static render of the example. */}
          <img src={src} alt={`${name}, rendered`} loading="lazy" className={cn("max-h-full max-w-full object-contain p-3", dark && "dark:hidden")} />
          {dark && (
            // eslint-disable-next-line @next/next/no-img-element -- A static render of the example.
            <img src={dark} alt={`${name}, rendered`} loading="lazy" className="hidden max-h-full max-w-full object-contain p-3 dark:block" />
          )}
        </>
      ) : failed ? (
        <span className="px-4 text-center type-small text-muted-foreground">No preview yet</span>
      ) : (
        <span aria-hidden className="skeleton size-full" />
      )}
    </div>
  );
}

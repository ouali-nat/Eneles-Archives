"use client";

import { useEffect, useRef, useState } from "react";
import { LatexCode } from "@/components/essential/LatexCode";
import { CopyButton } from "@/components/ui/copy-button";
import { Spinner } from "@/components/ui/status";
import { exampleDocument, renderLatexPreview } from "@/lib/latex/preview";
import { cn } from "@/lib/utils";

/**
 * A worked example in a lesson: the LaTeX on the left and what it compiles to on the right (stacked on narrow screens). Written in MDX as a fenced block: "latex-example" for a snippet of document body, "latex-document" for a complete document whose first page is shown.
 *
 * The output is the real thing, compiled by the same TeX Live as the editor, once it scrolls near the screen.
 */
export function LatexExample({ source, document: isDocument = false }: { source: string; document?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ status: "waiting" | "ready" | "failed"; url?: string }>({ status: "waiting" });

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void renderLatexPreview(isDocument ? source : exampleDocument(source)).then((url) => {
          if (!cancelled) setState(url ? { status: "ready", url } : { status: "failed" });
        });
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [source, isDocument]);

  return (
    <div ref={root} className="my-6 grid overflow-hidden rounded-[var(--radius-card)] border border-line @min-[46rem]:grid-cols-2">
      <div className="relative min-w-0 bg-surface/50">
        <div className="flex h-9 items-center justify-between border-b border-line ps-4 pe-2">
          <span className="font-mono type-micro text-muted-foreground">LaTeX</span>
          <CopyButton text={source} />
        </div>
        <pre className="overflow-x-auto p-4">
          <LatexCode className="text-[13px] leading-relaxed">{source}</LatexCode>
        </pre>
      </div>
      <div className="flex min-w-0 flex-col border-t border-line @min-[46rem]:border-s @min-[46rem]:border-t-0">
        <div className="flex h-9 items-center border-b border-line ps-4">
          <span className="font-mono type-micro text-muted-foreground">Output</span>
        </div>
        <div className={cn("grid flex-1 place-items-center bg-paper p-4", isDocument ? "min-h-64" : "min-h-24")}>
          {state.status === "ready" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={state.url} alt="The compiled output of the example" className={cn("h-auto max-w-full", isDocument ? "max-h-[28rem] shadow-lit-drop" : "max-h-[26rem]")} />
          ) : state.status === "failed" ? (
            <p className="type-small text-paper-ink/60">The preview could not be rendered. The source is still correct to copy.</p>
          ) : (
            <span className="flex items-center gap-2 type-small text-paper-ink/60">
              <Spinner /> Compiling
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

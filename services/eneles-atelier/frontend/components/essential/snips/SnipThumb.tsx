"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import { ImageIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * The mathematics in a snip's LaTeX, ready for the renderer: the first display or inline block if the text has one, or the whole text when it reads as bare math. Null when there is nothing to typeset (plain prose, or nothing at all).
 */
export function snipMath(latex: string | null | undefined): string | null {
  const text = (latex ?? "").trim();
  if (!text) return null;
  const environment = /\\begin\{(equation|align|gather|multline|eqnarray)\*?\}([\s\S]*?)\\end\{\1\*?\}/.exec(text);
  if (environment) {
    const body = environment[2].replace(/\\label\{[^}]*\}/g, "").replace(/\\nonumber|\\notag/g, "").trim();
    return /align|eqnarray|gather|multline/.test(environment[1]) ? `\\begin{aligned}${body}\\end{aligned}` : body;
  }
  const block = /\\\[([\s\S]*?)\\\]/.exec(text) ?? /\$\$([\s\S]*?)\$\$/.exec(text) ?? /\\\(([\s\S]*?)\\\)/.exec(text) ?? /\$([^$]+)\$/.exec(text);
  if (block) return block[1].trim();
  // No delimiters: a single paragraph with commands in it is math as the converter returns it.
  return /\\[a-zA-Z]+|[_^]/.test(text) && !/\n\s*\n/.test(text) ? text : null;
}

/** Typesets a formula and shrinks it to fit its box, so a long equation is a small whole one, not a cropped one. */
function FittedMath({ math, className }: { math: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const [html, setHtml] = useState("");
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    void import("katex").then((katex) => {
      if (!cancelled) setHtml(katex.default.renderToString(math, { displayMode: true, throwOnError: false, strict: "ignore" }));
    });
    return () => {
      cancelled = true;
    };
  }, [math]);

  useLayoutEffect(() => {
    const outer = box.current;
    const inner = content.current;
    if (!outer || !inner || !html) return;
    const fit = () => {
      // The element's own size, before the transform: offset sizes ignore it.
      const width = inner.offsetWidth;
      const height = inner.offsetHeight;
      if (!width || !height) return;
      setScale(Math.min(1, (outer.clientWidth - 12) / width, (outer.clientHeight - 12) / height));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [html]);

  return (
    <div ref={box} className={cn("relative size-full overflow-hidden", className)}>
      {/* The typeset formula is KaTeX's own markup, made from the snip's LaTeX with errors turned into text, never raw HTML from the snip. It is pinned to the middle of the box and scaled about its own centre, so a formula wider than the box still sits in the middle of it. */}
      <span ref={content} className="absolute top-1/2 left-1/2 inline-block whitespace-nowrap [&_.katex-display]:m-0" style={{ transform: `translate(-50%, -50%) scale(${scale})` }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

/**
 * What a snip looks like: its image when it has one, otherwise its LaTeX typeset on a small page, otherwise a placeholder. Used wherever a snip is listed, at whatever size the list gives it.
 */
export function SnipThumb({ imageUrl, latex, title, fit = "cover", className }: { imageUrl?: string | null; latex?: string | null; title?: string; /** A list tile fills its square; the large view shows the whole image. */ fit?: "cover" | "contain"; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const math = snipMath(latex);
  const frame = cn("shrink-0 overflow-hidden rounded-[var(--radius-item)] border border-line", className);

  if (imageUrl && broken !== imageUrl) {
    return (
      <div className={cn(frame, "bg-surface")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage address that expires; the image optimizer cannot cache it */}
        <img src={imageUrl} alt={title ? `Image of ${title}` : "Snip image"} loading="lazy" onError={() => setBroken(imageUrl)} className={cn("size-full", fit === "contain" ? "object-contain" : "object-cover")} />
      </div>
    );
  }
  if (math) {
    return (
      <div className={cn(frame, "bg-paper text-paper-ink")} aria-label={title ? `Preview of ${title}` : "Snip preview"} role="img">
        <FittedMath math={math} />
      </div>
    );
  }
  return (
    <div className={cn(frame, "grid place-items-center bg-surface text-muted-foreground")}>
      <ImageIcon className="size-5" aria-hidden />
    </div>
  );
}

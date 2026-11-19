"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import "katex/dist/katex.min.css";

/**
 * Render a string that mixes prose with inline `$...$` maths.
 *
 * Descriptions across the library are written by hand and frequently want a
 * symbol in them, and a Bell state described as "|Φ+⟩" in literal Unicode is
 * both harder to author and worse looking than `$\lvert\Phi^+\rangle$`. This
 * splits on unescaped `$` pairs and hands only the maths to KaTeX.
 *
 * `trust: false` is explicit: these strings are static today, but the
 * component renders through `dangerouslySetInnerHTML`, so blocking `\href`
 * and friends is what keeps that safe if the source ever becomes user data.
 */
export function InlineTex({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const [katex, setKatex] = useState<typeof import("katex") | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("katex").then((mod) => {
      if (!cancelled) setKatex(mod);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Odd indices are maths. A `\$` escapes a literal dollar sign.
  const segments = useMemo(
    () => children.split(/(?<!\\)\$/g),
    [children],
  );

  // Nothing to typeset, or an unbalanced `$`. Fall back to the raw string
  // rather than swallowing half the sentence into a maths run.
  if (segments.length < 3 || segments.length % 2 === 0) {
    return <span className={className}>{children.replace(/\\\$/g, "$")}</span>;
  }

  return (
    <span className={className}>
      {segments.map((segment, i) => {
        const isMath = i % 2 === 1;
        if (!isMath) {
          return <span key={i}>{segment.replace(/\\\$/g, "$")}</span>;
        }
        if (!katex) {
          // Reserve the space so the line does not reflow on hydration.
          return (
            <span key={i} className="inline-block opacity-0" aria-hidden>
              {segment}
            </span>
          );
        }
        return (
          <span
            key={i}
            className={cn("[&_.katex]:text-[0.95em]")}
            dangerouslySetInnerHTML={{
              __html: katex.default.renderToString(segment, {
                throwOnError: false,
                trust: false,
              }),
            }}
          />
        );
      })}
    </span>
  );
}

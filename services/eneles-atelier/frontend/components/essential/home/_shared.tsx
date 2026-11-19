"use client";

import { useId } from "react";
import { motion, type Variants } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import "katex/dist/katex.min.css";

/**
 * Shared building blocks for the marketing homepage.
 *
 * Everything here is deliberately monochrome. The design system's `primary`
 * is near-black in light mode and near-white in dark, so colour is spent only
 * where it carries meaning. Contrast comes from weight, spacing, and inverted
 * bands rather than from hue.
 */

/**
 * Standard easing for every entrance on the page. Typed as a 4-tuple because
 * Framer Motion will not accept a plain `number[]` as a cubic bezier.
 */
export const EASE_OUT: [number, number, number, number] = [0.2, 0.9, 0.3, 1];

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    // A long, heavily damped ease. Marketing motion should settle, not bounce;
    // anything springy reads as a template.
    transition: { duration: 0.5, ease: EASE_OUT },
  },
};

/** Fade-and-rise on scroll into view. Fires once. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={revealVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      transition={{ delay }}
    >
      {children}
    </motion.div>
  );
}

/** Small monospace label above a heading. */
export function SectionHeading({
  title,
  lede,
  className,
}: {
  title: ReactNode;
  lede?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-6xl text-center", className)}>
      <h2 className="text-3xl font-semibold tracking-[-0.02em] text-pretty @min-[40rem]:text-4xl">
        {title}
      </h2>
      {lede && (
        <p className="mx-auto mt-4 max-w-5xl text-lg leading-relaxed text-muted-foreground text-pretty">
          {lede}
        </p>
      )}
    </div>
  );
}

/**
 * Faint square grid, masked to fade out at the edges. Used behind the hero and
 * the closing CTA to give large empty areas some structure without noise.
 */
export function GridBackdrop({
  className,
  size = 56,
  fade = "radial-gradient(ellipse 60% 50% at 50% 40%, black, transparent)",
}: {
  className?: string;
  size?: number;
  fade?: string;
}) {
  // Unique per instance: two backdrops with the same size used to share one pattern id.
  const id = `grid-${size}-${useId().replace(/:/g, "")}`;
  return (
    <svg
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full stroke-foreground/[0.07]",
        className,
      )}
      style={{ maskImage: fade, WebkitMaskImage: fade }}
    >
      <defs>
        <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse">
          <path d={`M${size} 0H0V${size}`} fill="none" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth="0" fill={`url(#${id})`} />
    </svg>
  );
}

/** Soft radial glow. Sits behind the hero copy to lift it off the page. */
export function Glow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full blur-3xl",
        "bg-[radial-gradient(circle,var(--foreground)_0%,transparent_70%)] opacity-[0.06] dark:opacity-[0.10]",
        className,
      )}
    />
  );
}

/**
 * Render a LaTeX string with KaTeX.
 *
 * KaTeX is loaded lazily so it stays out of the initial bundle. The homepage
 * is the one page where first paint actually matters. Until it resolves the
 * component renders nothing rather than raw source, which would flash.
 */
export function Tex({
  children,
  display = false,
  className,
}: {
  children: string;
  display?: boolean;
  className?: string;
}) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    void import("katex").then((katex) => {
      if (cancelled) return;
      setHtml(
        katex.default.renderToString(children, {
          displayMode: display,
          throwOnError: false,
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [children, display]);

  if (!html) return <span className={className} aria-hidden />;
  return (
    <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * On-page table of contents with scroll spy.
 *
 * Headings are read from the rendered DOM rather than from frontmatter or a
 * build-time AST walk. MDX pages here are compiled to components, so their
 * heading structure is not available to a sibling component at runtime any
 * other way, and querying after paint costs one pass over a handful of nodes.
 *
 * Renders nothing when a page has fewer than two headings, because a
 * one-item contents list is just clutter.
 */
export function DocsToc() {
  const pathname = usePathname();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const article = document.querySelector("article");
    if (!article) return;

    const nodes = Array.from(
      article.querySelectorAll<HTMLHeadingElement>("h2, h3"),
    ).filter((node) => node.id);

    // The headings exist only in the DOM, and only once this page has committed, so they are read here and handed to React in a microtask: still before the next paint and before the observer below first reports.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setHeadings(
        nodes.map((node) => ({
          id: node.id,
          text: node.textContent ?? "",
          level: node.tagName === "H2" ? 2 : 3,
        })),
      );
      setActiveId(nodes[0]?.id ?? "");
    });

    if (nodes.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    // Top-biased root margin: a heading counts as "current" once it reaches
    // the upper quarter of the viewport, which matches where a reader's eye
    // actually is. Without it the highlight lags a full section behind.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-88px 0px -70% 0px", threshold: 0 },
    );

    nodes.forEach((node) => observer.observe(node));
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [pathname]);

  if (headings.length < 2) return null;

  return (
    <div className="sticky top-24">
      <p className="mb-2 type-small font-medium text-muted-foreground">On this page</p>
      <ul className="border-s border-line">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={cn(
                "-ms-px block border-s-2 py-1.5 type-small transition-colors",
                heading.level === 3 ? "ps-6" : "ps-3",
                activeId === heading.id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

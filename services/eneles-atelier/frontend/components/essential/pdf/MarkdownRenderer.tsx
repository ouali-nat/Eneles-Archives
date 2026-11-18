"use client";

import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import remarkGfm from "remark-gfm";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";
import { API_URL } from "@/lib/api";

interface MarkdownRendererProps {
  content: string;
  images?: { src: string; page?: number }[];
  className?: string;
}

/**
 * Apply a regex replacement only to text outside of math delimiters.
 * Preserves content inside $...$ and $$...$$ blocks untouched.
 */
function replaceOutsideMath(
  text: string,
  pattern: RegExp,
  replacement: string,
): string {
  const parts: string[] = [];
  const mathRegex = /\$\$[\s\S]*?\$\$|\$(?:[^$\\]|\\.)+\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mathRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        text.slice(lastIndex, match.index).replace(pattern, replacement),
      );
    }
    parts.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex).replace(pattern, replacement));
  }

  return parts.join("");
}

/**
 * Converts LaTeX-style content (as output by olmOCR / Mathpix) to something
 * react-markdown + remark-math can render. Detects already-clean markdown
 * (e.g. from Marker) and skips aggressive LaTeX transformations.
 */
function latexToMarkdown(tex: string): string {
  let md = tex;

  const isRawLatex =
    /\\(section|subsection|textbf|textit|emph|begin\{(document|itemize|enumerate)\})\{/.test(
      md,
    );

  if (isRawLatex) {
    // Convert single-$ display math blocks (olmOCR style) to $$
    const lines = md.split("\n");
    const result: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const trimmed = lines[i].trim();
      if (trimmed === "$") {
        const start = i + 1;
        let end = -1;
        for (let j = start; j < lines.length; j++) {
          if (lines[j].trim() === "$") {
            end = j;
            break;
          }
        }
        if (end > start) {
          result.push("$$");
          for (let j = start; j < end; j++) {
            result.push(lines[j]);
          }
          result.push("$$");
          i = end + 1;
          continue;
        }
      }
      result.push(lines[i]);
      i++;
    }
    md = result.join("\n");

    md = md.replace(/\\section\*?\{([^}]*)\}/g, "\n## $1\n");
    md = md.replace(/\\subsection\*?\{([^}]*)\}/g, "\n### $1\n");
    md = md.replace(/\\subsubsection\*?\{([^}]*)\}/g, "\n#### $1\n");

    md = md.replace(/\\textbf\{([^}]*)\}/g, "**$1**");
    md = md.replace(/\\textit\{([^}]*)\}/g, "*$1*");
    md = md.replace(/\\emph\{([^}]*)\}/g, "*$1*");
    md = md.replace(/\\underline\{([^}]*)\}/g, "$1");
    md = md.replace(/\\texttt\{([^}]*)\}/g, "`$1`");

    md = md.replace(
      /\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g,
      (_m, p1) => `\n$$\n${p1}\n$$\n`,
    );
    md = md.replace(
      /\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g,
      (_m, p1) => `\n$$\n\\begin{aligned}${p1}\\end{aligned}\n$$\n`,
    );
    md = md.replace(
      /\\begin\{gather\*?\}([\s\S]*?)\\end\{gather\*?\}/g,
      (_m, p1) => `\n$$\n${p1}\n$$\n`,
    );
    md = md.replace(
      /\\begin\{multline\*?\}([\s\S]*?)\\end\{multline\*?\}/g,
      (_m, p1) => `\n$$\n${p1}\n$$\n`,
    );

    md = md.replace(/\\\[([\s\S]*?)\\\]/g, (_m, p1) => `\n$$\n${p1}\n$$\n`);
    md = md.replace(/\\\((.*?)\\\)/g, (_m, p1) => `$${p1}$`);

    md = md.replace(/\\begin\{itemize\}/g, "");
    md = md.replace(/\\end\{itemize\}/g, "");
    md = md.replace(/\\begin\{enumerate\}/g, "");
    md = md.replace(/\\end\{enumerate\}/g, "");
    md = md.replace(/\\item\s*/g, "- ");

    md = md.replace(/\\begin\{quote\}/g, "");
    md = md.replace(/\\end\{quote\}/g, "");

    md = md.replace(/\\label\{[^}]*\}/g, "");
    md = md.replace(/\\ref\{[^}]*\}/g, "");
    md = md.replace(/\\cite\{[^}]*\}/g, "");
    md = md.replace(/\\centering/g, "");
    md = md.replace(/\\noindent/g, "");
    md = md.replace(/\\newpage/g, "\n---\n");

    md = replaceOutsideMath(md, /\\\\(?!\n)/g, "  \n");
  }

  md = md.replace(/^%\s*Page\s+\d+\s*$/gm, "\n---\n");
  md = md.replace(/\n{4,}/g, "\n\n\n");

  return md.trim();
}

export function MarkdownRenderer({
  content,
  images,
  className,
}: MarkdownRendererProps) {
  const markdown = useMemo(() => latexToMarkdown(content), [content]);

  const { cleanMarkdown, imageMap } = useMemo(() => {
    // Extract inline base64 data URIs: react-markdown can't parse huge URLs.
    // Replace with short placeholder IDs and resolve in the img component.
    const map: Record<string, string> = {};
    let idx = 0;
    const dataUriRe =
      /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)\)/g;
    let md = markdown.replace(dataUriRe, (_m, alt, dataUri) => {
      const id = `__b64img_${idx++}__`;
      map[id] = dataUri;
      return `![${alt}](${id})`;
    });

    // Replace dummy file-based placeholders (e.g. figure.png, page_x_y_w_h.png)
    // with client-side extracted images or caption text
    const placeholderRe =
      /!\[([^\]]*)\]\((?!https?:\/\/|data:|__b64img_|\/pdf-images\/)([^)]+)\)/g;
    const imgList = images || [];
    let imgIdx = 0;
    md = md.replace(placeholderRe, (_match, alt) => {
      if (imgIdx < imgList.length) {
        const img = imgList[imgIdx++];
        const id = `__b64img_${idx++}__`;
        map[id] = img.src;
        return `![${alt}](${id})`;
      }
      if (alt) return `> *[Figure: ${alt}]*`;
      return "";
    });

    // Append remaining client-extracted images
    if (imgIdx < imgList.length) {
      const extras = imgList
        .slice(imgIdx)
        .map((img, i) => {
          const id = `__b64img_${idx++}__`;
          map[id] = img.src;
          return `![Figure ${imgIdx + i + 1}](${id})`;
        })
        .join("\n\n");
      md = md + "\n\n" + extras;
    }

    return { cleanMarkdown: md, imageMap: map };
  }, [markdown, images]);

  return (
    <div className={cn("markdown-rendered max-w-none", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        // Extracted text comes from uploaded files: raw HTML is parsed, then sanitized, then math is typeset.
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], rehypeKatex]}
        components={{
          h1: ({ children, ...props }) => (
            <h1
              className="text-2xl font-bold mt-8 mb-4 pb-2 border-b border-line"
              {...props}
            >
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2
              className="text-xl font-bold mt-7 mb-3 pb-1.5 border-b border-line/50"
              {...props}
            >
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="text-lg font-semibold mt-6 mb-2" {...props}>
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 className="text-base font-semibold mt-5 mb-2" {...props}>
              {children}
            </h4>
          ),
          h5: ({ children, ...props }) => (
            <h5 className="text-sm font-semibold mt-4 mb-1" {...props}>
              {children}
            </h5>
          ),
          h6: ({ children, ...props }) => (
            <h6
              className="text-sm font-medium mt-4 mb-1 text-muted-foreground"
              {...props}
            >
              {children}
            </h6>
          ),
          p: ({ children, ...props }) => (
            <p className="my-3 leading-7" {...props}>
              {children}
            </p>
          ),
          ul: ({ children, ...props }) => (
            <ul className="my-3 ms-6 list-disc space-y-1" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="my-3 ms-6 list-decimal space-y-1" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="leading-7" {...props}>
              {children}
            </li>
          ),
          a: ({ children, href, ...props }) => (
            <a
              href={href}
              className="text-foreground underline underline-offset-2 hover:text-foreground/80"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </a>
          ),
          img: ({ src, alt, ...props }) => {
            let srcStr = typeof src === "string" ? src : undefined;
            if (srcStr?.startsWith("/pdf-images/")) {
              srcStr = `${API_URL}${srcStr}`;
            }
            const resolved =
              srcStr && imageMap[srcStr] ? imageMap[srcStr] : srcStr;
            if (!resolved) return null;
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolved}
                alt={alt || ""}
                className="max-w-full h-auto rounded-md border my-4"
                loading="lazy"
                {...props}
              />
            );
          },
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto my-4">
              <table
                className="min-w-full border-collapse border border-line"
                {...props}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th
              className="border border-line px-3 py-2 bg-surface font-medium text-start"
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="border border-line px-3 py-2" {...props}>
              {children}
            </td>
          ),
          blockquote: ({ children, ...props }) => (
            <blockquote
              className="border-s-4 border-accent/40 ps-4 italic text-muted-foreground my-4"
              {...props}
            >
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-6 border-line" />,
          pre: ({ children, ...props }) => (
            <pre
              className="bg-surface rounded-md p-4 overflow-x-auto text-sm"
              {...props}
            >
              {children}
            </pre>
          ),
          code: ({ children, className: codeClassName, ...props }) => {
            const isInline = !codeClassName;
            if (isInline) {
              return (
                <code
                  className="bg-surface px-1.5 py-0.5 rounded text-sm font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            );
          },
          sup: ({ children, ...props }) => (
            <sup className="text-xs" {...props}>
              {children}
            </sup>
          ),
          sub: ({ children, ...props }) => (
            <sub className="text-xs" {...props}>
              {children}
            </sub>
          ),
        }}
      >
        {cleanMarkdown}
      </ReactMarkdown>
    </div>
  );
}

import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";
import Link from "next/link";
import { Link2 } from "@/components/icons";
import { CodeBlock } from "@/components/essential/docs/CodeBlock";
import { Callout } from "@/components/essential/docs/Callout";
import { Endpoint } from "@/components/essential/docs/Endpoint";
import { LatexExample } from "@/components/essential/docs/LatexExample";
import { ShortcutsTable } from "@/components/essential/docs/ShortcutsTable";

/**
 * Flatten MDX children to plain text so a heading can derive its own anchor id.
 *
 * The alternative is a `rehype-slug` dependency in the MDX pipeline. This is
 * about fifteen lines, has no version to keep current, and gives identical
 * results for the heading shapes these pages actually use.
 */
function toText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(toText).join("");
  if (typeof node === "object" && "props" in node) {
    return toText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s/-]/g, "")
    .replace(/[\s/]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Heading with a hover anchor, so any section is directly linkable. */
function Heading({
  as: Tag,
  children,
  id,
  className,
}: {
  as: "h2" | "h3" | "h4";
  children: ReactNode;
  id?: string;
  className: string;
}) {
  const anchor = id ?? slugify(toText(children));
  return (
    <Tag id={anchor} className={`group scroll-mt-24 ${className}`}>
      <a
        href={`#${anchor}`}
        className="relative no-underline"
        aria-label={`Link to ${toText(children)}`}
      >
        {children}
        <Link2
          className="ms-2 inline-block h-3.5 w-3.5 align-baseline text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </a>
    </Tag>
  );
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    // What a guide or a lesson can use by name, without importing anything: the pages live in their own repositories and cannot reach into this one.
    Callout,
    Endpoint,
    ShortcutsTable,
    h1: ({ children }) => (
      <h1 className="mb-3 text-3xl font-semibold tracking-[-0.02em] text-pretty">
        {children}
      </h1>
    ),
    h2: ({ children, id }) => (
      <Heading
        as="h2"
        id={id}
        className="mt-12 mb-4 text-xl font-semibold tracking-[-0.01em]"
      >
        {children}
      </Heading>
    ),
    h3: ({ children, id }) => (
      <Heading
        as="h3"
        id={id}
        className="mt-9 mb-3 text-base font-semibold tracking-tight"
      >
        {children}
      </Heading>
    ),
    h4: ({ children, id }) => (
      <Heading as="h4" id={id} className="mt-7 mb-2 text-[15px] font-semibold">
        {children}
      </Heading>
    ),
    p: ({ children }) => (
      <p className="mb-4 text-[15px] leading-[1.75] text-muted-foreground">
        {children}
      </p>
    ),
    a: ({ href, children }) => {
      const classes =
        "font-medium text-foreground underline decoration-foreground/25 underline-offset-4 transition-colors hover:decoration-foreground/70";
      if (href?.startsWith("/")) {
        return (
          <Link href={href} className={classes}>
            {children}
          </Link>
        );
      }
      if (href?.startsWith("#")) {
        return (
          <a href={href} className={classes}>
            {children}
          </a>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" className={classes}>
          {children}
        </a>
      );
    },
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    ol: ({ children }) => (
      <ol className="my-5 ms-5 list-decimal space-y-2.5 text-[15px] leading-[1.7] text-muted-foreground marker:font-medium marker:text-muted-foreground/50">
        {children}
      </ol>
    ),
    ul: ({ children }) => (
      <ul className="my-5 ms-5 list-disc space-y-2 text-[15px] leading-[1.7] text-muted-foreground marker:text-muted-foreground/40">
        {children}
      </ul>
    ),
    li: ({ children }) => <li className="ps-1.5">{children}</li>,
    pre: ({ children }) => {
      const codeElement = children as React.ReactElement<{
        children: string;
        className?: string;
      }>;
      const code = codeElement?.props?.children || "";
      const className = codeElement?.props?.className || "";
      const language = className.replace("language-", "");

      const labels: Record<string, string> = {
        bash: "Terminal",
        sh: "Terminal",
        shell: "Terminal",
        json: "JSON",
        http: "HTTP",
        latex: "LaTeX",
        tex: "LaTeX",
        typescript: "TypeScript",
        ts: "TypeScript",
        javascript: "JavaScript",
        js: "JavaScript",
        python: "Python",
        py: "Python",
        yaml: "YAML",
        env: ".env",
      };

      const source = typeof code === "string" ? code.replace(/\n$/, "") : String(code);
      // A lesson's worked example: the source and what it compiles to, side by side.
      if (language === "latex-example" || language === "latex-document") {
        return <LatexExample source={source} document={language === "latex-document"} />;
      }

      return <CodeBlock language={labels[language] || language || undefined}>{source}</CodeBlock>;
    },
    code: ({ children, className }) => {
      // Inline code only: fenced blocks go through pre
      if (className) return <code className={className}>{children}</code>;
      return (
        <code className="rounded border bg-surface px-1.5 py-0.5 font-mono text-[12.5px] text-foreground">
          {children}
        </code>
      );
    },
    hr: () => <hr className="my-10 border-t" />,
    table: ({ children }) => (
      <div className="my-6 overflow-x-auto rounded-xl border">
        <table className="w-full text-[14px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="border-b bg-surface/40">{children}</thead>
    ),
    th: ({ children }) => (
      <th className="px-4 py-2.5 text-start text-[13px] font-semibold text-foreground">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-4 py-2.5 align-top text-muted-foreground">{children}</td>
    ),
    tr: ({ children }) => (
      <tr className="border-b transition-colors last:border-0 hover:bg-surface/20">
        {children}
      </tr>
    ),
    blockquote: ({ children }) => (
      <div className="my-6 rounded-e-lg border-s-2 border-foreground/25 bg-surface/40 px-4 py-3 text-[14px] text-muted-foreground [&>p:last-child]:mb-0">
        {children}
      </div>
    ),
    ...components,
  };
}

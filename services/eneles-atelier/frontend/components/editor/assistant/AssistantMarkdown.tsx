"use client";

import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import "katex/dist/katex.min.css";
import { Check, Copy } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { markdownSanitizeSchema } from "@/lib/markdown-sanitize";
import { cn } from "@/lib/utils";
import { TexSource } from "@/components/ui/tex-code";
import { texLanguageOf } from "@/lib/tex-highlight";
import { settlePartialMarkdown, splitBlocks } from "./reveal";

/* The text of a hast node and everything under it. */
type HastNode = { type: string; value?: string; children?: HastNode[]; properties?: { className?: string[] | string } };
const textOf = (node: HastNode | undefined): string => (!node ? "" : node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(textOf).join(""));

/** A copy action: the glyph turns into a check once the clipboard has the text. */
export function CopyAction({ text, label = "Copy", className }: { text: string | (() => string); label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      setState("copied");
    } catch {
      setState("failed");
    }
    timer.current = window.setTimeout(() => setState("idle"), 1600);
  };
  const name = state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : label;
  return (
    <Button type="button" variant="ghost" size="icon-sm" onClick={() => void copy()} aria-label={name} title={name} data-state={state} className={cn("text-muted-foreground hover:text-foreground data-[state=copied]:text-success data-[state=failed]:text-danger", className)}>
      {state === "copied" ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
    </Button>
  );
}

const components: Components = {
  pre: ({ node, children }) => {
    const pre = node as HastNode | undefined;
    const code = textOf(pre).replace(/\n$/, "");
    // A fenced block the assistant marked as TeX or BibTeX, or did not mark at all (here that is nearly always LaTeX), is colored as source; any other language is left as it came.
    const classes = [pre?.children?.[0]?.properties?.className ?? []].flat().join(" ");
    const marked = /language-([\w-]+)/.exec(classes)?.[1];
    const language = marked ? texLanguageOf(marked) : code.includes("\\") ? "latex" : null;
    return (
      <div className="assistant-md-code group/code">
        <pre>{language ? <code><TexSource source={code} language={language} /></code> : children}</pre>
        <CopyAction text={code} label="Copy code" className="assistant-md-code-copy" />
      </div>
    );
  },
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="assistant-md-table">
      <table>{children}</table>
    </div>
  ),
};

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: Parameters<typeof ReactMarkdown>[0]["rehypePlugins"] = [[rehypeSanitize, markdownSanitizeSchema], [rehypeKatex, { throwOnError: false, strict: "ignore" }]];

/** One block of an answer, parsed and typeset once: a finished block keeps its element while the blocks after it stream in. */
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="assistant-md-block">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

/**
 * The assistant's answer as Markdown: headings, lists, tables, inline code, fenced code with a copy button, and LaTeX math typeset by KaTeX. Raw HTML in the answer is never parsed, and what the Markdown produces is sanitized (lib/markdown-sanitize) before the math is typeset. Its typography is the `.assistant-md` block at the end of globals.css.
 *
 * The text is rendered block by block (reveal.ts, splitBlocks), so while an answer streams only its last block is parsed again each frame. `live` marks a text still being written: its last block is settled first (an open fence closed, unfinished math held back) and ends in a soft caret.
 */
export const AssistantMarkdown = memo(function AssistantMarkdown({ text, live = false, className }: { text: string; live?: boolean; className?: string }) {
  const blocks = splitBlocks(text);
  if (live && blocks.length) blocks[blocks.length - 1] = settlePartialMarkdown(blocks[blocks.length - 1]);
  return (
    <div className={cn("assistant-md", live && "assistant-md-live", className)}>
      {blocks.map((block, i) => (
        <MarkdownBlock key={i} text={block} />
      ))}
    </div>
  );
});

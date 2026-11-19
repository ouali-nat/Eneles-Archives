"use client";

import { CopyButton } from "@/components/ui/copy-button";
import { TexSource } from "@/components/ui/tex-code";
import { texLanguageOf } from "@/lib/tex-highlight";

interface CodeBlockProps {
  children: string;
  title?: string;
  language?: string;
}

export function CodeBlock({ children, title, language }: CodeBlockProps) {
  return (
    <div className="group relative my-4 rounded-lg border bg-surface/50 overflow-hidden">
      {(title || language) && (
        <div className="flex items-center justify-between px-4 py-2 border-b bg-surface/80">
          <span className="text-[11px] font-mono text-muted-foreground">
            {title || language}
          </span>
          <CopyButton text={children} />
        </div>
      )}
      {!title && !language && (
        <CopyButton
          text={children}
          showLabel={false}
          className="absolute top-2 end-2 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=copied]:opacity-100"
        />
      )}
      <pre className="p-4 overflow-x-auto">
        <code className="text-[13px] font-mono text-foreground leading-relaxed">
          <TexSource source={children} language={texLanguageOf(language)} />
        </code>
      </pre>
    </div>
  );
}

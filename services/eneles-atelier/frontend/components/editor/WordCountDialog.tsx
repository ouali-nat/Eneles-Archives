"use client";

import { useMemo } from "react";
import { countWords } from "@/lib/latex/wordcount";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Words in the document, counted from its source. */
export function WordCountDialog({
  open,
  onOpenChange,
  mainPath,
  files,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mainPath: string;
  /** Called when the dialog opens: every text file's current text. */
  files: () => Map<string, string>;
}) {
  const count = useMemo(() => (open ? countWords(mainPath, files()) : null), [open, mainPath, files]);
  const rows: [string, number][] = count
    ? [
        ["Words in the text", count.text],
        ["Words in headings", count.headings],
        ["Words in captions", count.captions],
        ["Words in footnotes", count.footnotes],
        ["Headings", count.headingCount],
        ["Inline equations", count.inlineMath],
        ["Displayed equations", count.displayMath],
      ]
    : [];
  const total = count ? count.text + count.headings + count.captions + count.footnotes : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Word count</DialogTitle>
          <DialogDescription>
            From {mainPath}
            {count && count.files.length > 1 && ` and the ${count.files.length - 1} file${count.files.length === 2 ? "" : "s"} it includes`}.
            Commands, math, and comments are not words.
          </DialogDescription>
        </DialogHeader>
        {count && (
          <dl className="flex flex-col">
            <div className="flex items-baseline justify-between border-b border-line py-2">
              <dt className="type-base font-medium">Total words</dt>
              <dd className="font-mono type-large font-semibold tabular-nums">{total.toLocaleString()}</dd>
            </div>
            {rows.map(([label, n]) => (
              <div key={label} className="flex items-baseline justify-between py-1.5">
                <dt className="type-small text-muted-foreground">{label}</dt>
                <dd className="font-mono type-small tabular-nums">{n.toLocaleString()}</dd>
              </div>
            ))}
            {count.missing.length > 0 && (
              <p className="mt-2 type-tiny text-warning">
                Not counted, not in the project: {count.missing.join(", ")}
              </p>
            )}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}

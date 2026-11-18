"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table } from "@/components/icons";
import { cn } from "@/lib/utils";

interface TablePickerProps {
  onInsert: (rows: number, cols: number) => void;
}

/** Generate a LaTeX tabular+table environment for given dimensions */
function makeTable(rows: number, cols: number): string {
  const colSpec = Array(cols).fill("c").join(" | ");
  const headerRow = Array.from({ length: cols }, (_, i) => `Col ${i + 1}`).join(" & ");
  const dataRow = Array(cols).fill("").join(" & ");
  const rowLines = [
    `    ${headerRow} \\\\`,
    "    \\hline",
    ...Array(rows - 1).fill(`    ${dataRow} \\\\`),
  ].join("\n");

  return [
    "\\begin{table}[htbp]",
    "  \\centering",
    `  \\begin{tabular}{| ${colSpec} |}`,
    "    \\hline",
    rowLines,
    "    \\hline",
    "  \\end{tabular}",
    "  \\caption{}",
    "  \\label{tab:}",
    "\\end{table}",
  ].join("\n");
}

const MAX = 9;

export function TablePicker({ onInsert }: TablePickerProps) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback(
    (r: number, c: number) => {
      onInsert(r, c);
      setOpen(false);
      setHover(null);
    },
    [onInsert]
  );

  const label =
    hover ? `${hover.r} × ${hover.c}` : "Table";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Insert table"
        >
          <Table className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="p-2 w-auto"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {/* Dimension label */}
        <p className="text-[11px] text-muted-foreground text-center mb-1.5 font-mono tabular-nums h-4">
          {hover ? `${hover.r} × ${hover.c} table` : "Hover to select size"}
        </p>

        {/* Grid */}
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${MAX}, 1fr)` }}
          onMouseLeave={() => setHover(null)}
        >
          {Array.from({ length: MAX }, (_, ri) =>
            Array.from({ length: MAX }, (_, ci) => {
              const r = ri + 1;
              const c = ci + 1;
              const isHighlighted = hover ? r <= hover.r && c <= hover.c : false;
              return (
                <button
                  key={`${r}-${c}`}
                  className={cn(
                    "h-5 w-5 rounded-[3px] border transition-colors duration-75",
                    isHighlighted
                      ? "bg-accent border-accent"
                      : "bg-surface/40 border-line hover:bg-accent/30 hover:border-accent/60"
                  )}
                  onMouseEnter={() => setHover({ r, c })}
                  onClick={() => handleSelect(r, c)}
                  aria-label={`${r}×${c} table`}
                />
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Standalone helper so EditorRibbon can use it */
export { makeTable };

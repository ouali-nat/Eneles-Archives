"use client";

import { memo, useDeferredValue, useMemo, useState } from "react";
import { List } from "@/components/icons";
import { Segmented } from "@/components/ui/segmented";
import { buildOutline, type OutlineEntry } from "@/lib/latex/outline";
import { cn } from "@/lib/utils";

/** Where a heading is: its file and its line there. */
export type JumpToHeading = (path: string, line: number) => void;

type Scope = "file" | "document";

/** Indent per level, and the heavier weight for the levels above sections. */
const LEVEL_STYLE = [
  { indent: 8, weight: "font-semibold" },
  { indent: 8, weight: "font-semibold" },
  { indent: 8, weight: "font-medium" },
  { indent: 24, weight: "font-normal" },
  { indent: 40, weight: "font-normal" },
];

interface TableOfContentsProps {
  /** Every text file in the project, by path. */
  sources: Record<string, string>;
  /** The main document, which the numbering starts from. */
  mainPath: string | null;
  /** The file open in the editor. */
  activePath: string | null;
  onJump?: JumpToHeading;
}

const sameEntries = (a: OutlineEntry[], b: OutlineEntry[]) => a.length === b.length && a.every((e, i) => e.line === b[i].line && e.level === b[i].level && e.label === b[i].label && e.number === b[i].number && e.path === b[i].path);

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

/**
 * The Contents panel: the document's parts, chapters, and sections as an outline, numbered as LaTeX numbers them. It is read from the main file and every file that file brings in (\input, \include, \subfile, \import), so a chapter kept in its own file is numbered where the main file puts it: with the third chapter's file open, its headings read 3, 3.1, 3.2, not 1, 1.1, 1.2. With the main file open, it is the whole document; with another file open, it is that file's part of it (and the files it brings in), and a switch above shows the whole document instead. A file the main file never brings in is outlined on its own. A row opens its file, if it is another, and goes to its line.
 *
 * The text changes on every keystroke. The outline is read at low priority (a keystroke is never kept waiting for it), and the list is drawn again only when a heading, its number, or its line actually changed.
 */
export const TableOfContents = memo(function TableOfContents({ sources, mainPath, activePath, onJump }: TableOfContentsProps) {
  const deferred = useDeferredValue(sources);
  const [scope, setScope] = useState<Scope>("file");

  const { parsed, inDocument } = useMemo(() => {
    const files = new Map(Object.entries(deferred));
    const root = mainPath && files.has(mainPath) ? mainPath : null;
    const whole = root ? buildOutline(root, files) : [];
    if (!activePath || activePath === root) return { parsed: whole, inDocument: !!root };
    // The open file's part of the document: its own headings and those of the files it brings in, numbered as in the whole.
    if (whole.some((e) => e.via.includes(activePath))) return { parsed: scope === "document" ? whole : whole.filter((e) => e.via.includes(activePath)), inDocument: true };
    // A file the main document does not bring in: outlined on its own, reading paths as LaTeX would from the main file's folder.
    return { parsed: buildOutline(activePath, files, root ? dirname(root) : undefined), inDocument: false };
  }, [deferred, mainPath, activePath, scope]);

  // The same outline as last time keeps its identity, so the list below is not drawn again.
  const [entries, setEntries] = useState(parsed);
  if (entries !== parsed && !sameEntries(entries, parsed)) setEntries(parsed);

  const offerScope = inDocument && !!activePath && activePath !== mainPath;

  return (
    <div className="flex h-full flex-col bg-panel">
      {offerScope && (
        <div className="shrink-0 border-b border-line p-2">
          <Segmented<Scope>
            value={scope}
            onValueChange={setScope}
            label="What the outline shows"
            options={[
              { value: "file", label: "This file" },
              { value: "document", label: "Whole document" },
            ]}
            className="flex w-full [&>*]:flex-1"
          />
        </div>
      )}
      <div className="scrollbar-modern min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <List aria-hidden className="size-6 text-muted-foreground" />
            <p className="type-base text-muted-foreground">No sections in this file.</p>
            <p className="type-small text-muted-foreground">
              Add <code className="font-mono text-foreground">\section{"{…}"}</code> and it shows here.
            </p>
          </div>
        ) : (
          <Outline entries={entries} activePath={activePath} onJump={onJump} />
        )}
      </div>
    </div>
  );
});

const Outline = memo(function Outline({ entries, activePath, onJump }: { entries: OutlineEntry[]; activePath: string | null; onJump?: JumpToHeading }) {
  const [current, setCurrent] = useState<string | null>(null);
  return (
    <nav aria-label="Contents" className="py-1">
      {entries.map((entry) => {
        const style = LEVEL_STYLE[entry.level];
        const key = `${entry.path}:${entry.line}`;
        const active = current === key;
        const elsewhere = entry.path !== activePath;
        const file = entry.path.slice(entry.path.lastIndexOf("/") + 1);
        return (
          <button
            key={key}
            type="button"
            aria-current={active ? "location" : undefined}
            title={elsewhere ? `${entry.path}, line ${entry.line}` : undefined}
            style={{ paddingInlineStart: style.indent }}
            className={cn(
              "group relative mx-1 flex min-h-8 w-[calc(100%-0.5rem)] items-center gap-2 rounded-[var(--radius-item)] pe-2 text-start type-base text-muted-foreground transition-colors hover:bg-surface-hover/60 hover:text-foreground",
              entry.level <= 2 && "text-foreground",
              active && "bg-surface-hover text-foreground",
            )}
            onClick={() => {
              setCurrent(key);
              onJump?.(entry.path, entry.line);
            }}
          >
            {entry.number && <span className="shrink-0 font-mono type-small tabular-nums text-muted-foreground">{entry.number}</span>}
            <span className={cn("min-w-0 truncate", style.weight)}>{entry.label}</span>
            {/* Where it is: the line, and the file too when it is not the one open. */}
            <span className="ms-auto max-w-[45%] shrink-0 truncate type-small tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {elsewhere ? `${file}:${entry.line}` : entry.line}
            </span>
          </button>
        );
      })}
    </nav>
  );
});

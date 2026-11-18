"use client";

import { useMemo, useState, type ReactNode } from "react";
import { diffLines } from "diff";
import { ChevronDown } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TexTokens } from "@/components/ui/tex-code";
import { texLanguageOf, tokenizeTex } from "@/lib/tex-highlight";
import { cn } from "@/lib/utils";

/** Unchanged lines kept around each change; longer unchanged runs fold. */
const CONTEXT = 3;
/** Rows drawn before the rest waits behind a button, so a whole new long file does not stall the panel. */
const FIRST_ROWS = 1200;

type Line = { kind: "same" | "add" | "del"; oldNo: number | null; newNo: number | null; text: string };
type Segment = { kind: "lines"; lines: Line[] } | { kind: "fold"; id: number; lines: Line[] };

/** Line by line, with the same tokenizing as the line counts the timeline shows (a line keeps its newline). */
export function diffByLine(before: string, after: string) {
  const lines: Line[] = [];
  let oldNo = 1;
  let newNo = 1;
  let added = 0;
  let removed = 0;
  for (const part of diffLines(before, after)) {
    const texts = part.value.replace(/\n$/, "").split("\n");
    for (const text of texts) {
      if (part.added) {
        lines.push({ kind: "add", oldNo: null, newNo: newNo++, text });
        added++;
      } else if (part.removed) {
        lines.push({ kind: "del", oldNo: oldNo++, newNo: null, text });
        removed++;
      } else lines.push({ kind: "same", oldNo: oldNo++, newNo: newNo++, text });
    }
  }
  return { lines, added, removed };
}

/** Runs of unchanged lines longer than the context around changes fold into one row. */
function fold(lines: Line[]): Segment[] {
  const keep = lines.map(() => false);
  lines.forEach((line, i) => {
    if (line.kind === "same") return;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j++) keep[j] = true;
  });
  const out: Segment[] = [];
  let run: Line[] = [];
  let hidden: Line[] = [];
  const flushRun = () => {
    if (run.length) out.push({ kind: "lines", lines: run });
    run = [];
  };
  lines.forEach((line, i) => {
    if (keep[i]) {
      if (hidden.length) {
        flushRun();
        out.push({ kind: "fold", id: i, lines: hidden });
        hidden = [];
      }
      run.push(line);
    } else hidden.push(line);
  });
  if (hidden.length) {
    flushRun();
    out.push({ kind: "fold", id: lines.length, lines: hidden });
  }
  flushRun();
  return out;
}

/**
 * A version's change as one column: removed lines (red, −) above the lines that replaced them (green, +), both line numbers in the gutter, TeX colored as everywhere else on the site, and unchanged stretches folded into a row that opens them. Long lines wrap, so the narrowest panel never scrolls sideways. The signs and numbers are drawn apart from the text, so copying a selection copies only the source.
 */
export function HistoryDiff({ before, after, path, loading = false, emptyMessage = "No changes" }: { before: string; after: string; path: string; loading?: boolean; emptyMessage?: string }) {
  const language = texLanguageOf(path);
  const diff = useMemo(() => (loading ? null : diffByLine(before, after)), [before, after, loading]);
  const oldTokens = useMemo(() => (language && !loading ? tokenizeTex(before, language) : null), [before, language, loading]);
  const newTokens = useMemo(() => (language && !loading ? tokenizeTex(after, language) : null), [after, language, loading]);
  const segments = useMemo(() => (diff ? fold(diff.lines) : []), [diff]);
  const [opened, setOpened] = useState<{ diff: unknown; ids: ReadonlySet<number> }>({ diff: null, ids: new Set() });
  const openIds = opened.diff === diff ? opened.ids : new Set<number>();
  const [all, setAll] = useState<unknown>(null);
  const showAll = all === diff;

  if (loading || !diff) {
    return (
      <div className="flex flex-col gap-2.5 px-4 py-4" role="status" aria-label="Loading the change">
        {["w-2/5", "w-3/4", "w-3/5", "w-4/5", "w-1/2", "w-2/3"].map((w) => (
          <Skeleton key={w} className={cn("h-3.5", w)} />
        ))}
      </div>
    );
  }
  if (!diff.added && !diff.removed) return <p className="px-4 py-4 type-base text-muted-foreground">{emptyMessage}</p>;

  const tokensOf = (line: Line) => (line.kind === "del" ? oldTokens?.[(line.oldNo ?? 1) - 1] : newTokens?.[(line.newNo ?? 1) - 1]);
  let drawn = 0;
  const row = (line: Line, key: string) => (
    <div key={key} data-kind={line.kind} className="grid grid-cols-[auto_auto_1.25rem_minmax(0,1fr)] data-[kind=add]:bg-success/12 data-[kind=del]:bg-danger/12">
      <span aria-hidden className="min-w-[3ch] select-none ps-3 pe-1 text-end tabular-nums text-muted-foreground/70">{line.oldNo ?? ""}</span>
      <span aria-hidden className="min-w-[3ch] select-none pe-1 text-end tabular-nums text-muted-foreground/70">{line.newNo ?? ""}</span>
      <span className={cn("select-none text-center", line.kind === "add" ? "text-success" : line.kind === "del" ? "text-danger" : "text-transparent")}>
        <span aria-hidden>{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>
        <span className="sr-only">{line.kind === "add" ? "Added" : line.kind === "del" ? "Removed" : ""}</span>
      </span>
      <span className="whitespace-pre-wrap pe-3 wrap-anywhere">{tokensOf(line) ? <TexTokens tokens={tokensOf(line)!} /> : line.text || " "}</span>
    </div>
  );

  const body: ReactNode[] = [];
  for (const segment of segments) {
    if (!showAll && drawn >= FIRST_ROWS) break;
    if (segment.kind === "fold" && !openIds.has(segment.id)) {
      const count = segment.lines.length;
      const first = segment.lines[0];
      body.push(
        <div key={`f${segment.id}`} className="flex min-h-10 items-center border-y border-line/60 bg-surface/40 px-1.5 font-sans">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpened({ diff, ids: new Set([...openIds, segment.id]) })} aria-label={`Show ${count} unchanged ${count === 1 ? "line" : "lines"} from line ${first.newNo}`}>
            <ChevronDown /> {count} unchanged {count === 1 ? "line" : "lines"}
          </Button>
        </div>,
      );
      drawn++;
      continue;
    }
    for (const [i, line] of segment.lines.entries()) {
      if (!showAll && drawn >= FIRST_ROWS) break;
      body.push(row(line, `${segment.kind === "fold" ? `f${segment.id}` : "l"}:${line.oldNo}:${line.newNo}:${i}`));
      drawn++;
    }
  }
  const total = segments.reduce((n, s) => n + (s.kind === "fold" && !openIds.has(s.id) ? 1 : s.lines.length), 0);

  return (
    <div className="py-1.5 font-mono type-small leading-5 text-foreground" dir="ltr" role="region" aria-label={`Changes to ${path}`}>
      {body}
      {!showAll && total > FIRST_ROWS && (
        <div className="flex min-h-10 items-center px-1.5 font-sans">
          <Button variant="ghost" size="sm" onClick={() => setAll(diff)}>
            Show the other {total - FIRST_ROWS} lines
          </Button>
        </div>
      )}
    </div>
  );
}

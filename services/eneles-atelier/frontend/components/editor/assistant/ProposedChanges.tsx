"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Eye, RotateCcw, X } from "@/components/icons";
import { FileTypeIcon } from "@/components/editor/FileTypeIcon";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { TEX_TONES } from "@/components/ui/tex-code";
import type { AiChatEdit } from "@/lib/api";
import { diffRows, placeAll, type DiffRow, type Marks, type Placement } from "@/lib/ai-diff";
import { cn } from "@/lib/utils";
import { TEX_START, texLanguageOf, tokenizeBibLine, tokenizeTexLine, type TexToken } from "@/lib/tex-highlight";

/** What the card can do to a proposal: whole files, single changes, and asking again about a file that changed meanwhile. */
export interface ProposalActions {
  acceptFile: (path: string) => void;
  rejectFile: (path: string) => void;
  acceptHunk: (path: string, hunkId: string) => void;
  rejectHunk: (path: string, hunkId: string) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  /** Asks Axya to make this file's change again, against its text as it is now. */
  reask?: (path: string) => void;
}

function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 type-small tabular-nums">
      <span className="text-success" aria-label={`${additions} ${additions === 1 ? "line" : "lines"} added`}>
        +{additions}
      </span>
      <span className="text-danger" aria-label={`${deletions} ${deletions === 1 ? "line" : "lines"} removed`}>
        −{deletions}
      </span>
    </span>
  );
}

/** A line's tokens with the words that changed marked: tokens are split at the marks' edges so both colors hold. */
function MarkedLine({ text, tokens, marks, kind }: { text: string; tokens: TexToken[] | null; marks?: Marks; kind: "same" | "add" | "del" }) {
  const pieces = tokens ?? [{ text }];
  if (!marks?.length) {
    return (
      <>
        {pieces.map((t, i) => (t.tone ? <span key={i} className={TEX_TONES[t.tone]}>{t.text}</span> : <Fragment key={i}>{t.text}</Fragment>))}
      </>
    );
  }
  const out: ReactNode[] = [];
  let at = 0;
  const marked = (p: number) => marks.some(([a, b]) => p >= a && p < b);
  pieces.forEach((t, ti) => {
    let start = 0;
    while (start < t.text.length) {
      const on = marked(at + start);
      let end = start + 1;
      while (end < t.text.length && marked(at + end) === on) end++;
      const piece = t.text.slice(start, end);
      out.push(
        <span key={`${ti}:${start}`} className={cn(t.tone && TEX_TONES[t.tone], on && (kind === "add" ? "rounded-[2px] bg-success/30" : "rounded-[2px] bg-danger/30"))}>
          {piece}
        </span>,
      );
      start = end;
    }
    at += t.text.length;
  });
  return <>{out}</>;
}

type Line = Exclude<DiffRow, { kind: "fold" }>;

/** Colors every visible row as TeX or BibTeX, each side of the change carrying its own open math from line to line. */
function useTokens(rows: Line[], path: string): Map<Line, TexToken[]> | null {
  return useMemo(() => {
    const language = texLanguageOf(path);
    if (!language) return null;
    const out = new Map<Line, TexToken[]>();
    let before = TEX_START;
    let after = TEX_START;
    let last: Line | null = null;
    for (const row of rows) {
      // After a fold, what the hidden lines left open is not known: start clean.
      if (last && row.oldNo !== null && last.oldNo !== null && row.oldNo !== last.oldNo + 1 && row.kind !== "add") before = after = TEX_START;
      last = row;
      if (language === "bibtex") {
        out.set(row, tokenizeBibLine(row.text));
        continue;
      }
      if (row.kind === "del") {
        const r = tokenizeTexLine(row.text, before);
        before = r.state;
        out.set(row, r.tokens);
        continue;
      }
      const r = tokenizeTexLine(row.text, after);
      after = r.state;
      if (row.kind === "same") before = r.state;
      out.set(row, r.tokens);
    }
    return out;
  }, [rows, path]);
}

const rowTone = "data-[kind=add]:bg-success/12 data-[kind=del]:bg-danger/12";
const num = "w-[1%] select-none whitespace-nowrap px-2 text-end align-top tabular-nums text-muted-foreground/70 before:content-[attr(data-n)]";
const sign = "w-4 select-none align-top text-center before:content-[attr(data-sign)] data-[sign='+']:text-success data-[sign='−']:text-danger";
const cell = "whitespace-pre-wrap pe-3 align-top text-foreground [overflow-wrap:anywhere] [tab-size:4]";

/** One change's header row: where it is, whether it still fits the file, and Accept and Reject for it alone. */
function HunkBar({ label, place, onAccept, onReject, colSpan }: { label: string; place: Placement | null; onAccept: () => void; onReject: () => void; colSpan: number }) {
  return (
    <tr className="border-t border-line first:border-t-0">
      <td colSpan={colSpan} className="bg-surface/50 py-0.5 ps-3 pe-1 font-sans">
        <div className="flex min-h-9 items-center gap-2">
          <span className="min-w-0 flex-1 truncate type-small text-muted-foreground">{label}</span>
          {place?.kind === "conflict" && (
            <span className="inline-flex items-center gap-1 type-small text-warning">
              <AlertTriangle aria-hidden className="size-4" />
              Edited since
            </span>
          )}
          {place?.kind === "applied" && <span className="type-small text-muted-foreground">Already in the file</span>}
          <Button type="button" variant="ghost" size="icon-sm" onClick={onReject} aria-label={`Reject this change (${label})`} title="Reject this change" className="text-muted-foreground hover:text-danger">
            <X aria-hidden className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onAccept} disabled={place?.kind === "conflict"} aria-label={`Accept this change (${label})`} title={place?.kind === "conflict" ? "This change would write over an edit made since; ask Axya again" : "Accept this change"} className="text-muted-foreground hover:text-success">
            <Check aria-hidden className="size-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function hunkLabel(rows: Line[]): string {
  const olds = rows.map((r) => r.oldNo).filter((n): n is number => n !== null);
  const news = rows.map((r) => r.newNo).filter((n): n is number => n !== null);
  const span = (ns: number[]) => (ns.length ? (ns[0] === ns[ns.length - 1] ? `line ${ns[0]}` : `lines ${ns[0]} to ${ns[ns.length - 1]}`) : null);
  const o = span(olds);
  const n = span(news);
  if (o && n) return o === n ? `Changes ${o}` : `Changes ${o} (now ${n.replace("line", "").replace("s ", "").trim()})`;
  if (n) return `Adds ${n}`;
  return `Removes ${o}`;
}

/** A proposed file's change as a table: unified, or side by side when there is room; word marks inside changed lines; folds over unchanged runs that open in place; a header per change with its own Accept and Reject. */
function DiffTable({ id, path, rows, view, places, onAcceptHunk, onRejectHunk }: { id: string; path: string; rows: DiffRow[]; view: "unified" | "split"; places: Map<string, Placement>; onAcceptHunk: (hunk: string) => void; onRejectHunk: (hunk: string) => void }) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const lines = useMemo(() => rows.flatMap((r) => (r.kind === "fold" ? (opened.has(r.id) ? r.rows : []) : [r])), [rows, opened]);
  const tokens = useTokens(lines, path);
  const cols = view === "split" ? 6 : 4;

  // Rows grouped for drawing: a fold, an unchanged line, or one change's removed and added lines.
  type Group = { kind: "fold"; row: Extract<DiffRow, { kind: "fold" }> } | { kind: "same"; row: Line } | { kind: "hunk"; id: string; dels: Line[]; adds: Line[] };
  const groups: Group[] = [];
  for (const r of rows) {
    if (r.kind === "fold") {
      if (opened.has(r.id)) r.rows.forEach((row) => groups.push({ kind: "same", row }));
      else groups.push({ kind: "fold", row: r });
    } else if (r.kind === "same") groups.push({ kind: "same", row: r });
    else {
      const last = groups[groups.length - 1];
      const g = last?.kind === "hunk" && last.id === r.hunk ? last : null;
      if (g) (r.kind === "del" ? g.dels : g.adds).push(r);
      else groups.push({ kind: "hunk", id: r.hunk, dels: r.kind === "del" ? [r] : [], adds: r.kind === "add" ? [r] : [] });
    }
  }

  const content = (row: Line) => <MarkedLine text={row.text} tokens={tokens?.get(row) ?? null} marks={row.kind === "same" ? undefined : row.marks} kind={row.kind} />;
  const ending = (row: Line) => row.kind !== "same" && row.ending && <span className="ms-2 rounded-[var(--radius-inset)] bg-surface px-1 font-sans type-small text-muted-foreground">line ending: {row.ending}</span>;
  const empty = (row: Line) => !row.text && " ";

  const unified = (row: Line) => (
    <tr key={`${row.kind}:${row.oldNo}:${row.newNo}`} data-kind={row.kind} className={rowTone}>
      <td className={num} data-n={row.oldNo ?? ""} aria-hidden />
      <td className={num} data-n={row.newNo ?? ""} aria-hidden />
      <td className={sign} data-sign={row.kind === "add" ? "+" : row.kind === "del" ? "−" : ""} aria-hidden />
      <td className={cell}>
        <span className="sr-only">{row.kind === "add" ? "Added: " : row.kind === "del" ? "Removed: " : ""}</span>
        {content(row)}
        {empty(row)}
        {ending(row)}
      </td>
    </tr>
  );

  const half = (row: Line | undefined, side: "old" | "new") =>
    row ? (
      <>
        <td className={num} data-n={(side === "old" ? row.oldNo : row.newNo) ?? ""} data-kind={row.kind} aria-hidden />
        <td className={cn(cell, "w-1/2 border-e border-line/60 ps-1 last:border-e-0", row.kind === "add" && "bg-success/12", row.kind === "del" && "bg-danger/12")}>
          <span className="sr-only">{row.kind === "add" ? "Added: " : row.kind === "del" ? "Removed: " : ""}</span>
          {content(row)}
          {empty(row)}
          {ending(row)}
        </td>
      </>
    ) : (
      <>
        <td className={num} aria-hidden />
        <td className="w-1/2 border-e border-line/60 bg-surface/40 last:border-e-0" aria-hidden />
      </>
    );

  return (
    <div id={id} className="scrollbar-modern max-h-[28rem] overflow-auto border-t border-line bg-background font-mono type-small" role="region" aria-label={`Changes to ${path}`}>
      <table className="w-full border-collapse">
        <tbody>
          {groups.map((g, gi) => {
            if (g.kind === "fold") {
              const n = g.row.rows.length;
              return (
                <tr key={g.row.id}>
                  <td colSpan={cols} className="bg-surface/60 p-0 font-sans">
                    <button type="button" onClick={() => setOpened((s) => new Set(s).add(g.row.id))} className="flex min-h-9 w-full items-center justify-center gap-1.5 type-small text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground" aria-label={`Show ${n} unchanged lines, ${g.row.rows[0].oldNo} to ${g.row.rows[n - 1].oldNo}`}>
                      <ChevronDown aria-hidden className="size-4" />
                      {n} unchanged lines
                    </button>
                  </td>
                </tr>
              );
            }
            if (g.kind === "same") {
              if (view === "unified") return unified(g.row);
              return (
                <tr key={`s:${g.row.oldNo}`} data-kind="same">
                  {half(g.row, "old")}
                  {half(g.row, "new")}
                </tr>
              );
            }
            const bar = <HunkBar key={`bar:${g.id}:${gi}`} label={hunkLabel([...g.dels, ...g.adds])} place={places.get(g.id) ?? null} onAccept={() => onAcceptHunk(g.id)} onReject={() => onRejectHunk(g.id)} colSpan={cols} />;
            if (view === "unified") return [bar, ...g.dels.map(unified), ...g.adds.map(unified)];
            const n = Math.max(g.dels.length, g.adds.length);
            return [
              bar,
              ...Array.from({ length: n }, (_, i) => (
                <tr key={`p:${g.id}:${i}`}>
                  {half(g.dels[i], "old")}
                  {half(g.adds[i], "new")}
                </tr>
              )),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The card's width, to offer the side-by-side view only where it fits. */
function useWide(min: number) {
  const ref = useRef<HTMLLIElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWide(el.clientWidth >= min));
    observer.observe(el);
    return () => observer.disconnect();
  }, [min]);
  return [ref, wide] as const;
}

const VIEW_KEY = "texer-assistant-diff-view";
const readView = (): "unified" | "split" => {
  try {
    return localStorage.getItem(VIEW_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
};

function FileCard({ edit, current, actions, onOpen, defaultOpen }: { edit: AiChatEdit; current: string | null; actions: ProposalActions; onOpen?: () => void; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState<"unified" | "split">(readView);
  const [ref, wide] = useWide(620);
  const id = useId();
  const name = edit.path.slice(edit.path.lastIndexOf("/") + 1);
  const folder = edit.path.slice(0, edit.path.length - name.length);
  const diff = useMemo(() => diffRows(edit.oldContent || "", edit.newContent || ""), [edit.oldContent, edit.newContent]);
  // Where each change lands on the file as it is now: edits made since the proposal can conflict.
  const placed = useMemo(() => {
    if (current === null || edit.created) return null;
    return placeAll(edit.oldContent, edit.newContent, current);
  }, [edit.oldContent, edit.newContent, edit.created, current]);
  const places = useMemo(() => new Map((placed ?? []).map((p) => [p.hunk.id, p.place])), [placed]);
  const stale = edit.created ? current !== null : edit.deleted ? current !== null && current !== edit.oldContent : current !== null && current !== edit.oldContent;
  const conflicts = placed?.filter((p) => p.place.kind === "conflict").length ?? 0;
  const fits = (placed?.length ?? diff.hunks.length) - conflicts;
  const shownView = wide ? view : "unified";
  const chooseView = (v: "unified" | "split") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // The choice then lasts for this page.
    }
  };

  return (
    <li ref={ref} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-card">
      <div className="flex min-h-11 flex-wrap items-center gap-1 py-1 ps-1 pe-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id} className="flex min-h-[var(--control-height)] min-w-0 flex-[1_1_15rem] items-center gap-2 rounded-[var(--radius)] px-2 text-start transition-colors hover:bg-surface-hover">
          <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-control-duration)] rtl:-scale-x-100", open && "rotate-90 rtl:-rotate-90")} />
          <FileTypeIcon filename={edit.path} className="size-4 shrink-0" />
          <span className="min-w-0 truncate type-base" title={edit.path}>
            {folder && <span className="text-muted-foreground">{folder}</span>}
            <span className={cn("font-medium text-foreground", edit.deleted && "line-through")}>{name}</span>
          </span>
          {edit.created && <span className="shrink-0 rounded-[var(--radius-inset)] bg-surface px-1.5 type-small text-muted-foreground">New</span>}
          {edit.deleted && <span className="shrink-0 rounded-[var(--radius-inset)] bg-danger/12 px-1.5 type-small text-danger">Delete</span>}
          <Counts additions={diff.additions} deletions={diff.deletions} />
        </button>
        <span className="ms-auto flex shrink-0 items-center gap-1">
          {wide && open && !edit.deleted && <Segmented value={view} onValueChange={chooseView} options={[{ value: "unified", label: "Unified" }, { value: "split", label: "Split" }]} label="Diff view" />}
          {onOpen && !edit.created && !edit.deleted && (
            <Button type="button" variant="ghost" size="icon-sm" onClick={onOpen} aria-label={`Review ${edit.path} in the editor`} title="Review in the editor, change by change" className="text-muted-foreground hover:text-foreground">
              <Eye aria-hidden className="size-4" />
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => actions.rejectFile(edit.path)} aria-label={`Reject the changes to ${edit.path}`}>
            Reject
          </Button>
          <Button type="button" size="sm" onClick={() => actions.acceptFile(edit.path)} disabled={stale && fits === 0} aria-label={conflicts && fits ? `Accept the ${fits === 1 ? "change" : `${fits} changes`} to ${edit.path} that still ${fits === 1 ? "fits" : "fit"}` : `Accept the changes to ${edit.path}`}>
            {conflicts && fits ? `Accept ${fits}` : "Accept"}
          </Button>
        </span>
      </div>
      {stale && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-warning/8 px-3 py-2">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1 type-small text-foreground">
            {edit.created
              ? "A file with this name was created after Axya proposed it. Accepting would replace it."
              : edit.deleted
                ? "This file was edited after Axya proposed deleting it."
                : conflicts
                  ? fits === 0
                    ? `This file was edited after Axya proposed this, where the ${conflicts === 1 ? "change was" : "changes were"} to go. Accepting would write over the newer text: ask Axya again, or reject.`
                    : `This file was edited after Axya proposed this. ${conflicts} of ${conflicts + fits} changes would write over the newer text and are held back; the rest still apply where they moved to.`
                  : "This file was edited after Axya proposed this. Every change still applies to the current text, where it moved to."}
          </p>
          {actions.reask && (conflicts > 0 || edit.created || edit.deleted) && (
            <Button type="button" variant="outline" size="sm" onClick={() => actions.reask?.(edit.path)}>
              <RotateCcw aria-hidden className="size-4" />
              Ask again
            </Button>
          )}
        </div>
      )}
      {open && (edit.deleted ? <p className="border-t border-line px-3 py-2.5 type-small text-muted-foreground">Accepting deletes this file ({diff.deletions} lines). It stays in the file history.</p> : <DiffTable id={id} path={edit.path} rows={diff.rows} view={shownView} places={places} onAcceptHunk={(h) => actions.acceptHunk(edit.path, h)} onRejectHunk={(h) => actions.rejectHunk(edit.path, h)} />)}
    </li>
  );
}

/**
 * The files the assistant proposes to change, each a card: its path, the lines added and removed, the change itself (unified, or side by side when there is room, with the changed words marked and TeX colored), and Accept and Reject for the file and for each change in it. Above them, Accept all and Reject all. A file edited after the proposal says so: the changes that still fit can be accepted where they moved to, and the ones that would write over the newer edit cannot, and can be asked for again.
 */
export function ProposedChanges({ edits, currentText, actions, onOpenFile }: { edits: AiChatEdit[]; currentText?: (path: string) => string | null; actions: ProposalActions; onOpenFile?: (path: string) => void }) {
  const totals = useMemo(() => edits.reduce((t, e) => {
    const d = diffRows(e.oldContent || "", e.newContent || "");
    return { additions: t.additions + d.additions, deletions: t.deletions + d.deletions };
  }, { additions: 0, deletions: 0 }), [edits]);
  return (
    <section aria-label="Proposed changes" className="flex flex-col gap-2">
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="type-base font-medium text-foreground">{edits.length === 1 ? "1 file to review" : `${edits.length} files to review`}</h3>
        <Counts {...totals} />
        {edits.length > 1 && (
          <span className="ms-auto flex items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={actions.rejectAll}>
              Reject all
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={actions.acceptAll}>
              Accept all
            </Button>
          </span>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {edits.map((edit) => (
          <FileCard key={edit.path} edit={edit} current={currentText?.(edit.path) ?? null} actions={actions} onOpen={onOpenFile ? () => onOpenFile(edit.path) : undefined} defaultOpen={edits.length === 1} />
        ))}
      </ul>
    </section>
  );
}

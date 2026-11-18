/**
 * The diff behind the assistant's proposed changes, shared by the card in the assistant and the review in the editor so the two always agree.
 *
 * A text is compared as lines that keep their own line endings ("\n", "\r\n", or none on a last line), so a changed line ending or a missing final newline is a real change, and putting the chosen lines back together gives exactly the text, byte for byte: CRLF files stay CRLF, a file without a final newline stays without one.
 *
 * A proposal is a base (the file as the assistant read it) and a proposed text. Its changes are hunks: runs of removed and added lines between unchanged ones. A hunk can be accepted (the base takes it, and so does the file) or rejected (the proposal drops it). When the file changed since the proposal (the person or a collaborator edited it), each hunk is placed onto the current text by a three-way merge: a hunk whose lines nobody touched still applies where they moved to; one whose lines were edited is a conflict, offered to be asked again rather than written over the edit.
 */
import { diffArrays, diffWordsWithSpace } from "diff";

export function splitLines(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/** A line without its ending. */
export const bare = (line: string) => line.replace(/\r?\n$/, "");
export const endingOf = (line: string): "\n" | "\r\n" | "" => (line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "");

export interface Hunk {
  /** Stable for the same change in the same texts: where it is and what it does. */
  id: string;
  /** Index of its first line in the base (0-based), and the lines it removes. */
  oldStart: number;
  oldLines: string[];
  /** Index of its first line in the proposed text, and the lines it adds. */
  newStart: number;
  newLines: string[];
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Past this many differing lines the search stops, and the file is shown as replaced as a whole. */
const MAX_EDIT = 4000;

type Part = { kind: "same" | "del" | "add"; lines: string[] };

function lineParts(a: string[], b: string[]): Part[] {
  const changes = diffArrays(a, b, { maxEditLength: MAX_EDIT } as never) as Array<{ value: string[]; added?: boolean; removed?: boolean }> | undefined;
  if (!changes) return [...(a.length ? [{ kind: "del" as const, lines: a }] : []), ...(b.length ? [{ kind: "add" as const, lines: b }] : [])];
  return changes.map((c) => ({ kind: c.added ? "add" : c.removed ? "del" : "same", lines: c.value }));
}

/** The hunks that turn `oldText` into `newText`, in order. */
export function diffHunks(oldText: string, newText: string): Hunk[] {
  const parts = lineParts(splitLines(oldText), splitLines(newText));
  const hunks: Hunk[] = [];
  let o = 0;
  let n = 0;
  let open: Hunk | null = null;
  const close = () => {
    if (open) {
      open.id = `${open.oldStart}:${open.newStart}:${hash(open.oldLines.join("") + "\u0000" + open.newLines.join(""))}`;
      hunks.push(open);
    }
    open = null;
  };
  for (const part of parts) {
    if (part.kind === "same") {
      close();
      o += part.lines.length;
      n += part.lines.length;
      continue;
    }
    open ??= { id: "", oldStart: o, oldLines: [], newStart: n, newLines: [] };
    if (part.kind === "del") {
      open.oldLines.push(...part.lines);
      o += part.lines.length;
    } else {
      open.newLines.push(...part.lines);
      n += part.lines.length;
    }
  }
  close();
  return hunks;
}

const splice = (lines: string[], at: number, remove: number, insert: string[]) => [...lines.slice(0, at), ...insert, ...lines.slice(at + remove)];

/** The base with this hunk taken: accepting it moves it out of what is left to review. */
export function acceptIntoBase(base: string, hunk: Hunk): string {
  return splice(splitLines(base), hunk.oldStart, hunk.oldLines.length, hunk.newLines).join("");
}

/** The proposal without this hunk: rejecting it puts the base's lines back. */
export function rejectFromProposal(proposed: string, hunk: Hunk): string {
  return splice(splitLines(proposed), hunk.newStart, hunk.newLines.length, hunk.oldLines).join("");
}

/** The base with only the chosen hunks taken. */
export function applyHunks(base: string, hunks: readonly Hunk[]): string {
  let lines = splitLines(base);
  // From the end, so earlier indices stay right.
  for (const h of [...hunks].sort((a, b) => b.oldStart - a.oldStart)) lines = splice(lines, h.oldStart, h.oldLines.length, h.newLines);
  return lines.join("");
}

/** Where a hunk lands on the current text of the file. */
export type Placement =
  /** It applies at `start` in the current text, replacing `oldLines.length` lines. */
  | { kind: "clean"; start: number }
  /** The current text already has this change. */
  | { kind: "applied"; start: number }
  /** Someone changed these lines since the proposal: applying it would write over their edit. */
  | { kind: "conflict" };

/**
 * Places a hunk made against `base` onto `current` (the base plus edits made since): a three-way merge, line by line. The hunk applies where its lines moved to when nobody touched them; when their edits overlap its lines (or insert at the same place), it is a conflict.
 */
export function placeHunk(base: string, current: string, hunk: Hunk, theirs?: Part[]): Placement {
  if (base === current) return { kind: "clean", start: hunk.oldStart };
  const parts = theirs ?? lineParts(splitLines(base), splitLines(current));
  const from = hunk.oldStart;
  const to = hunk.oldStart + hunk.oldLines.length;
  let o = 0;
  let shift = 0;
  let conflict = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.kind === "same") {
      o += part.lines.length;
      continue;
    }
    // One change of theirs: a run of removed and added lines at base position o.
    let removed = 0;
    let added = 0;
    let j = i;
    for (; j < parts.length && parts[j].kind !== "same"; j++) {
      if (parts[j].kind === "del") removed += parts[j].lines.length;
      else added += parts[j].lines.length;
    }
    i = j - 1;
    const s = o;
    const e = o + removed;
    o = e;
    const before = e <= from && !(removed === 0 && s === from && hunk.oldLines.length === 0);
    if (before) {
      shift += added - removed;
      continue;
    }
    if (s >= to && !(hunk.oldLines.length === 0 && s === from)) continue; // after
    conflict = true;
  }
  if (conflict) {
    // Their edit may be this very change, made by hand or accepted another way.
    const cur = splitLines(current);
    for (let k = 0; k + hunk.newLines.length <= cur.length; k++) {
      if (hunk.newLines.length && hunk.newLines.every((l, x) => cur[k + x] === l) && Math.abs(k - hunk.newStart) < 200) return { kind: "applied", start: k };
    }
    return { kind: "conflict" };
  }
  const start = from + shift;
  const cur = splitLines(current);
  if (!hunk.oldLines.every((l, x) => cur[start + x] === l)) return { kind: "conflict" };
  return { kind: "clean", start };
}

/** The current text with this hunk applied where it lands, or null when it conflicts. */
export function applyToCurrent(base: string, current: string, hunk: Hunk): string | null {
  const place = placeHunk(base, current, hunk);
  if (place.kind === "conflict") return null;
  if (place.kind === "applied") return current;
  return splice(splitLines(current), place.start, hunk.oldLines.length, hunk.newLines).join("");
}

/** Every hunk of a proposal with where it lands on the current text. */
export function placeAll(base: string, proposed: string, current: string): Array<{ hunk: Hunk; place: Placement }> {
  const hunks = diffHunks(base, proposed);
  const theirs = base === current ? undefined : lineParts(splitLines(base), splitLines(current));
  return hunks.map((hunk) => ({ hunk, place: placeHunk(base, current, hunk, theirs) }));
}

/* ── Rows for the preview ───────────────────────────────────────────────── */

/** Character ranges [start, end) within a line's text that changed. */
export type Marks = Array<[number, number]>;

export type DiffRow =
  | { kind: "same"; oldNo: number; newNo: number; text: string }
  | { kind: "del" | "add"; oldNo: number | null; newNo: number | null; text: string; hunk: string; marks?: Marks; ending?: string }
  | { kind: "fold"; id: string; rows: Array<{ kind: "same"; oldNo: number; newNo: number; text: string }> };

/** The words that changed between a removed line and the line that took its place, when they share enough to make marking them useful. */
export function wordMarks(before: string, after: string): { del: Marks; add: Marks } | null {
  if (before === after) return { del: [], add: [] };
  if (before.length + after.length > 4000) return null;
  const parts = diffWordsWithSpace(before, after);
  const del: Marks = [];
  const add: Marks = [];
  let a = 0;
  let b = 0;
  let same = 0;
  for (const p of parts) {
    if (p.added) {
      add.push([b, b + p.value.length]);
      b += p.value.length;
    } else if (p.removed) {
      del.push([a, a + p.value.length]);
      a += p.value.length;
    } else {
      same += p.value.trim().length;
      a += p.value.length;
      b += p.value.length;
    }
  }
  // A rewrite shares too little to mark: the whole line reads as changed.
  const longest = Math.max(before.trim().length, after.trim().length, 1);
  return same / longest < 0.35 ? null : { del, add };
}

const describeEnding = (e: string) => (e === "\r\n" ? "CRLF" : e === "\n" ? "LF" : "no newline");

/** The rows of a unified diff, with numbers on both sides, word marks inside paired lines, and unchanged runs longer than `context` lines on either side of a change folded. */
export function diffRows(oldText: string, newText: string, context = 3): { rows: DiffRow[]; additions: number; deletions: number; hunks: Hunk[] } {
  const hunks = diffHunks(oldText, newText);
  const oldLines = splitLines(oldText);
  const flat: DiffRow[] = [];
  let o = 0;
  let additions = 0;
  let deletions = 0;
  const pushSame = (until: number) => {
    while (o < until) {
      const newNo = o + 1 + shift;
      flat.push({ kind: "same", oldNo: o + 1, newNo, text: bare(oldLines[o]) });
      o++;
    }
  };
  let shift = 0;
  for (const h of hunks) {
    pushSame(h.oldStart);
    const pairs = h.oldLines.length && h.newLines.length && Math.abs(h.oldLines.length - h.newLines.length) <= Math.max(h.oldLines.length, h.newLines.length) ? Math.min(h.oldLines.length, h.newLines.length) : 0;
    const marks = Array.from({ length: pairs }, (_, i) => wordMarks(bare(h.oldLines[i]), bare(h.newLines[i])));
    h.oldLines.forEach((line, i) => {
      const pair = i < pairs ? h.newLines[i] : undefined;
      const ending = pair !== undefined && bare(pair) === bare(line) && endingOf(pair) !== endingOf(line) ? describeEnding(endingOf(line)) : undefined;
      flat.push({ kind: "del", oldNo: h.oldStart + i + 1, newNo: null, text: bare(line), hunk: h.id, marks: marks[i]?.del, ending });
    });
    h.newLines.forEach((line, i) => {
      const pair = i < pairs ? h.oldLines[i] : undefined;
      const ending = pair !== undefined && bare(pair) === bare(line) && endingOf(pair) !== endingOf(line) ? describeEnding(endingOf(line)) : undefined;
      flat.push({ kind: "add", oldNo: null, newNo: h.newStart + i + 1, text: bare(line), hunk: h.id, marks: marks[i]?.add, ending });
    });
    deletions += h.oldLines.length;
    additions += h.newLines.length;
    o = h.oldStart + h.oldLines.length;
    shift = h.newStart + h.newLines.length - o;
  }
  pushSame(oldLines.length);

  // Fold unchanged runs far from any change.
  const keep = flat.map((r) => r.kind !== "same");
  flat.forEach((r, i) => {
    if (r.kind === "same") return;
    for (let j = Math.max(0, i - context); j <= Math.min(flat.length - 1, i + context); j++) keep[j] = true;
  });
  const rows: DiffRow[] = [];
  let run: Array<{ kind: "same"; oldNo: number; newNo: number; text: string }> = [];
  const flush = () => {
    if (!run.length) return;
    // Folding fewer than three lines saves nothing.
    if (run.length < 3) rows.push(...run);
    else rows.push({ kind: "fold", id: `fold:${run[0].oldNo}`, rows: run });
    run = [];
  };
  flat.forEach((r, i) => {
    if (keep[i] || r.kind !== "same") {
      flush();
      rows.push(r);
    } else run.push(r);
  });
  flush();
  return { rows, additions, deletions, hunks };
}

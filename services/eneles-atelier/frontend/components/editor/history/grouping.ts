import type { HistoryEntry, HistoryPerson } from "@/lib/api";

/** Versions by the same people less than this far apart are one sitting, shown as one row. */
export const SESSION_GAP_MS = 20 * 60 * 1000;

/** A sitting: consecutive versions (newest first) by the same people, close together, on one day. A labelled version or a restore always stands alone, so it is never folded out of sight. */
export interface HistorySession {
  key: string;
  entries: HistoryEntry[];
  /** Distinct files, most recently changed first. */
  paths: string[];
  people: HistoryPerson[];
  added: number;
  removed: number;
  /** The newest change in the sitting, and the first. */
  latest: string;
  earliest: string;
}

/** The rows the timeline draws, in order. Heights are fixed per kind, so the list can draw only what is on screen. */
export type HistoryRow =
  | { kind: "day"; key: string; date: string }
  | { kind: "session"; key: string; session: HistorySession; expanded: boolean }
  | { kind: "entry"; key: string; entry: HistoryEntry; nested: boolean }
  | { kind: "more"; key: string };

export const ROW_HEIGHT = {
  day: 36,
  session: 60,
  entry: 60,
  labelled: 84,
  nested: 40,
  more: 60,
} as const;

export function rowHeight(row: HistoryRow): number {
  if (row.kind === "day") return ROW_HEIGHT.day;
  if (row.kind === "more") return ROW_HEIGHT.more;
  if (row.kind === "session") return ROW_HEIGHT.session;
  if (row.nested) return ROW_HEIGHT.nested;
  return row.entry.label ? ROW_HEIGHT.labelled : ROW_HEIGHT.entry;
}

/** Who a version names: its authors, or the person who saved it when it names no authors. Empty for versions from before either was recorded. */
export function peopleOf(entry: HistoryEntry): HistoryPerson[] {
  return entry.authors.length ? entry.authors : [];
}

function peopleKey(entry: HistoryEntry) {
  const ids = peopleOf(entry).map((p) => p.id);
  return ids.length ? [...ids].sort((a, b) => a - b).join(",") : "unknown";
}

/** The local calendar day of a moment, as a key. */
export function dayKey(value: string | Date) {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Fold versions (newest first) into sittings. */
export function sessionsOf(entries: HistoryEntry[]): HistorySession[] {
  const out: HistorySession[] = [];
  let current: HistoryEntry[] = [];
  const flush = () => {
    if (!current.length) return;
    const paths: string[] = [];
    const people = new Map<number, HistoryPerson>();
    let added = 0;
    let removed = 0;
    for (const e of current) {
      if (!paths.includes(e.filePath)) paths.push(e.filePath);
      for (const p of peopleOf(e)) if (!people.has(p.id)) people.set(p.id, p);
      added += e.linesAdded;
      removed += e.linesRemoved;
    }
    out.push({
      key: `s${current[0].id}`,
      entries: current,
      paths,
      people: [...people.values()],
      added,
      removed,
      latest: current[0].updatedAt,
      earliest: current[current.length - 1].createdAt,
    });
    current = [];
  };
  for (const entry of entries) {
    const last = current[current.length - 1];
    const alone = (e: HistoryEntry) => !!e.label || e.restoredFromId !== null;
    const joins =
      last &&
      !alone(last) &&
      !alone(entry) &&
      peopleKey(last) === peopleKey(entry) &&
      dayKey(last.createdAt) === dayKey(entry.updatedAt) &&
      new Date(last.createdAt).getTime() - new Date(entry.updatedAt).getTime() <= SESSION_GAP_MS;
    if (!joins) flush();
    current.push(entry);
  }
  flush();
  return out;
}

/** The timeline's rows: a heading per day, then each sitting as one row (its versions under it when opened), or a version on its own. */
export function buildRows(entries: HistoryEntry[], expanded: ReadonlySet<string>, more: boolean): HistoryRow[] {
  const rows: HistoryRow[] = [];
  let day = "";
  for (const session of sessionsOf(entries)) {
    const d = dayKey(session.latest);
    if (d !== day) {
      day = d;
      rows.push({ kind: "day", key: `d${d}`, date: session.latest });
    }
    if (session.entries.length === 1) {
      rows.push({ kind: "entry", key: `e${session.entries[0].id}`, entry: session.entries[0], nested: false });
      continue;
    }
    const open = expanded.has(session.key);
    rows.push({ kind: "session", key: session.key, session, expanded: open });
    if (open) for (const entry of session.entries) rows.push({ kind: "entry", key: `e${entry.id}`, entry, nested: true });
  }
  if (more) rows.push({ kind: "more", key: "more" });
  return rows;
}

/** The last part of a path. */
export function baseName(path: string) {
  return path.split("/").pop() || path;
}

/** "Euler", "Euler and Gauss", "Euler, Gauss, and Riemann", "Euler and 3 others". */
export function namesOf(people: { name: string }[], unknown = "Unknown"): string {
  const names = people.map((p) => p.name);
  if (!names.length) return unknown;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]}`;
  return `${names[0]} and ${names.length - 1} others`;
}

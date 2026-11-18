"use client";

import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, Check, ChevronRight, Columns2, ExternalLink, History, RotateCcw, Tag, User, X } from "@/components/icons";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RelativeTime } from "@/components/ui/time";
import { Avatar } from "@/components/people/Avatar";
import { FileTypeIcon } from "@/components/editor/FileTypeIcon";
import { HistoryDiff } from "@/components/editor/history/HistoryDiff";
import { FilesFilter, PeopleFilter } from "@/components/editor/history/HistoryFilters";
import { baseName, buildRows, dayKey, namesOf, peopleOf, rowHeight, ROW_HEIGHT, type HistoryRow, type HistorySession } from "@/components/editor/history/grouping";
import type { DockController } from "@/components/editor/workspace/controller";
import { projectsAPI, type HistoryComparison, type HistoryEntry, type HistoryFacets, type HistoryPage, type HistoryPerson } from "@/lib/api";
import { cn, formatCount } from "@/lib/utils";

/** Versions per request. */
const PAGE = 60;
/** While the panel is on screen, how often it looks for versions other people have saved. */
const REFRESH_MS = 30_000;
/** Rows drawn above and below what is on screen, in pixels. */
const OVERSCAN = 480;
/** How far the list scrolls before it works out again which rows to draw. */
const SCROLL_STEP = 160;

export type HistoryRestoreResult = Awaited<ReturnType<typeof projectsAPI.applyHistoryRestore>>;

/** Where the versions come from: the project's history on the server, or, in the desktop app, the snapshots it keeps of a folder's files. */
export interface HistorySource {
  getHistory: (options: { paths?: string[]; authors?: number[]; cursor?: number | null; limit?: number }, signal?: AbortSignal) => Promise<HistoryPage>;
  getFacets: (signal?: AbortSignal) => Promise<HistoryFacets>;
  compare: (historyId: number, against: "previous" | "current", signal?: AbortSignal) => Promise<HistoryComparison>;
  restore: (historyId: number) => Promise<HistoryRestoreResult>;
  label: (historyId: number, label: string) => Promise<unknown>;
  /** False where every version is the one person's, so the People filter has nothing to offer. */
  people?: boolean;
  /** Who a version that names no one is shown as ("You" where every version is the reader's own); "Unknown" when left out. */
  nobody?: string;
}

/** The name for versions that name no one, from the source. */
const Nobody = createContext<string | undefined>(undefined);

/** The project's history through the API. */
function serverHistory(projectId: string): HistorySource {
  return {
    getHistory: (options, signal) => projectsAPI.getHistory(projectId, options, signal),
    getFacets: (signal) => projectsAPI.getHistoryFacets(projectId, signal),
    compare: (historyId, against, signal) => projectsAPI.compareHistory(projectId, historyId, against, signal),
    restore: (historyId) => projectsAPI.applyHistoryRestore(projectId, historyId),
    label: (historyId, label) => projectsAPI.labelHistorySnapshot(projectId, historyId, label),
  };
}

interface HistoryPanelProps {
  projectId: string;
  /** The dock, to know whether this panel's tab is in front: a hidden panel fetches nothing and keeps no timer. */
  dock: DockController;
  canEdit: boolean;
  currentUserId: number | null;
  /** Bumped when this browser has saved a version, so the timeline brings itself up to date. */
  revision: number;
  /** A request from elsewhere (the file tree, the editor) to show some files' history; `seq` changes with each request. */
  focus: { paths: string[]; seq: number } | null;
  /** The project's file paths now, to tell which files still exist. */
  filePaths: string[];
  onOpenFile: (path: string) => void;
  /** A version was restored on the server: the editor brings its copy of the file up to date. */
  onRestored: (result: HistoryRestoreResult) => void;
  /** Where the versions come from, when not the project's history on the server. */
  source?: HistorySource;
}

/** Whether the History tab is in front. It is read from the dock directly, because a panel behind another tab is not drawn again by its parent (see Paused in DockWorkspace). */
function usePanelVisible(dock: DockController) {
  return useSyncExternalStore(
    dock.subscribe,
    () => dock.getSnapshot().visible.includes("history"),
    () => false,
  );
}

/** "+12 −3", in the diff's colors, read out in words. */
function Counts({ added, removed, className }: { added: number; removed: number; className?: string }) {
  if (!added && !removed) return null;
  return (
    <span className={cn("shrink-0 type-small tabular-nums", className)}>
      <span aria-hidden>
        <span className={added ? "text-success" : "text-muted-foreground"}>+{added}</span> <span className={removed ? "text-danger" : "text-muted-foreground"}>−{removed}</span>
      </span>
      <span className="sr-only">
        {formatCount(added, "line", "lines")} added, {formatCount(removed, "line", "lines")} removed
      </span>
    </span>
  );
}

/** Up to three faces, overlapping; a plain mark for versions that name no one. */
function Faces({ people }: { people: HistoryPerson[] }) {
  if (!people.length)
    return (
      <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-surface text-muted-foreground">
        <User className="size-3" />
      </span>
    );
  return (
    <span aria-hidden className="flex shrink-0 items-center">
      {people.slice(0, 3).map((p, i) => (
        <Avatar key={p.id} person={p} size="xs" decorative className={cn("ring-2 ring-panel", i > 0 && "-ms-1.5")} />
      ))}
    </span>
  );
}

function dayLabel(date: string) {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const d = dayKey(date);
  return d === today ? "Today" : d === yesterday ? "Yesterday" : null;
}

/** The skeleton of the real rows, while the first page loads. */
function TimelineSkeleton() {
  return (
    <div className="flex flex-col px-1.5 pt-1" role="status" aria-label="Loading the history">
      <div className="flex h-9 items-end px-2.5 pb-2">
        <Skeleton className="h-3 w-16" />
      </div>
      {[0.55, 0.4, 0.7, 0.5, 0.62, 0.45].map((w, i) => (
        <div key={i} className="flex h-[60px] gap-2.5 px-2.5 py-2">
          <Skeleton className="mt-0.5 size-4 rounded-[var(--radius-inset)]" />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-0.5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-3.5" style={{ width: `${w * 100}%` }} />
              <Skeleton className="ms-auto h-3 w-10" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="size-5 rounded-full" />
              <Skeleton className="h-3" style={{ width: `${(w + 0.15) * 70}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      <span className="mb-1 grid size-11 place-items-center rounded-full bg-surface text-muted-foreground">{icon}</span>
      <p className="type-base font-medium">{title}</p>
      {children}
    </div>
  );
}

/**
 * The History panel: the whole project's history on one timeline, newest first. Each row is a file (or a sitting's files), who changed it, when, and how many lines it added and removed; a sitting (versions by the same people close together) folds into one row that opens to its versions. Files and People narrow it. Choosing a version opens its change against the version before, with Restore, Compare with current, Label, and Open the file.
 */
export function HistoryPanel({ projectId, dock, canEdit, currentUserId, revision, focus, filePaths, onOpenFile, onRestored, source: given }: HistoryPanelProps) {
  const visible = usePanelVisible(dock);
  const source = useMemo(() => given ?? serverHistory(projectId), [given, projectId]);
  const [paths, setPaths] = useState<string[]>([]);
  const [authors, setAuthors] = useState<number[]>([]);
  const [facets, setFacets] = useState<HistoryFacets | null>(null);
  const [list, setList] = useState<{ key: string; entries: HistoryEntry[]; next: number | null; status: "ready" | "error" }>({ key: "", entries: [], next: null, status: "ready" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [openId, setOpenId] = useState<number | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const listFocus = useRef<HTMLDivElement>(null);

  // A file's history includes the paths it had before a rename.
  const queryPaths = useMemo(() => {
    if (!paths.length) return [];
    const former = (facets?.paths ?? []).filter((p) => p.renamedTo && paths.includes(p.renamedTo)).map((p) => p.path);
    return [...new Set([...paths, ...former])].sort();
  }, [paths, facets]);
  const filterKey = JSON.stringify([queryPaths, [...authors].sort((a, b) => a - b)]);
  const loading = list.key !== filterKey;

  // The file tree or the editor asked for a file's history.
  const [seenFocus, setSeenFocus] = useState(0);
  if (focus && focus.seq !== seenFocus) {
    setSeenFocus(focus.seq);
    setPaths(focus.paths);
    setAuthors([]);
    setOpenId(null);
  }

  // The first page and the people and files, whenever the filters change, this browser saves, or the refresh comes round; only while the tab is in front.
  const listRef = useRef(list);
  useEffect(() => {
    listRef.current = list;
  }, [list]);
  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    const [p, a] = JSON.parse(filterKey) as [string[], number[]];
    void (async () => {
      try {
        const [page, f] = await Promise.all([source.getHistory({ paths: p, authors: a, limit: PAGE }, ctrl.signal), source.getFacets(ctrl.signal)]);
        setFacets(f);
        setList((prev) => {
          if (prev.key !== filterKey || prev.status !== "ready") return { key: filterKey, entries: page.entries, next: page.nextCursor, status: "ready" };
          // Up to date at the head; the older pages already loaded stay.
          const oldest = page.entries.length ? page.entries[page.entries.length - 1].id : Infinity;
          const tail = prev.entries.filter((e) => e.id < oldest);
          return { ...prev, entries: [...page.entries, ...tail], next: tail.length ? prev.next : page.nextCursor };
        });
      } catch {
        if (ctrl.signal.aborted) return;
        setList((prev) => (prev.key !== filterKey || prev.status !== "ready" ? { key: filterKey, entries: [], next: null, status: "error" } : prev));
      }
    })();
    return () => ctrl.abort();
  }, [visible, filterKey, revision, tick, source]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [visible]);

  const loadMore = useCallback(async () => {
    const current = listRef.current;
    if (loadingMore || !current.next || current.status !== "ready" || current.key !== filterKey) return;
    setLoadingMore(true);
    try {
      const [p, a] = JSON.parse(filterKey) as [string[], number[]];
      const page = await source.getHistory({ paths: p, authors: a, cursor: current.next, limit: PAGE });
      setList((prev) => {
        if (prev.key !== filterKey) return prev;
        const ids = new Set(prev.entries.map((e) => e.id));
        return { ...prev, entries: [...prev.entries, ...page.entries.filter((e) => !ids.has(e.id))], next: page.nextCursor };
      });
    } catch {
      toast.error("Could not load older changes");
    } finally {
      setLoadingMore(false);
    }
  }, [filterKey, loadingMore, source]);

  const entries = useMemo(() => (loading ? [] : list.entries), [loading, list.entries]);
  const rows = useMemo(() => buildRows(entries, expanded, !loading && !!list.next), [entries, expanded, loading, list.next]);
  const opened = openId !== null ? (entries.find((e) => e.id === openId) ?? null) : null;

  const toggleSession = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const updateEntry = (id: number, patch: Partial<HistoryEntry>) => setList((prev) => ({ ...prev, entries: prev.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const statusOf = (path: string) => {
    const facet = facets?.paths.find((p) => p.path === path);
    if (filePaths.includes(path)) return { status: "current" as const, now: path };
    if (facet?.status === "renamed" && facet.renamedTo) return { status: "renamed" as const, now: facet.renamedTo };
    return { status: "deleted" as const, now: null };
  };

  const filtered = paths.length > 0 || authors.length > 0;

  return (
    <Nobody.Provider value={source.nobody}>
    <div data-history-panel="" className="flex h-full min-h-0 flex-col bg-panel">
      {opened ? (
        <VersionDetail
          key={opened.id}
          source={source}
          entry={opened}
          canEdit={canEdit}
          currentUserId={currentUserId}
          file={statusOf(opened.filePath)}
          onBack={() => {
            setOpenId(null);
            requestAnimationFrame(() => listFocus.current?.focus({ preventScroll: true }));
          }}
          onLabelled={(label) => updateEntry(opened.id, { label })}
          onOpenFile={onOpenFile}
          onRestored={(result) => {
            onRestored(result);
            setOpenId(null);
            setTick((t) => t + 1);
          }}
        />
      ) : (
        <>
          <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-1.5">
            <FilesFilter facets={facets} value={paths} onChange={setPaths} />
            {source.people !== false && <PeopleFilter facets={facets} value={authors} onChange={setAuthors} currentUserId={currentUserId} />}
          </div>
          <div className="relative min-h-0 flex-1">
            {loading && list.status !== "error" ? (
              <TimelineSkeleton />
            ) : list.status === "error" && (loading || !list.entries.length) ? (
              <Notice icon={<AlertCircle className="size-5" />} title="Could not load the history">
                <p className="type-base text-muted-foreground">Check the connection and try again.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setTick((t) => t + 1)}>
                  Try again
                </Button>
              </Notice>
            ) : !entries.length ? (
              filtered ? (
                <Notice icon={<History className="size-5" />} title="No changes match">
                  <p className="type-base text-muted-foreground">Nothing in the last 30 days for {paths.length && authors.length ? "these files and people" : paths.length ? (paths.length === 1 ? baseName(paths[0]) : "these files") : authors.length === 1 ? "this person" : "these people"}.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setPaths([]);
                      setAuthors([]);
                    }}
                  >
                    Clear the filters
                  </Button>
                </Notice>
              ) : (
                <Notice icon={<History className="size-5" />} title="No history yet">
                  <p className="type-base text-muted-foreground">Every save of every file is kept here for 30 days, with who changed it and when.</p>
                </Notice>
              )
            ) : (
              <Timeline
                rows={rows}
                focusRef={listFocus}
                activeKey={activeKey}
                onActiveChange={setActiveKey}
                onToggle={toggleSession}
                onOpen={(entry) => {
                  setActiveKey(`e${entry.id}`);
                  setOpenId(entry.id);
                }}
                onEndReached={() => void loadMore()}
                loadingMore={loadingMore}
                pathStatus={(path) => statusOf(path).status}
              />
            )}
          </div>
        </>
      )}
    </div>
    </Nobody.Provider>
  );
}

// ─── The timeline ───

interface TimelineProps {
  rows: HistoryRow[];
  focusRef: React.RefObject<HTMLDivElement | null>;
  activeKey: string | null;
  onActiveChange: (key: string) => void;
  onToggle: (sessionKey: string) => void;
  onOpen: (entry: HistoryEntry) => void;
  onEndReached: () => void;
  loadingMore: boolean;
  /** Whether a path is still a file, was renamed, or was deleted. */
  pathStatus: (path: string) => "current" | "renamed" | "deleted";
}

const isChoice = (row: HistoryRow) => row.kind === "session" || row.kind === "entry";

/**
 * The rows, drawn only where they are on screen (each kind of row has a fixed height), so thousands of versions scroll as lightly as ten. One tab stop: the arrow keys move through the rows, Enter opens a version or a sitting, Right and Left open and close a sitting, and Home and End go to the ends.
 */
function Timeline({ rows, focusRef, activeKey, onActiveChange, onToggle, onOpen, onEndReached, loadingMore, pathStatus }: TimelineProps) {
  // Where the list is scrolled to, in steps: a step is well inside the rows drawn beyond the edges, so the list draws again only when a step is crossed, not on every pixel of a scroll.
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(0);
  const offsets = useMemo(() => {
    const out: number[] = [];
    let y = 0;
    for (const row of rows) {
      out.push(y);
      y += rowHeight(row);
    }
    out.push(y);
    return out;
  }, [rows]);
  const total = offsets[offsets.length - 1];

  useLayoutEffect(() => {
    const el = focusRef.current;
    if (!el) return;
    const measure = () => {
      setTop(Math.floor(el.scrollTop / SCROLL_STEP) * SCROLL_STEP);
      setHeight(el.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [focusRef]);

  let first = 0;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] < top - OVERSCAN) lo = mid + 1;
    else {
      first = mid;
      hi = mid - 1;
    }
  }
  const shown: number[] = [];
  for (let i = first; i < rows.length && offsets[i] <= top + SCROLL_STEP + height + OVERSCAN; i++) shown.push(i);
  const reachesEnd = shown.length > 0 && shown[shown.length - 1] === rows.length - 1 && rows[rows.length - 1].kind === "more";

  useEffect(() => {
    if (reachesEnd && !loadingMore) onEndReached();
  }, [reachesEnd, loadingMore, onEndReached]);

  // One handler for every row, the same function on every render, so rows that did not change are not drawn again.
  const latest = useRef({ onActiveChange, onToggle, onOpen });
  useEffect(() => {
    latest.current = { onActiveChange, onToggle, onOpen };
  });
  const pick = useCallback((row: HistoryRow) => {
    latest.current.onActiveChange(row.key);
    if (row.kind === "session") latest.current.onToggle(row.session.key);
    else if (row.kind === "entry") latest.current.onOpen(row.entry);
  }, []);

  const choices = rows.map((r, i) => (isChoice(r) ? i : -1)).filter((i) => i >= 0);
  const activeIndex = rows.findIndex((r) => r.key === activeKey);

  const reveal = (index: number) => {
    const el = focusRef.current;
    if (!el) return;
    const top = offsets[index];
    const bottom = offsets[index + 1];
    if (top < el.scrollTop) el.scrollTop = Math.max(0, top - (rows[index - 1]?.kind === "day" ? ROW_HEIGHT.day : 0));
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  };
  const move = (index: number) => {
    onActiveChange(rows[index].key);
    reveal(index);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!choices.length) return;
    const at = choices.indexOf(activeIndex);
    const row = rows[activeIndex];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(choices[at < 0 ? 0 : Math.min(choices.length - 1, at + 1)]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(choices[at < 0 ? 0 : Math.max(0, at - 1)]);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(choices[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      move(choices[choices.length - 1]);
    } else if (e.key === "Enter" || e.key === " ") {
      if (!row) return;
      e.preventDefault();
      if (row.kind === "session") onToggle(row.session.key);
      else if (row.kind === "entry") onOpen(row.entry);
    } else if (e.key === "ArrowRight" && row?.kind === "session" && !row.expanded) {
      e.preventDefault();
      onToggle(row.session.key);
    } else if (e.key === "ArrowLeft" && row) {
      if (row.kind === "session" && row.expanded) {
        e.preventDefault();
        onToggle(row.session.key);
      } else if (row.kind === "entry" && row.nested) {
        e.preventDefault();
        for (let i = activeIndex - 1; i >= 0; i--) {
          const r = rows[i];
          if (r.kind === "session") {
            move(i);
            break;
          }
        }
      }
    }
  };

  return (
    <div
      ref={focusRef}
      tabIndex={0}
      role="tree"
      aria-label="Changes"
      aria-activedescendant={activeIndex >= 0 && isChoice(rows[activeIndex]) ? `history-row-${rows[activeIndex].key}` : undefined}
      className="group/timeline @container absolute inset-0 overflow-y-auto outline-none [scrollbar-gutter:stable]"
      onScroll={(e) => setTop(Math.floor(e.currentTarget.scrollTop / SCROLL_STEP) * SCROLL_STEP)}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (activeIndex < 0 && choices.length) onActiveChange(rows[choices[0]].key);
      }}
    >
      <div className="relative" style={{ height: total + 8 }}>
        {shown.map((i) => {
          const row = rows[i];
          return (
            <div key={row.key} className="absolute inset-x-0 px-1.5" style={{ top: offsets[i] + 4, height: rowHeight(row) }}>
              <Row row={row} active={row.key === activeKey} status={row.kind === "entry" ? pathStatus(row.entry.filePath) : "current"} onPick={pick} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const rowClass =
  "flex h-full w-full cursor-default gap-2.5 rounded-[var(--radius-item)] px-2.5 text-start transition-colors hover:bg-surface-hover/60 data-active:bg-surface group-focus-visible/timeline:data-active:ring-2 group-focus-visible/timeline:data-active:ring-inset group-focus-visible/timeline:data-active:ring-focus";

const Row = memo(function Row({ row, active, status, onPick }: { row: HistoryRow; active: boolean; status: "current" | "renamed" | "deleted"; onPick: (row: HistoryRow) => void }) {
  const onClick = () => onPick(row);
  if (row.kind === "day") {
    const words = dayLabel(row.date);
    return (
      <div role="presentation" className="flex h-full items-end px-2.5 pb-1.5 type-small font-medium text-muted-foreground">
        {words ? (
          <RelativeTime value={row.date} focusable={false}>
            {words}
          </RelativeTime>
        ) : (
          <RelativeTime value={row.date} format="date" focusable={false} />
        )}
      </div>
    );
  }
  if (row.kind === "more")
    return (
      <div role="presentation" className="flex h-full gap-2.5 px-2.5 py-2" aria-label="Loading older changes">
        <Skeleton className="mt-0.5 size-4 rounded-[var(--radius-inset)]" />
        <div className="flex flex-1 flex-col gap-2.5 pt-0.5">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    );
  if (row.kind === "session") return <SessionRow session={row.session} expanded={row.expanded} active={active} id={`history-row-${row.key}`} onClick={onClick} />;
  return <EntryRow entry={row.entry} nested={row.nested} active={active} id={`history-row-${row.key}`} onClick={onClick} status={status} />;
});

function SessionRow({ session, expanded, active, id, onClick }: { session: HistorySession; expanded: boolean; active: boolean; id: string; onClick: () => void }) {
  const nobody = useContext(Nobody);
  const [firstPath, ...others] = session.paths;
  return (
    <div id={id} role="treeitem" aria-level={1} aria-selected={active} aria-expanded={expanded} data-active={active || undefined} className={cn(rowClass, "py-2")} onClick={onClick}>
      <ChevronRight aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2 type-base">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{baseName(firstPath)}</span>
            {others.length > 0 && <span className="text-muted-foreground">{others.length === 1 ? `, ${baseName(others[0])}` : ` and ${others.length} other files`}</span>}
          </span>
          <Counts added={session.added} removed={session.removed} />
        </div>
        <div className="flex min-w-0 items-center gap-1.5 type-small text-muted-foreground">
          <Faces people={session.people} />
          <span className="min-w-0 truncate">{namesOf(session.people, nobody)}</span>
          <span aria-hidden>·</span>
          <RelativeTime value={session.latest} style="short" focusable={false} className="shrink-0" />
          {/* The count gives way first: in a narrow panel the chevron already says there is more under the row. */}
          <span aria-hidden className="hidden @[24rem]:inline">
            ·
          </span>
          <span className="sr-only shrink-0 tabular-nums @[24rem]:not-sr-only">{formatCount(session.entries.length, "version", "versions")}</span>
        </div>
      </div>
    </div>
  );
}

/** "Deleted" or "Renamed" after the name of a file that is no longer at that path. */
function PathStatus({ status }: { status: "current" | "renamed" | "deleted" }) {
  if (status === "current") return null;
  return <span className="shrink-0 type-small font-normal text-muted-foreground">{status === "deleted" ? "Deleted" : "Renamed"}</span>;
}

function EntryRow({ entry, nested, active, id, onClick, status }: { entry: HistoryEntry; nested: boolean; active: boolean; id: string; onClick: () => void; status: "current" | "renamed" | "deleted" }) {
  const nobody = useContext(Nobody);
  const people = peopleOf(entry);
  if (nested)
    return (
      <div id={id} role="treeitem" aria-level={2} aria-selected={active} data-active={active || undefined} className={cn(rowClass, "items-center ps-9")} onClick={onClick}>
        <FileTypeIcon filename={entry.filePath} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate type-base" title={entry.filePath}>
          {baseName(entry.filePath)}
        </span>
        <PathStatus status={status} />
        <Counts added={entry.linesAdded} removed={entry.linesRemoved} />
        <RelativeTime value={entry.updatedAt} format="time" focusable={false} className="shrink-0 type-small text-muted-foreground" />
      </div>
    );
  return (
    <div id={id} role="treeitem" aria-level={1} aria-selected={active} data-active={active || undefined} className={cn(rowClass, "py-2")} onClick={onClick}>
      <FileTypeIcon filename={entry.filePath} className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2 type-base">
          <span className="min-w-0 truncate font-medium" title={entry.filePath}>
            {baseName(entry.filePath)}
          </span>
          <PathStatus status={status} />
          <span className="flex-1" />
          <Counts added={entry.linesAdded} removed={entry.linesRemoved} />
        </div>
        <div className="flex min-w-0 items-center gap-1.5 type-small text-muted-foreground">
          {entry.restoredFromId !== null ? <RotateCcw aria-label="Restore" className="size-4 shrink-0" /> : <Faces people={people} />}
          <span className="min-w-0 truncate">{entry.restoredFromId !== null ? `${namesOf(people, nobody)} restored a version` : namesOf(people, nobody)}</span>
          <span aria-hidden>·</span>
          <RelativeTime value={entry.updatedAt} style="short" focusable={false} className="shrink-0" />
        </div>
        {entry.label && (
          <div className="flex min-w-0 items-center gap-1.5 type-small">
            <Tag aria-hidden className="size-4 shrink-0 text-hue-amber" />
            <span className="truncate">{entry.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── One version ───

interface VersionDetailProps {
  source: HistorySource;
  entry: HistoryEntry;
  canEdit: boolean;
  currentUserId: number | null;
  file: { status: "current" | "renamed" | "deleted"; now: string | null };
  onBack: () => void;
  onLabelled: (label: string) => void;
  onOpenFile: (path: string) => void;
  onRestored: (result: HistoryRestoreResult) => void;
}

/** A button whose short name is spelled out in its tooltip and to a screen reader. A disabled one still shows its tooltip, through the span around it. */
function ActionButton({ label, children, className, disabled, ...props }: { label: string; children: ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex min-w-0">
          <Button variant="outline" size="sm" aria-label={label} disabled={disabled} className={cn("w-full justify-start", className)} {...props}>
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function personLine(people: HistoryPerson[], currentUserId: number | null) {
  return people.map((p) => (p.id === currentUserId ? `${p.name} (you)` : p.name));
}

function VersionDetail({ source, entry, canEdit, currentUserId, file, onBack, onLabelled, onOpenFile, onRestored }: VersionDetailProps) {
  const nobody = useContext(Nobody);
  const [against, setAgainst] = useState<"previous" | "current">("previous");
  const [compared, setCompared] = useState<{ key: string; data: HistoryComparison | null; failed: boolean }>({ key: "", data: null, failed: false });
  const [labelling, setLabelling] = useState(false);
  const [draft, setDraft] = useState(entry.label ?? "");
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const back = useRef<HTMLButtonElement>(null);
  const key = `${entry.id}:${against}:${attempt}`;

  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    source
      .compare(entry.id, against, ctrl.signal)
      .then((data) => setCompared({ key, data, failed: false }))
      .catch(() => {
        if (!ctrl.signal.aborted) setCompared({ key, data: null, failed: true });
      });
    return () => ctrl.abort();
  }, [source, entry.id, against, key]);

  const ready = compared.key === key ? compared : null;
  const people = peopleOf(entry);
  const dir = entry.filePath.includes("/") ? entry.filePath.slice(0, entry.filePath.lastIndexOf("/")) : null;
  const saverApart = entry.savedBy && !people.some((p) => p.id === entry.savedBy!.id) ? entry.savedBy : null;
  const firstVersion = against === "previous" && ready?.data && !ready.data.previous;

  const saveLabel = async () => {
    const label = draft.trim();
    try {
      await source.label(entry.id, label);
      onLabelled(label);
      setLabelling(false);
    } catch {
      toast.error("Could not save the label");
    }
  };

  const restore = async () => {
    setRestoring(true);
    try {
      const result = await source.restore(entry.id);
      toast.success(`Restored ${baseName(result.filePath)}`, { description: result.created ? "The file was made again with this version's text." : "Its text before the restore is kept in the history." });
      onRestored(result);
    } catch {
      toast.error("Could not restore this version");
      setRestoring(false);
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !labelling && !confirming) {
          e.stopPropagation();
          onBack();
        }
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line ps-1.5 pe-3">
        <Button ref={back} variant="ghost" size="icon-sm" aria-label="Back to all changes" onClick={onBack}>
          <ArrowLeft className="rtl:-scale-x-100" />
        </Button>
        <FileTypeIcon filename={entry.filePath} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate type-base font-medium" title={entry.filePath}>
          {baseName(entry.filePath)}
        </span>
        <Counts added={entry.linesAdded} removed={entry.linesRemoved} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 border-b border-line px-3 py-3">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 type-base">
            {dir && (
              <>
                <dt className="type-small text-muted-foreground">Folder</dt>
                <dd className="truncate" title={entry.filePath}>
                  {dir}
                </dd>
              </>
            )}
            <dt className="type-small text-muted-foreground">Changed by</dt>
            <dd className="flex min-w-0 items-start gap-2">
              <span className="pt-px">
                <Faces people={people} />
              </span>
              <span className="min-w-0">{namesOf(personLine(people, currentUserId).map((name) => ({ name })), nobody)}</span>
            </dd>
            {saverApart && (
              <>
                <dt className="type-small text-muted-foreground">Saved by</dt>
                <dd className="truncate">{personLine([saverApart], currentUserId)[0]}</dd>
              </>
            )}
            <dt className="type-small text-muted-foreground">When</dt>
            <dd className="flex min-w-0 items-center gap-2">
              <RelativeTime value={entry.updatedAt} />
              <span className="type-small text-muted-foreground tabular-nums">Version {entry.version}</span>
            </dd>
            {file.status !== "current" && (
              <>
                <dt className="type-small text-muted-foreground">File</dt>
                <dd className="truncate text-muted-foreground">{file.status === "renamed" ? `Renamed to ${file.now}` : "Deleted"}</dd>
              </>
            )}
            {(entry.label || labelling) && (
              <>
                <dt className="type-small text-muted-foreground">Label</dt>
                <dd className="min-w-0">
                  {labelling ? (
                    <form
                      className="flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveLabel();
                      }}
                    >
                      <Input
                        autoFocus
                        aria-label="Label"
                        placeholder="Submitted to the journal"
                        value={draft}
                        maxLength={80}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.stopPropagation();
                            setLabelling(false);
                            setDraft(entry.label ?? "");
                          }
                        }}
                        className="min-w-0 flex-1"
                      />
                      <Button type="submit" variant="ghost" size="icon-sm" aria-label="Save the label">
                        <Check />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Cancel"
                        onClick={() => {
                          setLabelling(false);
                          setDraft(entry.label ?? "");
                        }}
                      >
                        <X />
                      </Button>
                    </form>
                  ) : (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Tag aria-hidden className="size-4 shrink-0 text-hue-amber" />
                      <span className="truncate">{entry.label}</span>
                    </span>
                  )}
                </dd>
              </>
            )}
          </dl>

          {/* Short names on the buttons so all four fit the narrowest panel in two rows; each says in full what it does to a screen reader and in its tooltip. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5">
            {canEdit && (
              <ActionButton label="Restore this version" onClick={() => setConfirming(true)} disabled={restoring}>
                <RotateCcw /> Restore
              </ActionButton>
            )}
            <ActionButton
              label={against === "current" ? "Show what this version changed" : "Compare with the file now"}
              aria-pressed={against === "current"}
              onClick={() => setAgainst((a) => (a === "current" ? "previous" : "current"))}
              className="aria-pressed:border-accent/60 aria-pressed:bg-accent/8"
            >
              <Columns2 /> Compare
            </ActionButton>
            {canEdit && !labelling && (
              <ActionButton label={entry.label ? "Edit the label" : "Label this version"} onClick={() => setLabelling(true)}>
                <Tag /> Label
              </ActionButton>
            )}
            <ActionButton label={file.status === "deleted" ? "The file has been deleted" : file.status === "renamed" ? `Open ${file.now}` : "Open the file"} disabled={!file.now} onClick={() => file.now && onOpenFile(file.now)}>
              <ExternalLink /> Open
            </ActionButton>
          </div>
        </div>

        <div className="flex min-h-10 items-center px-3 pt-2 type-small text-muted-foreground">
          {against === "current" ? (
            <span>From this version to the file now{ready?.data && ready.data.after === null ? " (deleted)" : ""}</span>
          ) : firstVersion ? (
            <span>The first saved version of this file</span>
          ) : ready?.data?.previous ? (
            <span>
              Changes since the version from <RelativeTime value={ready.data.previous.updatedAt} lowercase />
            </span>
          ) : (
            <span>Changes in this version</span>
          )}
        </div>
        {ready?.failed ? (
          <div className="flex flex-col items-start gap-2 px-3 py-3">
            <p className="type-base text-muted-foreground">Could not load this change.</p>
            <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : (
          <HistoryDiff
            path={entry.filePath}
            loading={!ready?.data}
            before={ready?.data?.before ?? ""}
            after={ready?.data?.after ?? ""}
            emptyMessage={against === "current" ? "The file is the same as this version now." : "This version changed nothing."}
          />
        )}
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {baseName(entry.filePath)} to this version?</AlertDialogTitle>
            <AlertDialogDescription>
              {file.status === "deleted"
                ? "The file was deleted. It is made again with this version's text."
                : file.status === "renamed"
                  ? `The file is now ${file.now}. This version comes back as ${entry.filePath}, beside it.`
                : "Everyone with the file open sees the change at once. Its text now is kept in the history first, so you can go back to it."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void restore()}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

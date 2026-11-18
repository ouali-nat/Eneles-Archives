"use client";

import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import type { CommentThread } from "@/lib/api";
import type { CommentTarget } from "@/components/editor/LatexEditor";
import type { Suggestion } from "@/lib/review/track-changes";
import type { CommentHue } from "@/lib/review/hues";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CheckCircle2, MessageSquare, X } from "@/components/icons";
import { FileTypeIcon } from "@/components/editor/FileTypeIcon";
import { CommentComposer } from "./review/CommentComposer";
import { HueSelect, PersonAvatar, QuoteBlock, type Person } from "./review/parts";
import { RelativeTime } from "@/components/ui/time";
import { ThreadView, type ThreadActions } from "./review/ThreadView";
import type { ReviewStore } from "./review/store";
import { cn } from "@/lib/utils";
import { TexLine } from "@/components/ui/tex-code";

export interface ReviewPanelProps extends ThreadActions {
  store: ReviewStore;
  path: string | null;
  threads: CommentThread[];
  suggestions: Suggestion[];
  /** Who can be mentioned: the project's owner and collaborators. */
  people: readonly Person[];
  userId: number | null;
  isOwner: boolean;
  canEdit: boolean;
  /** This file is bound to the live document, which accepting and rejecting suggestions need. */
  live: boolean;
  activeThreadId: number | null;
  /** Select a thread: its passage is selected in the editor, in its file. */
  onSelectThread: (id: number | null) => void;
  onCreateComment: (target: CommentTarget, content: string, hue: CommentHue) => Promise<CommentThread | null>;
  onSettle: (ids: string[] | "all", action: "accept" | "reject") => void;
  onRevealSuggestion: (s: Suggestion) => void;
  /** Open a file in the editor (a file's name over its threads is pressed). */
  onOpenFile?: (path: string) => void;
}

type Status = "open" | "resolved";
type View = "file" | "time" | "single";

const VIEWS: { value: View; label: string }[] = [
  { value: "file", label: "By file" },
  { value: "time", label: "By time" },
  { value: "single", label: "Individual" },
];

// The chosen view, remembered in this browser.
const VIEW_KEY = "texer-review-view";
const viewListeners = new Set<() => void>();
function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "time" || v === "single" ? v : "file";
  } catch {
    return "file";
  }
}
function writeView(view: View) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Storage refused (a private window): the choice lasts for this page.
  }
  viewListeners.forEach((l) => l());
}
function useReviewView(): [View, (view: View) => void] {
  const view = useSyncExternalStore(
    (l) => {
      viewListeners.add(l);
      return () => viewListeners.delete(l);
    },
    readView,
    () => "file" as View,
  );
  return [view, writeView];
}

/** When a thread last saw activity: its newest message, or its resolution if that came later. */
function lastActivity(t: CommentThread): number {
  let at = new Date(t.createdAt).getTime();
  for (const m of t.messages) at = Math.max(at, new Date(m.createdAt).getTime());
  if (t.resolvedAt) at = Math.max(at, new Date(t.resolvedAt).getTime());
  return at;
}

/** A suggested replacement is a deletion and an insertion at the same place by the same person; they are shown, accepted, and rejected together. */
interface Change {
  ids: string[];
  removed: Suggestion | null;
  added: Suggestion | null;
  first: Suggestion;
}

function pairSuggestions(list: Suggestion[]): Change[] {
  const sorted = [...list].sort((a, b) => a.from - b.from || (a.kind === "delete" ? -1 : 1));
  const out: Change[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const next = sorted[i + 1];
    if (s.kind === "delete" && next && next.kind === "insert" && next.authorId === s.authorId && (next.from === s.from || next.to === s.from)) {
      out.push({ ids: [s.id, next.id], removed: s, added: next, first: s });
      i++;
    } else {
      out.push({ ids: [s.id], removed: s.kind === "delete" ? s : null, added: s.kind === "insert" ? s : null, first: s });
    }
  }
  return out;
}

function clip(text: string, max = 240) {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/** The review panel: the suggested changes waiting for a decision, and the comment threads, open or resolved, seen by file (each file's threads together under its name), by time (newest activity first), or individually (one thread at a time, with Previous and Next). */
export function ReviewPanel(props: ReviewPanelProps) {
  const { store, path, threads, suggestions, canEdit, live, people: projectPeople } = props;
  const draft = useSyncExternalStore(store.subscribe, () => store.getSnapshot().draft, () => null);
  const panelDraft = draft?.where === "panel" ? draft : null;
  const [status, setStatus] = useState<Status>("open");
  const [view, setView] = useReviewView();

  // A thread picked elsewhere (its highlight in the editor) is brought into the list: the filter follows it.
  const [seenActive, setSeenActive] = useState(props.activeThreadId);
  if (seenActive !== props.activeThreadId) {
    setSeenActive(props.activeThreadId);
    const picked = threads.find((t) => t.id === props.activeThreadId);
    if (picked && picked.resolved !== (status === "resolved")) setStatus(picked.resolved ? "resolved" : "open");
  }

  // A comment being written here goes when the panel does.
  useEffect(
    () => () => {
      if (store.getSnapshot().draft?.where === "panel") store.endDraft();
    },
    [store],
  );

  // Everyone who can be mentioned or appears in a thread.
  const people = useMemo(() => {
    const seen = new Map<number, Person>();
    for (const p of projectPeople) seen.set(p.id, p);
    for (const t of threads) for (const m of t.messages) if (!seen.has(m.authorId)) seen.set(m.authorId, { id: m.authorId, name: m.author.name || "Someone", avatarUrl: m.author.avatarUrl });
    return [...seen.values()];
  }, [projectPeople, threads]);

  // In file order (by path, then where they sit in the file), which By file and One at a time share.
  const inOrder = useMemo(() => [...threads].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }) || a.offset - b.offset || a.id - b.id), [threads]);
  const open = inOrder.filter((t) => !t.resolved);
  const resolved = inOrder.filter((t) => t.resolved);
  const shown = status === "open" ? open : resolved;
  const byTime = useMemo(() => [...shown].sort((a, b) => lastActivity(b) - lastActivity(a)), [shown]);
  const groups = useMemo(() => {
    const out: { path: string; threads: CommentThread[] }[] = [];
    for (const t of shown) {
      const last = out[out.length - 1];
      if (last && last.path === t.path) last.threads.push(t);
      else out.push({ path: t.path, threads: [t] });
    }
    return out;
  }, [shown]);
  const changes = useMemo(() => pairSuggestions(suggestions), [suggestions]);
  const canSettle = canEdit && live;

  // One at a time: the selected thread when it is in the list, otherwise the first.
  const singleIndex = Math.max(0, shown.findIndex((t) => t.id === props.activeThreadId));
  const single = shown[singleIndex] ?? null;
  const step = (by: number) => {
    const next = shown[(singleIndex + by + shown.length) % shown.length];
    if (next) props.onSelectThread(next.id);
  };

  const actions: ThreadActions = {
    onReply: props.onReply,
    onResolve: props.onResolve,
    onDeleteThread: props.onDeleteThread,
    onEditMessage: props.onEditMessage,
    onDeleteMessage: props.onDeleteMessage,
    onSetColor: props.onSetColor,
  };
  const thread = (t: CommentThread, variant: "card" | "row", showPath = false) => (
    <ThreadView
      key={t.id}
      thread={t}
      people={people}
      userId={props.userId}
      isOwner={props.isOwner}
      canEdit={props.canEdit}
      variant={variant}
      active={props.activeThreadId === t.id}
      showPath={showPath}
      onSelect={() => props.onSelectThread(t.id)}
      {...actions}
    />
  );

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex shrink-0 flex-col gap-3 border-b border-line p-3">
        <div className="flex items-center gap-2">
          <Segmented<Status>
            value={status}
            onValueChange={setStatus}
            label="Show"
            className="min-w-0 flex-1 [&>*]:flex-1 [&>*]:whitespace-nowrap"
            options={[
              { value: "open", label: open.length ? `Open ${open.length}` : "Open" },
              { value: "resolved", label: resolved.length ? `Resolved ${resolved.length}` : "Resolved" },
            ]}
          />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0 gap-1 px-2.5" aria-label={`View: ${VIEWS.find((v) => v.value === view)?.label}`}>
                {VIEWS.find((v) => v.value === view)?.label}
                <ChevronDown className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuRadioGroup value={view} onValueChange={(v) => setView(v as View)}>
                {VIEWS.map((v) => (
                  <DropdownMenuRadioItem key={v.value} value={v.value} className="min-h-[var(--control-height)]">
                    {v.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Individual: Previous and Next stay in the header, so they never scroll away from the thread. */}
        {single && view === "single" && (
          <div className="flex min-h-[var(--control-height)] items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Previous thread" disabled={shown.length < 2} onClick={() => step(-1)}>
              <ChevronLeft />
            </Button>
            <p className="min-w-0 flex-1 text-center type-base font-medium tabular-nums" aria-live="polite">
              {singleIndex + 1} of {shown.length}
            </p>
            <Button variant="outline" size="icon" aria-label="Next thread" disabled={shown.length < 2} onClick={() => step(1)}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-3">
          {panelDraft && (
            <section aria-label="New comment" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-card p-3">
              <span className="min-w-0 truncate type-small text-muted-foreground">{path}</span>
              <QuoteBlock quote={panelDraft.target.quote} hue={panelDraft.hue} active />
              <CommentComposer
                people={people}
                autoFocus
                label="New comment"
                placeholder="Add a comment, @ to mention"
                submitLabel="Comment"
                onCancel={() => {
                  store.endDraft();
                  store.focusEditor();
                }}
                start={<HueSelect hue={panelDraft.hue} onChange={(hue) => store.setHue(hue)} />}
                onSubmit={async (text) => {
                  const created = await props.onCreateComment(panelDraft.target, text, panelDraft.hue);
                  if (!created) return false;
                  store.endDraft();
                  setStatus("open");
                  props.onSelectThread(created.id);
                  // The composer is gone with the draft; writing goes on where it was.
                  store.focusEditor();
                  return true;
                }}
              />
            </section>
          )}

          {status === "open" && changes.length > 0 && (
            <section aria-label="Suggested changes" className="flex flex-col gap-2">
              <div className="flex min-h-[var(--control-height)] items-center gap-2">
                <h3 className="flex-1 type-base font-semibold">
                  Suggested changes <span className="font-normal text-muted-foreground">{changes.length}</span>
                </h3>
                {canSettle && changes.length > 1 && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => props.onSettle("all", "reject")}>
                      Reject all
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => props.onSettle("all", "accept")}>
                      Accept all
                    </Button>
                  </>
                )}
              </div>
              <ul className="flex flex-col gap-2">
                {changes.map((c) => (
                  <li key={c.ids.join(":")}>
                    <ChangeCard change={c} people={people} canSettle={canSettle} onReveal={() => props.onRevealSuggestion(c.added ?? c.first)} onSettle={(action) => props.onSettle(c.ids, action)} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label={status === "open" ? "Open comments" : "Resolved comments"} className="flex flex-col gap-2">
            {status === "open" && changes.length > 0 && shown.length > 0 && (
              <h3 className="flex min-h-[var(--control-height)] items-center type-base font-semibold">
                Comments <span className="ms-1.5 font-normal text-muted-foreground">{shown.length}</span>
              </h3>
            )}
            {shown.length === 0 && !panelDraft && !(status === "open" && changes.length > 0) && (
              <div className="flex flex-col items-center gap-2 rounded-[var(--radius-surface)] border border-dashed border-line px-4 py-8 text-center">
                <span className="mb-1 grid size-11 place-items-center rounded-full bg-surface text-muted-foreground">
                  {status === "open" ? <MessageSquare className="size-5" /> : <CheckCircle2 className="size-5" />}
                </span>
                <p className="type-base font-medium">{status === "open" ? "No open comments" : "Nothing resolved yet"}</p>
                <p className="type-base text-muted-foreground">
                  {status === "open" ? "Select text in the editor, then press Comment beside it, or Ctrl+Alt+M." : "Resolved threads are kept here, and can be reopened."}
                </p>
              </div>
            )}

            {/* By file: each file's threads under its name, each thread a card of its own with room around it. */}
            {shown.length > 0 && view === "file" && (
              <div className="flex flex-col gap-6">
                {groups.map((g) => (
                  <section key={g.path} aria-label={g.path} className="flex flex-col gap-2">
                    <FileHeading path={g.path} count={g.threads.length} onOpen={() => props.onOpenFile?.(g.path)} />
                    <div className="flex flex-col gap-3">{g.threads.map((t) => thread(t, "card"))}</div>
                  </section>
                ))}
              </div>
            )}

            {shown.length > 0 && view === "time" && <div className="flex flex-col gap-3">{byTime.map((t) => thread(t, "card", true))}</div>}

            {single && view === "single" && (
              <div className="flex flex-col gap-2">
                <FileHeading path={single.path} onOpen={() => props.onOpenFile?.(single.path)} />
                {thread(single, "card")}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** A file's name over its threads: the file's icon and path (pressing it opens the file), how many threads it has at the end, and a button that goes to the file. */
function FileHeading({ path, count, onOpen }: { path: string; count?: number; onOpen: () => void }) {
  return (
    <div className="flex min-h-9 min-w-0 items-center gap-1">
      <button type="button" onClick={onOpen} title={`Open ${path}`} className="-mx-1.5 flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius)] px-1.5 text-start type-base font-medium text-foreground transition-colors hover:bg-surface-hover/60">
        <FileTypeIcon filename={path} className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{path}</span>
      </button>
      {count !== undefined && (
        <span className="shrink-0 px-1.5 type-small tabular-nums text-muted-foreground" aria-label={`${count} ${count === 1 ? "thread" : "threads"}`}>
          {count}
        </span>
      )}
      <Button variant="ghost" size="icon-sm" aria-label={`Go to ${path}`} title="Go to the file" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={onOpen}>
        <ArrowRight className="rtl:-scale-x-100" />
      </Button>
    </div>
  );
}

/** A suggested change: who suggested it and when, the text it takes out and the text it puts in, and Reject and Accept. Pressing it shows the change in the editor. */
function ChangeCard({ change, people, canSettle, onReveal, onSettle }: { change: Change; people: readonly Person[]; canSettle: boolean; onReveal: () => void; onSettle: (action: "accept" | "reject") => void }) {
  const s = change.first;
  const person = people.find((p) => p.id === s.authorId) ?? { id: s.authorId, name: s.authorName };
  const verb = change.removed && change.added ? "replaced" : change.added ? "added" : "deleted";
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-card p-3">
      <button type="button" onClick={onReveal} className="-m-1 flex min-w-0 flex-col gap-2 rounded-[var(--radius)] p-1 text-start hover:bg-surface-hover/50" aria-label={`Show this change by ${s.authorName} in the editor`}>
        <span className="flex min-h-8 min-w-0 items-center gap-2">
          <PersonAvatar person={person} size="sm" />
          <span className="min-w-0 truncate type-base">
            <span className="font-medium">{s.authorName}</span> <span className="text-muted-foreground">{verb}</span>
          </span>
          <span className="flex-1" />
          <RelativeTime value={s.time} className="shrink-0 type-small text-muted-foreground" />
        </span>
        <span className="flex flex-col overflow-hidden rounded-[var(--radius-inset)] border border-line font-mono type-small">
          {change.removed && (
            <span className="flex gap-2 bg-danger/8 px-2 py-1 text-foreground">
              <span aria-hidden className="select-none text-danger">−</span>
              <span className="sr-only">Removed: </span>
              <span className="min-w-0 break-words line-through decoration-danger/60">{clip(change.removed.text) ? <TexLine text={clip(change.removed.text)} /> : "(line break)"}</span>
            </span>
          )}
          {change.added && (
            <span className={cn("flex gap-2 bg-success/8 px-2 py-1 text-foreground", change.removed && "border-t border-line")}>
              <span aria-hidden className="select-none text-success">+</span>
              <span className="sr-only">Added: </span>
              <span className="min-w-0 break-words">{clip(change.added.text) ? <TexLine text={clip(change.added.text)} /> : "(line break)"}</span>
            </span>
          )}
        </span>
      </button>
      {canSettle && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => onSettle("reject")}>
            <X /> Reject
          </Button>
          <Button size="sm" variant="outline" onClick={() => onSettle("accept")}>
            <Check /> Accept
          </Button>
        </div>
      )}
    </div>
  );
}

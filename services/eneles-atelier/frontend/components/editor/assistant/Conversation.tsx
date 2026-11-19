"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { AlertCircle, BookOpen, Check, ChevronDown, Info, Loader2, Pencil, RotateCcw, X } from "@/components/icons";
import { FileTypeIcon } from "@/components/editor/FileTypeIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AssistantMarkdown, CopyAction } from "./AssistantMarkdown";
import { useLiveAnswer, usePacedText, type LiveAnswer } from "./reveal";
import type { AssistantActivity, AssistantTurn } from "./types";
import { modelName } from "@/lib/ai/model-name";

/** Axya's mark, in the theme's ink. */
export function AxyaMark({ size = 16, className }: { size?: number; className?: string }) {
  const { resolvedTheme } = useTheme();
  return <Image src={(resolvedTheme ?? "dark") === "dark" ? "/axya/DarkT.png" : "/axya/LightT.png"} alt="" width={size} height={size} className={cn("shrink-0", className)} />;
}

/** Axya's mark sized by a class like an icon (`size-4`), for lists of icons such as the settings tabs. */
export function AxyaIcon({ className }: { className?: string }) {
  return <AxyaMark size={16} className={cn("size-4 object-contain", className)} />;
}

/* ── Stick to the bottom ─────────────────────────────────────────────── */

/**
 * A scroll area that follows its content while the reader is at the bottom (an answer being written keeps its newest line in view) and lets go the moment they scroll up (a wheel or touch upwards, or a key that scrolls), showing "Jump to latest" until they are back. `follow` changes (a new question sent) bring it back to the bottom.
 */
export function StickyScroll({ children, follow, className }: { children: ReactNode; follow: unknown; className?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [away, setAway] = useState(false);

  const toBottom = (smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    stuck.current = true;
    setAway(false);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && document.documentElement.dataset.motion === "full" ? "smooth" : "auto" });
  };

  useLayoutEffect(() => {
    toBottom();
  }, [follow]);

  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const observer = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
      else setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 48);
    });
    observer.observe(inner);
    observer.observe(el);
    // The reader's own upward scroll lets go at once, before the next resize can pull the view back down.
    const release = () => {
      stuck.current = false;
    };
    const onWheel = (e: WheelEvent) => e.deltaY < 0 && release();
    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => (touchY = e.touches[0]?.clientY ?? 0);
    const onTouchMove = (e: TouchEvent) => (e.touches[0]?.clientY ?? 0) > touchY + 4 && release();
    const onKey = (e: KeyboardEvent) => ["PageUp", "ArrowUp", "Home"].includes(e.key) && e.target === el && release();
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className={cn("relative min-h-0", className)}>
      <div
        ref={scroller}
        className="scrollbar-modern h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
        onScroll={(e) => {
          const el = e.currentTarget;
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
          // Reaching the bottom again (by scrolling or Jump to latest) follows again.
          if (distance < 8) stuck.current = true;
          setAway(distance > 48);
        }}
      >
        <div ref={content}>{children}</div>
      </div>
      {away && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button type="button" variant="outline" size="sm" onClick={() => toBottom(true)} className="pointer-events-auto shadow-popover">
            <ChevronDown aria-hidden className="size-4" />
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Messages ────────────────────────────────────────────────────────── */

function UserMessage({ turn, onEdit }: { turn: AssistantTurn; onEdit?: () => void }) {
  const label = turn.label;
  const command = label ? /^(\/\w+)\s*([\s\S]*)$/.exec(label) : null;
  return (
    <div className="group/question flex flex-col items-end gap-1" data-from="user">
      <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-[var(--radius-card)] bg-surface px-3.5 py-2.5 type-base text-foreground">
        <span className="sr-only">You: </span>
        {command ? (
          <>
            <span className="font-mono font-medium">{command[1]}</span>
            {command[2] && <span> {command[2]}</span>}
          </>
        ) : (
          (label ?? turn.content)
        )}
      </div>
      {onEdit && (
        <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit and send again" title="Edit and send again" className="text-muted-foreground opacity-0 transition-opacity group-hover/question:opacity-100 focus-visible:opacity-100 hover:text-foreground [@media(hover:none)]:opacity-100">
          <Pencil aria-hidden className="size-4" />
        </Button>
      )}
    </div>
  );
}

/** What the answer read: project files open in the editor; reference papers open the references panel. */
function ReadChips({ paths, onOpenFile, onOpenReferences, knownPaths }: { paths: string[]; onOpenFile?: (path: string) => void; onOpenReferences?: () => void; knownPaths: ReadonlySet<string> }) {
  const [all, setAll] = useState(false);
  const LIMIT = 6;
  const shown = all ? paths : paths.slice(0, LIMIT);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="type-small text-muted-foreground">Read {paths.length === 1 ? "1 file" : `${paths.length} files`}</p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Files read">
        {shown.map((path) => {
          const reference = path.startsWith("references/");
          const name = path.slice(path.lastIndexOf("/") + 1);
          const clickable = reference ? !!onOpenReferences : !!onOpenFile && knownPaths.has(path);
          const inner = (
            <>
              {reference ? <BookOpen aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : <FileTypeIcon filename={path} className="size-4 shrink-0" />}
              <span className="min-w-0 truncate">{name}</span>
            </>
          );
          const chip = "inline-flex h-[var(--control-height)] max-w-56 items-center gap-1.5 rounded-[var(--radius)] border border-line bg-surface px-2.5 type-small text-foreground";
          return (
            <li key={path} className="min-w-0 max-w-full">
              {clickable ? (
                <button type="button" onClick={() => (reference ? onOpenReferences?.() : onOpenFile?.(path))} title={reference ? `Reference paper: ${path}` : `Open ${path}`} className={cn(chip, "transition-colors hover:bg-surface-hover")}>
                  {inner}
                </button>
              ) : (
                <span title={path} className={cn(chip, "text-muted-foreground")}>
                  {inner}
                </span>
              )}
            </li>
          );
        })}
        {!all && paths.length > LIMIT && (
          <li>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAll(true)} className="text-muted-foreground">
              {paths.length - LIMIT} more
            </Button>
          </li>
        )}
      </ul>
    </div>
  );
}

const TOOL_WORDS: Record<string, [running: string, done: string]> = {
  read_file: ["Reading", "Read"],
  replace_in_file: ["Editing", "Edited"],
  write_file: ["Writing", "Wrote"],
  edit_file: ["Writing", "Wrote"],
  delete_file: ["Deleting", "Deleted"],
};

/** The files the assistant reads and changes while it answers, one quiet line each. */
function ActivityList({ activities }: { activities: AssistantActivity[] }) {
  if (!activities.length) return null;
  return (
    <ul className="flex flex-col gap-0.5" aria-label="What Axya is doing">
      {activities.map((a) => {
        const words = TOOL_WORDS[a.tool] ?? ["Using", "Used"];
        const name = a.path ? a.path.slice(a.path.lastIndexOf("/") + 1) : null;
        return (
          <li key={a.id} className="flex min-h-7 items-center gap-2 type-small text-muted-foreground">
            {a.state === "running" ? <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" /> : a.state === "failed" ? <X aria-hidden className="size-4 shrink-0 text-warning" /> : <Check aria-hidden className="size-4 shrink-0" />}
            <span className="min-w-0 truncate">
              {a.state === "running" ? words[0] : words[1]}
              {name ? (
                <>
                  {" "}
                  <span className="font-mono text-foreground" title={a.path ?? undefined}>
                    {name}
                  </span>
                </>
              ) : a.state === "running" ? "…" : ""}
              {a.state === "failed" && " (did not work; Axya tried again)"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Notes({ notices, trimmed }: { notices?: string[]; trimmed?: { sent: number; total: number } | null }) {
  if (!notices?.length && !trimmed) return null;
  return (
    <ul className="flex flex-col gap-1">
      {trimmed && (
        <li className="flex items-start gap-2 type-small text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            Earlier messages were left out to fit this model&rsquo;s context: it saw the last {trimmed.sent} of {trimmed.total}.
          </span>
        </li>
      )}
      {notices?.map((n) => (
        <li key={n} className="flex items-start gap-2 type-small text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{n}</span>
        </li>
      ))}
    </ul>
  );
}

function AnswerHeader({ model, busy = false }: { model?: string; busy?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <AxyaMark size={16} className={cn(busy && "assistant-breathe")} />
      <span className="type-small font-medium text-foreground">Axya</span>
      {model && <span className="min-w-0 truncate type-small text-muted-foreground">{modelName(model)}</span>}
    </div>
  );
}

function AssistantMessage({
  turn,
  onRetry,
  onOpenFile,
  onOpenReferences,
  knownPaths,
  last,
}: {
  turn: AssistantTurn;
  onRetry?: () => void;
  onOpenFile?: (path: string) => void;
  onOpenReferences?: () => void;
  knownPaths: ReadonlySet<string>;
  last: boolean;
}) {
  return (
    <div className="group/answer flex flex-col gap-2.5" data-from="assistant">
      <AnswerHeader model={turn.model} />
      <span className="sr-only">Axya: </span>
      <Notes notices={turn.notices} trimmed={turn.trimmed} />
      {turn.content.trim() && <AssistantMarkdown text={turn.content} />}
      {turn.stopped && <p className="type-small text-muted-foreground">Stopped.</p>}
      {turn.error && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] border border-line bg-card px-3 py-2">
          <AlertCircle aria-hidden className="size-4 shrink-0 text-danger" />
          <p className="min-w-0 flex-1 type-base text-foreground">{turn.error.message}</p>
          {onRetry && last && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw aria-hidden className="size-4" />
              Try again
            </Button>
          )}
        </div>
      )}
      {turn.read && turn.read.length > 0 && <ReadChips paths={turn.read} onOpenFile={onOpenFile} onOpenReferences={onOpenReferences} knownPaths={knownPaths} />}
      {turn.content.trim() && (
        <div className="-ms-1.5 flex items-center gap-0.5 opacity-80 transition-opacity group-hover/answer:opacity-100 group-focus-within/answer:opacity-100">
          <CopyAction text={turn.content} label="Copy answer" />
          {onRetry && last && !turn.error && (
            <Button type="button" variant="ghost" size="icon-sm" onClick={onRetry} aria-label="Regenerate" title="Regenerate" className="text-muted-foreground hover:text-foreground">
              <RotateCcw aria-hidden className="size-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** The wait before the first word: Axya's mark and a shimmering line, with the seconds once it takes a while. */
function Waiting({ label }: { label: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const id = window.setInterval(() => setSeconds(Math.floor((performance.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <p className="flex items-center gap-2 type-base">
      <span className="assistant-shimmer">{label}</span>
      {seconds >= 3 && <span className="type-small tabular-nums text-muted-foreground">{seconds}s</span>}
    </p>
  );
}

/** The answer being written: what has arrived so far, released smoothly, with the files read and changed as it goes. */
function LiveMessage({ live, onCaughtUp }: { live: LiveAnswer; onCaughtUp: () => void }) {
  const snap = useLiveAnswer(live);
  const text = usePacedText(snap.text, !snap.done, onCaughtUp);
  const writing = !snap.done || text.length < snap.text.length;
  const running = snap.activities.find((a) => a.state === "running");
  return (
    <div className="flex flex-col gap-2.5" data-from="assistant" aria-busy={writing || undefined}>
      <AnswerHeader model={snap.meta ? `${snap.meta.model}` : undefined} busy={writing} />
      <Notes notices={snap.notices} trimmed={snap.meta?.trimmed} />
      <ActivityList activities={snap.activities} />
      {text ? <AssistantMarkdown text={text} live={writing} /> : !snap.done && <Waiting label={running ? "Working on your project" : snap.activities.length ? "Writing" : "Reading your project"} />}
      {/* The answer is announced once, whole, when it ends, not word by word. */}
      <p className="sr-only" role="status" aria-live="polite">
        {snap.done ? "Axya has answered." : ""}
      </p>
    </div>
  );
}

export interface ConversationProps {
  turns: AssistantTurn[];
  /** The question being answered and its answer as it is written; the committed turns it stands for (`hide`) are left out until it has caught up. */
  live: { question: AssistantTurn; answer: LiveAnswer; hide: number } | null;
  onLiveCaughtUp: () => void;
  /** Ask the last question again (Regenerate, or Try again after an error). */
  onRetry?: () => void;
  /** Put the last question back in the field to change and send again. */
  onEditLast?: () => void;
  onOpenFile?: (path: string) => void;
  onOpenReferences?: () => void;
  filePaths: readonly string[];
  /** After the messages: the proposed changes. */
  footer?: ReactNode;
}

/** The conversation: the person's questions on the right, Axya's answers across the column, the answer being written, and what comes after (the proposed changes). */
export function Conversation({ turns, live, onLiveCaughtUp, onRetry, onEditLast, onOpenFile, onOpenReferences, filePaths, footer }: ConversationProps) {
  const known = new Set(filePaths);
  const shown = live ? turns.slice(0, turns.length - live.hide) : turns;
  const lastAnswer = shown.length - 1;
  const lastQuestion = shown.map((t) => t.role).lastIndexOf("user");
  return (
    <ol className="flex flex-col gap-5" aria-label="Conversation">
      {shown.map((turn, i) => (
        <li key={i}>
          {turn.role === "user" ? (
            <UserMessage turn={turn} onEdit={!live && i === lastQuestion && onEditLast ? onEditLast : undefined} />
          ) : (
            <AssistantMessage turn={turn} last={i === lastAnswer && !live} onRetry={onRetry} onOpenFile={onOpenFile} onOpenReferences={onOpenReferences} knownPaths={known} />
          )}
        </li>
      ))}
      {live && (
        <>
          <li>
            <UserMessage turn={live.question} />
          </li>
          <li>
            <LiveMessage live={live.answer} onCaughtUp={onLiveCaughtUp} />
          </li>
        </>
      )}
      {footer && <li>{footer}</li>}
    </ol>
  );
}

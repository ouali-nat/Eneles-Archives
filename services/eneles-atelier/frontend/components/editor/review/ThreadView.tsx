"use client";

import { useEffect, useRef, useState } from "react";
import type { CommentMessage, CommentThread } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { Check, CheckCircle2, MoreHorizontal, Palette, Pencil, RotateCcw, Trash2 } from "@/components/icons";
import { CommentComposer } from "./CommentComposer";
import { HueRadioItems, HueValue, MessageBody, PersonAvatar, QuoteBlock, hueStyle, type Person } from "./parts";
import { RelativeTime } from "@/components/ui/time";
import { cn } from "@/lib/utils";
import { FileTypeIcon } from "@/components/editor/FileTypeIcon";

export interface ThreadActions {
  onReply: (threadId: number, content: string) => Promise<boolean>;
  onResolve: (threadId: number, resolved: boolean) => void;
  onDeleteThread: (threadId: number) => void;
  onEditMessage: (messageId: number, content: string) => Promise<boolean>;
  onDeleteMessage: (messageId: number) => void;
  onSetColor: (threadId: number, hue: string) => void;
}

export interface ThreadViewProps extends ThreadActions {
  thread: CommentThread;
  people: readonly Person[];
  userId: number | null;
  isOwner: boolean;
  canEdit: boolean;
  /** A card on its own, a row in a group of threads (the review panel lists a file's threads together, divided by lines), or the body of the popover over the text. */
  variant: "card" | "row" | "popover";
  active?: boolean;
  /** The file it is in, shown when the list spans files. */
  showPath?: boolean;
  autoFocusReply?: boolean;
  /** A press on the card (not on one of its controls). */
  onSelect?: () => void;
}

const personOf = (m: CommentMessage): Person => ({ id: m.author.id, name: m.author.name || "Someone", avatarUrl: m.author.avatarUrl });

/** One comment thread: the passage, the first comment, its replies, and a reply field, with Resolve or Reopen. The reader's own messages can be edited and deleted from their menu; the thread's menu changes its color, resolves it, and deletes it. */
export function ThreadView(props: ThreadViewProps) {
  const { thread: t, people, userId, variant, active } = props;
  const [editing, setEditing] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "thread" } | { kind: "message"; id: number } | null>(null);
  const ref = useRef<HTMLElement>(null);
  const canResolve = props.canEdit || t.createdById === userId;
  const canDelete = props.isOwner || t.createdById === userId;
  const [first, ...replies] = t.messages;
  const resolver = t.resolvedById ? (people.find((p) => p.id === t.resolvedById)?.name ?? t.messages.find((m) => m.authorId === t.resolvedById)?.author.name ?? null) : null;

  useEffect(() => {
    if (active && variant !== "popover") ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, variant]);

  const message = (m: CommentMessage, isFirst: boolean) => {
    const mine = m.authorId === userId;
    return (
      <li key={m.id} className="group/message flex min-w-0 flex-col gap-0.5">
        {/* The avatar has its own 24px column; the name and the text share one left edge after it (24px + 8px gap). */}
        <div className="flex min-h-8 min-w-0 items-center gap-2">
          <PersonAvatar person={personOf(m)} />
          <span className="min-w-0 truncate type-base font-medium text-foreground">{m.author.name || "Someone"}</span>
          <span className="flex shrink-0 items-center gap-1.5 type-small text-muted-foreground">
            <RelativeTime value={m.createdAt} absoluteAfterDays={7} />
            {m.editedAt && (
              <>
                <span aria-hidden>·</span>
                <RelativeTime value={m.editedAt}>Edited</RelativeTime>
              </>
            )}
          </span>
          <span className="flex-1" />
          {mine && editing !== m.id && !t.resolved && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={isFirst ? "Comment actions" : "Reply actions"}
                  className="-me-1 text-muted-foreground opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuItem onSelect={() => setEditing(m.id)}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                {!isFirst && (
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ kind: "message", id: m.id })}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="min-w-0 ps-8">
          {editing === m.id ? (
            <CommentComposer
              people={people}
              label="Edit comment"
              placeholder="Comment"
              submitLabel="Save"
              autoFocus
              initialValue={m.content}
              onSubmit={async (text) => {
                const ok = text === m.content || (await props.onEditMessage(m.id, text));
                if (ok) setEditing(null);
                return ok;
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <MessageBody text={m.content} people={people} />
          )}
        </div>
      </li>
    );
  };

  const resolveButton = canResolve ? (
    t.resolved ? (
      <Button type="button" variant="outline" size="sm" onClick={() => props.onResolve(t.id, false)}>
        <RotateCcw /> Reopen
      </Button>
    ) : (
      // Resolving is approving the thread: a green check, named for assistive technology and in its tooltip.
      <Button type="button" variant="success" size="icon" aria-label="Resolve" title="Resolve" onClick={() => props.onResolve(t.id, true)}>
        <Check />
      </Button>
    )
  ) : null;

  return (
    <article
      ref={ref}
      aria-label={`Comment by ${first?.author.name || "someone"}${replies.length ? `, ${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : ""}${t.resolved ? ", resolved" : ""}`}
      data-active={active || undefined}
      data-thread={t.id}
      style={hueStyle(t.color)}
      className={cn(
        "flex min-w-0 flex-col gap-3",
        variant === "card" &&
          "rounded-[var(--radius-card)] border border-line bg-card p-3 transition-[border-color,box-shadow] hover:border-[color:color-mix(in_oklch,var(--line),var(--foreground)_16%)] data-active:border-[color:color-mix(in_oklch,var(--thread-hue)_70%,var(--line))] data-active:shadow-[0_0_0_1px_color-mix(in_oklch,var(--thread-hue)_45%,transparent)]",
        variant === "card" && t.resolved && "bg-panel",
        variant === "row" &&
          "p-3 transition-[background-color,box-shadow] hover:bg-surface-hover/30 data-active:bg-[color-mix(in_oklch,var(--thread-hue)_6%,transparent)] data-active:shadow-[inset_3px_0_0_var(--thread-hue)]",
      )}
      onClick={(e) => {
        if (!props.onSelect) return;
        if ((e.target as HTMLElement).closest("button, textarea, input, a, [role=menuitem], [role=option]")) return;
        props.onSelect();
      }}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {props.showPath && (
            <span className="flex min-w-0 items-center gap-1.5 type-small text-muted-foreground">
              <FileTypeIcon filename={t.path} className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{t.path}</span>
            </span>
          )}
          <QuoteBlock quote={t.quote} hue={t.color} active={active} />
        </div>
        {(canResolve || canDelete) && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Thread actions" className="-me-1 -mt-0.5 text-muted-foreground">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {canResolve && (
                <DropdownMenuSub>
                  {/* The row's value sits at its end, beside the chevron, as a shortcut does in other rows. */}
                  <DropdownMenuSubTrigger className="[&>svg:last-child]:ms-0 [&>svg:last-child]:text-muted-foreground">
                    <Palette className="size-4 text-muted-foreground" />
                    <span>Color</span>
                    <HueValue hue={t.color} />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-44 p-1">
                    <HueRadioItems value={t.color} onChange={(hue) => props.onSetColor(t.id, hue)} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {canResolve && (
                <DropdownMenuItem onSelect={() => props.onResolve(t.id, !t.resolved)}>
                  {t.resolved ? <RotateCcw /> : <Check />} {t.resolved ? "Reopen" : "Resolve"}
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ kind: "thread" })}>
                    <Trash2 /> Delete thread
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {t.resolved && (
        <p className="flex items-center gap-2 type-small text-muted-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-success" />
          <span className="min-w-0">
            Resolved{resolver ? ` by ${resolver}` : ""}
            {t.resolvedAt && (
              <>
                {" · "}
                <RelativeTime value={t.resolvedAt} lowercase />
              </>
            )}
          </span>
        </p>
      )}

      <ol className="flex min-w-0 flex-col gap-3">
        {first && message(first, true)}
        {replies.map((m) => message(m, false))}
      </ol>

      <CommentComposer
        key={t.id}
        people={people}
        compact
        autoFocus={props.autoFocusReply}
        label="Reply"
        placeholder={t.resolved ? "Reply to reopen" : "Reply, @ to mention"}
        submitLabel="Reply"
        onSubmit={(text) => props.onReply(t.id, text)}
        idleEnd={resolveButton}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "thread" ? "Delete this thread?" : "Delete this reply?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "thread"
                ? `The comment${replies.length ? ` and its ${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : ""} will be removed for everyone. This cannot be undone.`
                : "The reply will be removed for everyone. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (confirm?.kind === "thread") props.onDeleteThread(t.id);
                else if (confirm?.kind === "message") props.onDeleteMessage(confirm.id);
                setConfirm(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

"use client";

import { ArrowLeft, MessageSquare, Plus, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/time";
import { cn, formatCount } from "@/lib/utils";
import type { AssistantConversation } from "./history";

/**
 * The assistant's saved conversations, most recently used first. A row is the conversation's title (its first question, the row's one button: Tab walks the titles, Enter opens one), and under it when it was last used and how many questions it holds; the conversation in use is marked. Delete sits at the row's end, shown on hover or focus. New conversation is at the top; Back returns to the conversation in use.
 */
export function HistoryList({
  conversations,
  currentId,
  busy = false,
  onOpen,
  onDelete,
  onNew,
  onBack,
  className,
}: {
  conversations: readonly AssistantConversation[];
  currentId: string | null;
  /** An answer is on its way: switching would send it to the wrong conversation, so opening waits. */
  busy?: boolean;
  onOpen: (id: string) => void;
  onDelete: (conversation: AssistantConversation) => void;
  onNew: () => void;
  onBack: () => void;
  className?: string;
}) {
  return (
    <section aria-label="Conversation history" className={cn("flex min-h-0 flex-col", className)}>
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line ps-1.5 pe-2">
        <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to the conversation" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden className="size-4" />
        </Button>
        <h2 className="min-w-0 flex-1 truncate type-base font-medium text-foreground">History</h2>
        <span className="shrink-0 type-small tabular-nums text-muted-foreground">{conversations.length > 0 && formatCount(conversations.length, "conversation", "conversations")}</span>
      </header>
      <div className="scrollbar-modern min-h-0 flex-1 overflow-y-auto p-2">
        <Button type="button" variant="outline" className="mb-2 w-full justify-start" onClick={onNew} disabled={busy}>
          <Plus aria-hidden /> New conversation
        </Button>
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <span className="mb-1 grid size-11 place-items-center rounded-full bg-surface text-muted-foreground">
              <MessageSquare className="size-5" />
            </span>
            <p className="type-base font-medium">No conversations yet</p>
            <p className="type-base text-muted-foreground">Conversations with Axya in this project are kept here, in this browser.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5" aria-label="Conversations">
            {conversations.map((c) => {
              const current = c.id === currentId;
              const questions = c.turns.filter((t) => t.role === "user").length;
              return (
                <li
                  key={c.id}
                  data-current={current || undefined}
                  className="group/conv relative flex min-h-14 items-center gap-2 rounded-[var(--radius-item)] ps-3 pe-1.5 transition-colors hover:bg-surface-hover/60 data-current:bg-surface-hover"
                >
                  <div className="flex min-w-0 flex-1 flex-col items-start py-2">
                    <button
                      type="button"
                      onClick={() => onOpen(c.id)}
                      disabled={busy && !current}
                      aria-current={current ? "true" : undefined}
                      className="max-w-full truncate rounded-[var(--radius-inset)] text-start type-base font-medium text-foreground outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {c.title}
                    </button>
                    <span className="flex min-w-0 items-center gap-1.5 type-small text-muted-foreground">
                      {current && <span className="shrink-0 font-medium text-foreground">Current</span>}
                      {current && <span aria-hidden>·</span>}
                      <span className="truncate">
                        Last used <RelativeTime value={c.updatedAt} lowercase absoluteAfterDays={30} className="relative z-[1]" />
                        {" · "}
                        {formatCount(questions, "question", "questions")}
                      </span>
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDelete(c)}
                    disabled={busy && current}
                    aria-label={`Delete "${c.title}"`}
                    className="relative z-[1] shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover/conv:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

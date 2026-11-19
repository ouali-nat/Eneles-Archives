"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Loader2, MessagesSquare, Send } from "@/components/icons";
import { MentionField } from "./review/CommentComposer";
import { MessageBody, PersonAvatar, type Person } from "./review/parts";
import { RelativeTime } from "@/components/ui/time";

/** Messages by one person within this long of each other read as one group under one name. */
const GROUP_MS = 5 * 60_000;

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(today) - start(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
}

/** The project chat: everyone the project is shared with, viewers included. Messages by one person close together are grouped under their name and picture, days are marked, and the field at the bottom sends with Enter. It fills its dock panel; the tab carries its name and its close button. */
export function ChatPanel({
  messages,
  hasMore,
  loading,
  userId,
  people = [],
  onLoadMore,
  onSend,
}: {
  messages: ChatMessage[];
  hasMore: boolean;
  loading: boolean;
  userId: number | null;
  /** Who can be mentioned. */
  people?: readonly Person[];
  onLoadMore: () => void;
  onSend: (content: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastId = messages[messages.length - 1]?.id;

  // Stay at the newest message unless the reader scrolled up to read.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    atBottom.current = true;
    if (await onSend(text)) setDraft("");
    setSending(false);
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3 py-3"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        aria-live="polite"
      >
        {hasMore && (
          <div className="mb-3 flex justify-center">
            <Button size="sm" variant="ghost" onClick={onLoadMore} disabled={loading}>
              {loading && <Loader2 className="animate-spin" />} Earlier messages
            </Button>
          </div>
        )}
        {loading && messages.length === 0 && (
          <p className="flex items-center gap-2 type-base text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Loading messages
          </p>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="mb-1 grid size-11 place-items-center rounded-full bg-surface text-muted-foreground">
              <MessagesSquare className="size-5" />
            </span>
            <p className="type-base font-medium">No messages yet</p>
            <p className="type-base text-muted-foreground">Messages here reach everyone this project is shared with.</p>
          </div>
        )}
        <ol className="flex flex-col">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const grouped = !newDay && prev.userId === m.userId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
            const mine = m.userId === userId;
            const name = m.user.name || "Someone";
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <li role="separator" className="my-2 flex items-center gap-3 type-small text-muted-foreground first:mt-0">
                    <span className="h-px flex-1 bg-line" />
                    {dayLabel(m.createdAt)}
                    <span className="h-px flex-1 bg-line" />
                  </li>
                )}
                <li className={grouped ? "mt-0.5" : "mt-3 first:mt-0"}>
                  {/* The avatar has its own 24px column; the name and the text share one left edge after it, as in a comment thread. A message that continues a group keeps the column empty and shows its clock time at the end of the line on hover. */}
                  <div className="group/chat -mx-1.5 flex gap-2 rounded-[var(--radius)] px-1.5 py-0.5 hover:bg-surface-hover/40">
                    <div className="w-6 shrink-0">{!grouped && <PersonAvatar person={{ id: m.user.id, name, avatarUrl: m.user.avatarUrl }} className="mt-1" />}</div>
                    <div className="min-w-0 flex-1">
                      {!grouped && (
                        <p className="flex min-h-8 min-w-0 items-center gap-2">
                          <span className="truncate type-base font-medium">{name}</span>
                          {mine && <span className="type-small text-muted-foreground">You</span>}
                          <RelativeTime value={m.createdAt} className="shrink-0 type-small text-muted-foreground" />
                        </p>
                      )}
                      <div className="flex min-w-0 items-start gap-2">
                        <MessageBody text={m.content} people={people} className="min-w-0 flex-1" />
                        {grouped && <RelativeTime value={m.createdAt} format="time" className="shrink-0 type-small leading-5 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/chat:opacity-100" />}
                      </div>
                    </div>
                  </div>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </div>

      <form
        className="flex shrink-0 items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <MentionField
          value={draft}
          onChange={setDraft}
          people={people}
          compact
          enterSends
          listSide="above"
          maxLength={2000}
          label="Message"
          placeholder="Message everyone in this project"
          onSubmit={() => void send()}
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={!draft.trim() || sending} aria-label="Send">
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { CommentThread } from "@/lib/api";
import type { CommentTarget, LatexEditorHandle } from "@/components/editor/LatexEditor";
import type { RangeGeometry } from "@/lib/review/comment-highlights";
import type { CommentHue } from "@/lib/review/hues";
import { Button } from "@/components/ui/button";
import { MessageSquare, PenLine, X } from "@/components/icons";
import { Textarea } from "@/components/ui/textarea";
import { CommentComposer } from "./CommentComposer";
import { HueSelect, QuoteBlock, hueStyle, type Person } from "./parts";
import { ThreadView, type ThreadActions } from "./ThreadView";
import type { ReviewStore } from "./store";

const noop = () => () => {};
const GAP = 8;
const EDGE = 8;

/** Layers that belong to the popover although they are drawn elsewhere: its menus, and the confirmation it opens. */
const OWN_LAYERS = "[data-radix-popper-content-wrapper], [role=alertdialog], [data-slot=alert-dialog-overlay], [data-mention-list]";

type Place = { x: number; y: number; shown: boolean; room?: number };

/** Where a card of `width` by `height` goes for a range: under it, or over it when there is no room under it and there is above, always inside the editor's visible box and never over the passage. When it fits on neither side it takes the roomier one and scrolls inside (`room` is its height then). */
function placeCard(g: RangeGeometry, width: number, height: number): Place {
  const { bounds, start, end } = g;
  const shown = end.bottom > bounds.top && start.top < bounds.bottom;
  const x = Math.max(bounds.left + EDGE, Math.min(start.left - 16, bounds.right - width - EDGE));
  const below = Math.max(0, bounds.bottom - EDGE - (end.bottom + GAP));
  const above = Math.max(0, start.top - GAP - (bounds.top + EDGE));
  if (height <= below || below >= above) return { x, y: end.bottom + GAP, shown, room: Math.max(below, 160) };
  const room = Math.min(height, above);
  return { x, y: start.top - GAP - room, shown, room: Math.max(above, 160) };
}

/** Where the "Comment" button goes for a selection: over its first line, or under its last when the first is at the top. */
function placeButton(g: RangeGeometry, width: number, height: number): Place {
  const { bounds, start, end } = g;
  const shown = end.bottom > bounds.top && start.top < bounds.bottom;
  const x = Math.max(bounds.left + EDGE, Math.min(start.left, bounds.right - width - EDGE));
  let y = start.top - GAP / 2 - height;
  if (y < bounds.top + 4) y = Math.min(end.bottom + GAP / 2, bounds.bottom - height - 4);
  return { x, y, shown };
}

/** Keeps an element on a range while it is open: every frame it reads where the range is and moves there, so it follows scrolling, edits, and resizing. */
function useFollow(element: RefObject<HTMLElement | null>, active: boolean, read: () => RangeGeometry | null, place: (g: RangeGeometry, w: number, h: number) => Place) {
  const readRef = useRef(read);
  const placeRef = useRef(place);
  useLayoutEffect(() => {
    readRef.current = read;
    placeRef.current = place;
  });
  useLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    const step = () => {
      const el = element.current;
      if (el) {
        const g = readRef.current();
        if (!g) {
          el.dataset.hidden = "";
        } else {
          // The natural height, before any limit the room put on it.
          const inner = el.firstElementChild as HTMLElement | null;
          const height = inner && inner.scrollHeight > inner.clientHeight ? inner.scrollHeight + (inner.offsetHeight - inner.clientHeight) : el.offsetHeight;
          const p = placeRef.current(g, el.offsetWidth, height);
          el.style.translate = `${Math.round(p.x)}px ${Math.round(p.y)}px`;
          if (p.room !== undefined) el.style.setProperty("--room", `${Math.round(p.room)}px`);
          if (p.shown) delete el.dataset.hidden;
          else el.dataset.hidden = "";
          el.dataset.placed = "";
        }
      }
      frame = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [active, element]);
}

export interface CommentLayerProps extends ThreadActions {
  store: ReviewStore;
  editor: RefObject<LatexEditorHandle | null>;
  /** The open file; a change closes what is open. */
  path: string | null;
  threads: CommentThread[];
  people: readonly Person[];
  userId: number | null;
  isOwner: boolean;
  canEdit: boolean;
  /** Brings the review panel to the front of its group if it is open, keeping keyboard focus where it is, and says whether it is now on screen: a new comment is then written there, not in a card over the text. */
  reviewToFront: () => boolean;
  /** The person can change this file and it is live, so "Suggest" can record a replacement for the others to accept or reject. */
  canSuggest: boolean;
  onCreate: (target: CommentTarget, content: string, hue: CommentHue) => Promise<CommentThread | null>;
}

/**
 * Comments and suggestions over the text: "Comment" and "Suggest" beside the editor's selection, and a card anchored to a passage that holds a new comment being written, a replacement being suggested, or a thread opened by clicking its highlight. The card sits under the passage (over it when there is no room), stays inside the editor, follows scrolling, and closes on Escape or a press outside it. It is drawn over the page, so it is never clipped by the editor's panel.
 */
export function CommentLayer(props: CommentLayerProps) {
  const { store, editor, path } = props;
  const draft = useSyncExternalStore(store.subscribe, () => store.getSnapshot().draft, () => null);
  const popoverId = useSyncExternalStore(store.subscribe, () => store.getSnapshot().popover, () => null);
  const hasSelection = useSyncExternalStore(store.subscribe, () => store.getSnapshot().selection, () => false);
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const [pointerDown, setPointerDown] = useState(false);
  const [nudging, setNudging] = useState(false);
  const draftText = useRef("");
  const card = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLDivElement>(null);

  // Another file: nothing that was open belongs to it.
  useEffect(() => () => store.reset(), [path, store]);

  const thread = popoverId !== null ? (props.threads.find((t) => t.id === popoverId) ?? null) : null;
  const popoverDraft = draft?.where === "popover" ? draft : null;
  const cardOpen = !!popoverDraft || !!thread;

  // A thread that is not in the list (just created and not yet arrived, or deleted by someone) draws no card; the card shows once the thread is there.

  // The selection button: shown for a selection made in the focused editor, once the pointer is up.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.(".cm-editor")) setPointerDown(true);
    };
    const up = () => setPointerDown(false);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
    };
  }, []);
  const buttonOpen = hasSelection && !pointerDown && !cardOpen && !(draft && draft.where === "panel");

  const readCard = () => editor.current?.commentGeometry(popoverDraft ? "draft" : (popoverId ?? -1)) ?? null;
  const readSelection = () => editor.current?.commentGeometry("selection") ?? null;
  useFollow(card, cardOpen, readCard, placeCard);
  useFollow(button, buttonOpen, readSelection, placeButton);

  const close = useCallback(() => {
    draftText.current = "";
    store.closePopover();
  }, [store]);

  // Escape closes the card (a menu or dialog open from it takes the Escape first); a press outside closes it, unless a new comment has text in it, which asks for Cancel instead.
  useEffect(() => {
    if (!cardOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(OWN_LAYERS)) return;
      e.preventDefault();
      e.stopPropagation();
      const wasDraft = !!popoverDraft;
      close();
      if (wasDraft || card.current?.contains(document.activeElement)) editor.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || card.current?.contains(target) || target.closest?.(OWN_LAYERS)) return;
      if (popoverDraft && draftText.current.trim()) {
        setNudging(true);
        return;
      }
      close();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [cardOpen, popoverDraft, close, editor]);

  const startFromSelection = () => {
    store.compose(props.reviewToFront() ? "panel" : "popover");
  };
  const suggestFromSelection = () => {
    store.compose("popover", "suggest");
  };

  if (!mounted) return null;

  return createPortal(
    <>
      {buttonOpen && (
        <div ref={button} className="comment-float" data-hidden="">
          {/* One plate for both, so they read as the two things to do with a selection. The pointer never takes the focus from the editor, or the selection would go. */}
          <div role="toolbar" aria-label="Selection" className="flex items-center gap-0.5 rounded-[var(--radius-popover)] border border-line bg-panel p-0.5 shadow-popover" onPointerDown={(e) => e.preventDefault()}>
            <Button variant="ghost" size="sm" onClick={startFromSelection} title="Comment on the selection (Ctrl+Alt+M)">
              <MessageSquare /> Comment
            </Button>
            {props.canSuggest && (
              <Button variant="ghost" size="sm" onClick={suggestFromSelection} title="Suggest a replacement for the others to accept or reject">
                <PenLine /> Suggest
              </Button>
            )}
          </div>
        </div>
      )}
      {cardOpen && (
        <div
          ref={card}
          role="dialog"
          aria-label={popoverDraft ? (popoverDraft.kind === "suggest" ? "Suggest a change" : "New comment") : "Comment thread"}
          className="comment-float w-[min(360px,calc(100vw-16px))]"
          data-hidden=""
        >
          <div
            data-nudge={nudging || undefined}
            onAnimationEnd={() => setNudging(false)}
            className="comment-card max-h-[min(32rem,var(--room,70vh))] overflow-y-auto rounded-[var(--radius-card)] border border-line bg-panel p-3 shadow-popover"
          >
            {popoverDraft?.kind === "suggest" ? (
              <NewSuggestion
                original={editor.current?.getDraftText() ?? popoverDraft.target.quote}
                onText={(text) => (draftText.current = text)}
                onCancel={() => {
                  close();
                  editor.current?.focus();
                }}
                onSubmit={(text) => {
                  const done = editor.current?.suggestReplacement(text) ?? false;
                  if (!done) return false;
                  close();
                  editor.current?.focus();
                  return true;
                }}
              />
            ) : popoverDraft ? (
              <NewComment
                draft={popoverDraft}
                people={props.people}
                onHue={(hue) => store.setHue(hue)}
                onText={(text) => (draftText.current = text)}
                onCancel={() => {
                  close();
                  editor.current?.focus();
                }}
                onSubmit={async (text) => {
                  const created = await props.onCreate(popoverDraft.target, text, popoverDraft.hue);
                  if (!created) return false;
                  draftText.current = "";
                  store.openThread(created.id);
                  return true;
                }}
              />
            ) : thread ? (
              <div className="relative">
                <ThreadView
                  thread={thread}
                  people={props.people}
                  userId={props.userId}
                  isOwner={props.isOwner}
                  canEdit={props.canEdit}
                  variant="popover"
                  active
                  onReply={props.onReply}
                  onResolve={(id, resolved) => {
                    props.onResolve(id, resolved);
                    if (resolved) close();
                  }}
                  onDeleteThread={(id) => {
                    props.onDeleteThread(id);
                    close();
                  }}
                  onEditMessage={props.onEditMessage}
                  onDeleteMessage={props.onDeleteMessage}
                  onSetColor={props.onSetColor}
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}

/** The card's form for a new comment: the passage, a focused field, the color, Cancel, and Comment. */
function NewComment({
  draft,
  people,
  onHue,
  onText,
  onCancel,
  onSubmit,
}: {
  draft: { target: CommentTarget; hue: CommentHue };
  people: readonly Person[];
  onHue: (hue: CommentHue) => void;
  onText: (text: string) => void;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<boolean>;
}) {
  return (
    <div className="flex flex-col gap-3" style={hueStyle(draft.hue)}>
      <div className="flex items-start gap-2">
        <QuoteBlock quote={draft.target.quote} hue={draft.hue} active className="min-w-0 flex-1" />
        <Button variant="ghost" size="icon-sm" aria-label="Close" className="-me-1 -mt-0.5 text-muted-foreground" onClick={onCancel}>
          <X />
        </Button>
      </div>
      <CommentComposer
        people={people}
        autoFocus
        label="New comment"
        placeholder="Add a comment, @ to mention"
        submitLabel="Comment"
        onSubmit={onSubmit}
        onCancel={onCancel}
        onDraftChange={onText}
        start={<HueSelect hue={draft.hue} onChange={onHue} />}
      />
    </div>
  );
}

/** The card's form for a suggested change: the passage in a field to rewrite, Cancel, and Suggest. What is suggested shows in the text, marked, until someone accepts or rejects it in Review. */
function NewSuggestion({ original, onText, onCancel, onSubmit }: { original: string; /** The rewritten text while it differs from the passage, "" while it does not: a press outside the card keeps a card that has work in it. */ onText: (text: string) => void; onCancel: () => void; onSubmit: (text: string) => boolean }) {
  const [text, setText] = useState(original);
  const [failed, setFailed] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const changed = text !== original;
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(0, el.value.length);
  }, []);
  const submit = () => {
    if (!changed) return;
    setFailed(!onSubmit(text));
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 type-base font-medium text-foreground">Suggest a change</p>
        <Button variant="ghost" size="icon-sm" aria-label="Close" className="-me-1 text-muted-foreground" onClick={onCancel}>
          <X />
        </Button>
      </div>
      <Textarea
        ref={field}
        aria-label="Replacement text"
        spellCheck={false}
        value={text}
        rows={Math.min(8, Math.max(2, text.split("\n").length))}
        className="max-h-56 min-h-[4.5rem] resize-none font-mono type-base"
        onChange={(e) => {
          setText(e.target.value);
          setFailed(false);
          onText(e.target.value === original ? "" : e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <p className={failed ? "type-small text-danger" : "type-small text-muted-foreground"}>{failed ? "This file is not connected right now, so the suggestion could not be recorded. Try again in a moment." : "Rewrite the passage. Your change is marked in the text until someone accepts or rejects it in Review."}</p>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!changed} onClick={submit} title="Suggest (Ctrl+Enter)">
          Suggest
        </Button>
      </div>
    </div>
  );
}

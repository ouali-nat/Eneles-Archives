"use client";

import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "@/components/icons";
import { PersonAvatar, type Person } from "./parts";
import { cn } from "@/lib/utils";

/** What @ is followed by at the caret, when a mention is being typed. */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[\s(])@([\p{L}\p{N}._-]*(?: [\p{L}\p{N}._-]*)?)$/u.exec(before);
  if (!match) return null;
  return { start: caret - match[2].length - 1, query: match[2] };
}

export interface MentionFieldHandle {
  focus: () => void;
}

/** A text field where @ lists the people who can be mentioned: Up and Down move, Enter or Tab takes one, Escape closes the list. A taken person leaves "@Name " in the text. */
export const MentionField = forwardRef<
  MentionFieldHandle,
  {
    value: string;
    onChange: (value: string) => void;
    people: readonly Person[];
    placeholder?: string;
    label: string;
    autoFocus?: boolean;
    /** One row until focused or filled. */
    compact?: boolean;
    maxLength?: number;
    onSubmit: () => void;
    onEscape?: () => void;
    onFocus?: () => void;
    onBlur?: (event: React.FocusEvent<HTMLTextAreaElement>) => void;
    /** Enter alone sends (the chat); otherwise Mod+Enter does. */
    enterSends?: boolean;
    /** Where the list of people opens; by default under the field, or over it when the field is near the bottom of what scrolls it. */
    listSide?: "below" | "above";
    className?: string;
  }
>(function MentionField({ value, onChange, people, placeholder, label, autoFocus, compact, maxLength = 5000, onSubmit, onEscape, onFocus, onBlur, enterSends, listSide, className }, ref) {
  const area = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [roomSide, setRoomSide] = useState<"below" | "above">("below");
  const side = listSide ?? roomSide;
  /** The list needs about 240px; it opens over the field when there is less than that under it and more over it. */
  const measureRoom = (el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    const scroller = el.closest(".overflow-y-auto, .overflow-auto");
    const frame = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    setRoomSide(frame.bottom - box.bottom < 240 && box.top - frame.top > frame.bottom - box.bottom ? "above" : "below");
  };
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }), []);

  const mention = mentionQuery(value, caret);
  const options = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return people
      .filter((p) => {
        const name = p.name.toLowerCase();
        return name.startsWith(q) || name.split(/\s+/).some((word) => word.startsWith(q));
      })
      .slice(0, 6);
  }, [mention, people]);
  const open = !!mention && options.length > 0 && dismissedAt !== mention.start;
  const active = Math.min(highlight, Math.max(options.length - 1, 0));

  const take = (person: Person) => {
    if (!mention) return;
    const insert = `@${person.name} `;
    const next = value.slice(0, mention.start) + insert + value.slice(caret);
    onChange(next);
    const at = mention.start + insert.length;
    requestAnimationFrame(() => {
      area.current?.setSelectionRange(at, at);
      setCaret(at);
    });
    setHighlight(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlight((active + step + options.length) % options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        take(options[active]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissedAt(mention!.start);
        return;
      }
    }
    if (event.key === "Enter" && (enterSends ? !event.shiftKey : event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
      return;
    }
    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    }
  };

  return (
    <div className={cn("relative min-w-0", className)}>
      <Textarea
        ref={area}
        value={value}
        rows={1}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        role={open ? "combobox" : undefined}
        aria-expanded={open || undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        className={cn("block resize-none py-[7px] leading-5", compact ? "min-h-[var(--control-height)]" : "min-h-[5.25rem]", "max-h-60")}
        onChange={(e) => {
          measureRoom(e.target);
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="People"
          data-mention-list=""
          className={cn("absolute inset-x-0 z-20 rounded-[var(--radius-popover)]", side === "below" ? "top-full mt-1" : "bottom-full mb-1", " border border-line bg-panel/95 p-1 shadow-popover backdrop-blur-md")}
        >
          {options.map((person, i) => (
            <li
              key={person.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="flex min-h-[var(--control-height)] cursor-default items-center gap-2 rounded-[var(--radius-item)] px-2 type-base aria-selected:bg-surface-hover"
              onPointerDown={(e) => {
                e.preventDefault();
                take(person);
              }}
              onPointerMove={() => setHighlight(i)}
            >
              <PersonAvatar person={person} size="sm" />
              <span className="truncate">{person.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

/**
 * Writing a comment or a reply. Compact, it is one field of the standard height until it is taken up, with `idleEnd` (a Resolve button) beside it; taken up, it grows and its Cancel and send buttons open beneath it. Mod+Enter sends; Escape cancels.
 */
export function CommentComposer({
  people,
  placeholder,
  label,
  submitLabel,
  compact = false,
  autoFocus = false,
  initialValue = "",
  onSubmit,
  onCancel,
  onDraftChange,
  start,
  idleEnd,
  className,
}: {
  people: readonly Person[];
  placeholder: string;
  label: string;
  submitLabel: string;
  compact?: boolean;
  autoFocus?: boolean;
  initialValue?: string;
  onSubmit: (text: string) => Promise<boolean>;
  /** Without it, Cancel only empties and folds the field. */
  onCancel?: () => void;
  onDraftChange?: (text: string) => void;
  /** Controls at the start of the action row (the color button). */
  start?: ReactNode;
  /** Shown beside the folded field (Resolve). */
  idleEnd?: ReactNode;
  className?: string;
}) {
  const [value, setValueState] = useState(initialValue);
  const [focused, setFocused] = useState(autoFocus);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const field = useRef<MentionFieldHandle>(null);
  const setValue = (text: string) => {
    setValueState(text);
    onDraftChange?.(text);
  };
  const expanded = !compact || focused || value.trim() !== "";

  const submit = async () => {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    const ok = await onSubmit(text);
    setBusy(false);
    if (ok) {
      setValue("");
      if (compact) {
        setFocused(false);
        (document.activeElement as HTMLElement | null)?.blur();
      }
    }
  };
  const cancel = () => {
    setValue(initialValue);
    setFocused(false);
    if (onCancel) onCancel();
    else (document.activeElement as HTMLElement | null)?.blur();
  };
  // The action buttons keep focus in the field when pressed, so the composer does not fold under the pointer.
  const keep = (event: React.PointerEvent) => {
    if (event.button === 0) event.preventDefault();
  };

  return (
    <form
      ref={form}
      className={cn("flex min-w-0 flex-col gap-2", className)}
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex min-w-0 items-start gap-2">
        <MentionField
          ref={field}
          value={value}
          onChange={setValue}
          people={people}
          placeholder={placeholder}
          label={label}
          autoFocus={autoFocus}
          compact={!expanded}
          onSubmit={() => void submit()}
          onEscape={cancel}
          // Taken up while the field has focus; an empty field folds again when focus leaves it (for Resolve beside it, say).
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.value.trim()) setFocused(false);
          }}
          className="flex-1"
        />
        {!expanded && idleEnd}
      </div>
      {expanded && (
        <div className="flex items-center gap-2">
          {start}
          <span className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onPointerDown={keep} onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" onPointerDown={keep} disabled={!value.trim() || busy}>
            {busy && <Loader2 className="animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}

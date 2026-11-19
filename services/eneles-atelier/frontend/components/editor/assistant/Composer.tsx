"use client";

import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { ArrowUp, Check, Plus, Square, Type } from "@/components/icons";
import { FileTypeIcon } from "@/components/editor/FileTypeIcon";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DictationBar, VoiceButton } from "@/components/ui/voice-button";
import { cancelDictation, dismissDictationError, useDictationState, type DictationOptions } from "@/hooks/useSpeechRecognition";
import { cn } from "@/lib/utils";
import { filterCommands, filterPaths, type CommandContext, type SlashCommand } from "./commands";
import { selectionLabel, type EditorSelection } from "./editor-selection";

/* Which list is open over the field: commands after a leading "/", project files after an "@". `from` is where the trigger starts in the text. */
type Trigger = { kind: "command"; query: string; from: number } | { kind: "file"; query: string; from: number };

function findTrigger(value: string, caret: number): Trigger | null {
  const before = value.slice(0, caret);
  const command = /^\/([\w-]*)$/.exec(before);
  if (command) return { kind: "command", query: command[1], from: 0 };
  const file = /(^|\s)@([^\s@]*)$/.exec(before);
  if (file) return { kind: "file", query: file[2], from: before.length - file[2].length - 1 };
  return null;
}

/** What a host can do to the field: put text at the caret (opening the list a "/" or "@" calls for), and focus it. */
export interface ComposerApi {
  insert: (text: string) => void;
  focus: () => void;
}

export type ComposerBusy = "idle" | "pending" | "revealing";

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** The text to send (a command or a question). */
  onSubmit: (text: string) => void;
  /** Stops the answer being waited for, or shows the rest of the one being revealed. */
  onStop: () => void;
  busy: ComposerBusy;
  /** Nothing can be sent (no model to answer, or offline). */
  disabled?: boolean;
  placeholder?: string;
  commandContext: CommandContext;
  /** Runs a command chosen from the list that needs no more words. */
  onCommand: (command: SlashCommand) => void;
  filePaths: readonly string[];
  activeFilePath?: string;
  /** Whether the open file goes with the message; the person can leave it out. */
  includeFile?: boolean;
  onIncludeFileChange?: (include: boolean) => void;
  selection: EditorSelection | null;
  includeSelection: boolean;
  onIncludeSelectionChange: (include: boolean) => void;
  /** Starts or stops dictation into this field. Absent, there is no microphone. */
  onDictation?: (options: DictationOptions) => void;
  /** The model picker, beside the send button. */
  model?: ReactNode;
  /** Arrow Up in an empty field puts the last question back to change it. */
  onEditLast?: () => void;
  /** One row: the field between `leading` and the buttons, for the collapsed floating bar. */
  compact?: boolean;
  /** Before the field in the compact form, or at the start of the row of buttons. */
  leading?: ReactNode;
  /** After the send button in the compact form; at the start of the row of buttons otherwise, after `leading`. */
  trailing?: ReactNode;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  apiRef?: Ref<ComposerApi>;
  className?: string;
}

/**
 * The assistant's composer: a field that grows with what is typed up to a limit, Enter to send and Shift+Enter for a new line, a send button that becomes Stop while an answer is awaited or revealed, and the microphone. A "/" at the start opens the list of commands and an "@" opens the project's files, each filtered as one types, moved through with the arrow keys, taken with Enter or Tab, and closed with Escape; the field keeps focus throughout and names the highlighted row as its active descendant. Above the field, the context that goes with a question: the open file, and the editor's selection, which can be left out. While a dictation into this field is under way its row of buttons gives way to the recording bar.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  disabled = false,
  placeholder = "Ask Axya, or type / for commands",
  commandContext,
  onCommand,
  filePaths,
  activeFilePath,
  includeFile = true,
  onIncludeFileChange,
  selection,
  includeSelection,
  onIncludeSelectionChange,
  onDictation,
  model,
  onEditLast,
  compact = false,
  leading,
  trailing,
  textareaRef,
  apiRef,
  className,
}: ComposerProps) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const field = textareaRef ?? ownRef;
  const listId = useId();
  const dictation = useDictationState();
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  });

  // The field grows with its text up to a limit, then scrolls.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, compact, field]);

  const commands = trigger?.kind === "command" ? filterCommands(trigger.query) : [];
  const files = trigger?.kind === "file" ? filterPaths(filePaths, trigger.query) : [];
  const key = trigger ? `${trigger.kind}:${trigger.from}` : null;
  const listOpen = !!trigger && key !== dismissed && (trigger.kind === "command" ? commands.length > 0 : files.length > 0);
  const count = trigger?.kind === "command" ? commands.length : files.length;
  const current = Math.min(active, Math.max(0, count - 1));

  const sync = (text: string, caret: number) => {
    const next = findTrigger(text, caret);
    if (next?.kind !== trigger?.kind || next?.query !== trigger?.query) setActive(0);
    if (!next) setDismissed(null);
    setTrigger(next);
  };

  const place = (text: string, caret: number) => {
    onChange(text);
    requestAnimationFrame(() => {
      const el = field.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      sync(text, caret);
    });
  };

  const insertAtCaret = (text: string) => {
    const el = field.current;
    const now = latest.current;
    const at = el ? el.selectionStart : now.length;
    const end = el ? el.selectionEnd : now.length;
    const before = now.slice(0, at);
    const piece = text === "@" && before && !/\s$/.test(before) ? ` ${text}` : text;
    place(before + piece + now.slice(end), at + piece.length);
  };

  useImperativeHandle(apiRef, () => ({
    insert: insertAtCaret,
    focus() {
      field.current?.focus();
    },
  }));

  const choose = (index: number) => {
    if (!trigger) return;
    if (trigger.kind === "command") {
      const command = commands[index];
      if (!command) return;
      // A command that cannot run now says why (the host shows it) and leaves the text as it is.
      if (command.unavailable?.(commandContext)) {
        setDismissed(key);
        onCommand(command);
        return;
      }
      if (command.takesInput) {
        const text = `/${command.name} `;
        place(text, text.length);
      } else {
        setTrigger(null);
        onChange("");
        onCommand(command);
      }
      return;
    }
    const path = files[index];
    if (!path) return;
    const caret = field.current?.selectionStart ?? value.length;
    const text = `${value.slice(0, trigger.from)}@${path} ${value.slice(caret)}`;
    place(text, trigger.from + path.length + 2);
  };

  const send = () => {
    const text = value.trim();
    if (!text || disabled || busy !== "idle") return;
    onSubmit(text);
  };

  /** Dictated text lands at the caret, with a space on either side where it needs one. */
  const insertDictated = (text: string) => {
    const el = field.current;
    const now = latest.current;
    const at = el && document.activeElement === el ? el.selectionStart : now.length;
    const before = now.slice(0, at);
    const after = now.slice(at);
    const piece = `${before && !/\s$/.test(before) ? " " : ""}${text}${after && !/^\s/.test(after) ? " " : ""}`;
    onChange(before + piece + after);
    requestAnimationFrame(() => {
      const caret = before.length + piece.length;
      field.current?.focus();
      field.current?.setSelectionRange(caret, caret);
    });
  };
  const dictate = () => onDictation?.({ onTranscript: insertDictated });
  const dictationHere = dictation.target === "composer" && dictation.state !== "idle" && dictation.state !== "success";

  // Escape anywhere in the composer throws a recording away.
  useEffect(() => {
    if (!dictationHere) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (dictation.state === "recording" || dictation.state === "requesting" || dictation.state === "processing")) {
        e.preventDefault();
        cancelDictation();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dictationHere, dictation.state]);

  const command = /^\/([\w-]+)\s*$/.exec(value);
  const hint = command ? filterCommands(command[1]).find((c) => c.name === command[1] && c.takesInput)?.inputHint : undefined;
  const sendable = !!value.trim() && !disabled && busy === "idle";
  const stopLabel = busy === "revealing" ? "Show the whole answer" : "Stop";

  const sendButton =
    busy !== "idle" ? (
      // Its own element: were it the send button with new props, the click that stops would go on to submit the form once the button had turned back into Send.
      <Button
        key="stop"
        type="button"
        size="icon"
        onClick={() => {
          onStop();
          field.current?.focus();
        }}
        aria-label={stopLabel}
        title={stopLabel}
      >
        <Square aria-hidden className="size-3.5 fill-current" />
      </Button>
    ) : (
      <Button key="send" type="submit" size="icon" disabled={!sendable} aria-label="Send" title="Send (Enter)">
        <ArrowUp aria-hidden className="size-4" />
      </Button>
    );
  const mic = onDictation && !disabled && <VoiceButton state={dictation.target === "composer" ? dictation.state : "idle"} onPress={dictate} />;
  const bar = dictationHere && (
    <DictationBar
      state={dictation.state}
      stream={dictation.stream}
      startedAt={dictation.startedAt}
      error={dictation.error}
      onStop={dictate}
      onCancel={cancelDictation}
      onRetry={() => {
        dismissDictationError();
        dictate();
      }}
      onDismiss={dismissDictationError}
    />
  );

  const showContext = !compact && !disabled;
  const fileName = activeFilePath?.slice(activeFilePath.lastIndexOf("/") + 1);
  const sending = [includeFile && fileName, selection && includeSelection && selectionLabel(selection).toLowerCase()].filter(Boolean) as string[];

  /* What goes with the message, said quietly in one line ("main.tex, lines 3 to 8"), and a menu to change it: leave the open file or the selection out, mention another file, or open the commands. */
  const context = showContext && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={sending.length ? `Sent with your message: ${sending.join(", ")}. Change` : "Add context to your message"}
          title="What goes with your message"
          className="group/context inline-flex h-[var(--control-height)] min-w-0 max-w-[60%] shrink items-center gap-1.5 rounded-[var(--radius)] px-2 type-small text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground data-[state=open]:bg-surface-hover data-[state=open]:text-foreground"
        >
          {activeFilePath && includeFile ? <FileTypeIcon filename={activeFilePath} className="size-4 shrink-0 opacity-60 group-hover/context:opacity-100" /> : <Plus aria-hidden className="size-4 shrink-0" />}
          <span className="min-w-0 truncate">{sending.length ? sending.join(", ") : "Context"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <DropdownMenuLabel className="type-small font-normal text-muted-foreground">Sent with your message</DropdownMenuLabel>
        {activeFilePath && (
          <DropdownMenuItem onSelect={() => onIncludeFileChange?.(!includeFile)}>
            <FileTypeIcon filename={activeFilePath} className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{fileName}</span>
            <Check aria-hidden className={cn("size-4", includeFile ? "opacity-100" : "opacity-0")} />
          </DropdownMenuItem>
        )}
        {selection ? (
          <DropdownMenuItem onSelect={() => onIncludeSelectionChange(!includeSelection)}>
            <Type aria-hidden className="size-4" />
            <span className="min-w-0 flex-1 truncate">The selection, {selectionLabel(selection).toLowerCase()}</span>
            <Check aria-hidden className={cn("size-4", includeSelection ? "opacity-100" : "opacity-0")} />
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <Type aria-hidden className="size-4" />
            Select text in the editor to send it
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => requestAnimationFrame(() => insertAtCaret("@"))}>
          <span aria-hidden className="grid size-4 place-items-center font-mono">@</span>
          Mention another file
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => requestAnimationFrame(() => (latest.current ? field.current?.focus() : insertAtCaret("/")))}>
          <span aria-hidden className="grid size-4 place-items-center font-mono">/</span>
          Commands
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const textarea = (
    <textarea
      ref={field}
      rows={1}
      value={value}
      disabled={disabled}
      placeholder={disabled ? "Axya cannot answer right now" : (hint ?? placeholder)}
      aria-label="Message to Axya"
      aria-autocomplete="list"
      aria-controls={listOpen ? listId : undefined}
      aria-activedescendant={listOpen ? `${listId}-${current}` : undefined}
      onChange={(e) => {
        onChange(e.target.value);
        sync(e.target.value, e.target.selectionStart);
      }}
      onSelect={(e) => sync(e.currentTarget.value, e.currentTarget.selectionStart)}
      onBlur={() => setTrigger(null)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (listOpen) {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((current + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
            return;
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            choose(current);
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDismissed(key);
            return;
          }
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send();
          return;
        }
        // Escape stops an answer being written; Arrow Up in an empty field takes the last question back to change it.
        if (e.key === "Escape" && busy !== "idle") {
          e.preventDefault();
          onStop();
          return;
        }
        if (e.key === "ArrowUp" && !value && onEditLast && busy === "idle") {
          e.preventDefault();
          onEditLast();
        }
      }}
      className={cn(
        "block min-h-[var(--control-height)] w-full min-w-0 resize-none bg-transparent px-2 py-2 type-base text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
        compact ? "max-h-32" : "max-h-60",
        bar && compact && "hidden",
      )}
    />
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className={cn("relative", className)}
      aria-label="Ask Axya"
    >
      {listOpen && (
        <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-[var(--radius-popover)] border border-line bg-panel p-1 shadow-popover">
          <p className="px-2 pt-1 pb-1.5 type-small text-muted-foreground">{trigger?.kind === "command" ? "Commands" : "Mention a file"}</p>
          <ul id={listId} role="listbox" aria-label={trigger?.kind === "command" ? "Commands" : "Project files"} className="max-h-72 overflow-y-auto">
            {trigger?.kind === "command"
              ? commands.map((c, i) => {
                  const why = c.unavailable?.(commandContext) ?? null;
                  return (
                    <li
                      key={c.name}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === current}
                      aria-disabled={!!why || undefined}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(i)}
                      className="flex min-h-10 cursor-default items-center gap-4 rounded-[var(--radius-item)] px-3 py-2 aria-selected:bg-surface-hover aria-disabled:opacity-55"
                    >
                      <span className="w-24 shrink-0 font-mono type-base font-medium whitespace-nowrap text-foreground">/{c.name}</span>
                      <span className="min-w-0 flex-1 truncate type-base text-muted-foreground">{why ?? c.description}</span>
                    </li>
                  );
                })
              : files.map((path, i) => (
                  <li
                    key={path}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === current}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(i)}
                    className="flex min-h-[var(--control-height)] cursor-default items-center gap-2 rounded-[var(--radius-item)] px-2 py-1.5 aria-selected:bg-surface-hover"
                  >
                    <FileTypeIcon filename={path} />
                    <span className="min-w-0 flex-1 truncate type-base text-foreground" title={path}>
                      {path}
                    </span>
                  </li>
                ))}
          </ul>
        </div>
      )}

      {/* A container, so the open file's chip in the bar is left out when the field is too narrow to show its name. */}
      <div className={cn("field @container/composer flex flex-col rounded-[var(--radius-tray)] p-1", disabled && "opacity-70")}>
        {compact ? (
          <div className="flex items-end gap-1">
            {leading}
            {bar ? <div className="flex min-w-0 flex-1 items-center">{bar}</div> : textarea}
            {!bar && mic}
            {!bar && sendButton}
            {trailing}
          </div>
        ) : (
          <>
            {textarea}
            <div className="flex min-h-[var(--control-height)] items-center gap-1">
              {bar || (
                <>
                  {leading}
                  {context}
                  <span className="ms-auto" />
                  {model}
                  {trailing}
                  {mic}
                  {sendButton}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </form>
  );
}

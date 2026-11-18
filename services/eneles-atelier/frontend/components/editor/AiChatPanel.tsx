"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Dock, History, MoreHorizontal, PanelBottom, Plus, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { DictationOptions } from "@/hooks/useSpeechRecognition";
import { editorSettingsAPI, type AiChatEdit, type AiStatus } from "@/lib/api";
import { parseCommand, setCustomCommands, SLASH_COMMANDS, type CommandContext, type SlashCommand } from "@/components/editor/assistant/commands";
import { Composer, type ComposerApi } from "@/components/editor/assistant/Composer";
import { AxyaMark, Conversation, StickyScroll } from "@/components/editor/assistant/Conversation";
import { BlockedCard } from "@/components/editor/assistant/BlockedCard";
import { ModelPicker } from "@/components/editor/assistant/ModelPicker";
import { noteEditorSelection, useEditorSelection } from "@/components/editor/assistant/editor-selection";
import { ProposedChanges, type ProposalActions } from "@/components/editor/assistant/ProposedChanges";
import { HistoryList } from "@/components/editor/assistant/HistoryList";
import type { AssistantConversation, ModelChoice } from "@/components/editor/assistant/history";
import { LiveAnswer } from "@/components/editor/assistant/reveal";
import type { AssistantSendOptions, AssistantSendResult, AssistantTurn, LiveSink } from "@/components/editor/assistant/types";
import { cn } from "@/lib/utils";

interface AiChatPanelProps {
  /** Closes the assistant: hides its panel, or the floating dock. */
  onToggle?: () => void;
  /**
   * Asks the assistant. The host streams the answer into `live` and commits the turns when it ends; `signal` aborts it (Stop), which closes the request and stops the model at the provider. Resolves `kept: false` when nothing was added (stopped before a word, or refused), and the question then goes back into the field.
   */
  onSend?: (prompt: string, options: AssistantSendOptions, live: LiveSink, signal: AbortSignal) => Promise<AssistantSendResult>;
  /** Empties the conversation. */
  onClear?: () => void;
  /** The conversation so far, oldest first. */
  turns?: AssistantTurn[];
  /** Whether the assistant can answer for this person, with what, and if not, why; null while unknown. */
  status?: AiStatus | null;
  /** The model chosen for this conversation; null for the account's default. */
  model?: ModelChoice | null;
  onModelChange?: (choice: ModelChoice) => void;
  /** Opens the place where keys and models are set (the editor's settings at Axya). */
  onOpenSettings?: () => void;
  hasCompileErrors?: boolean;
  diff?: { edits: AiChatEdit[]; message?: string } | null;
  /** The text of each proposed file as it is now in the project, to find edits made since the proposal. */
  currentText?: (path: string) => string | null;
  /** Accept and reject whole files or single changes. */
  proposal?: ProposalActions;
  /** Opens a project file in the editor. */
  onFileSelect?: (path: string) => void;
  /** Shows the project's reference papers. */
  onOpenReferences?: () => void;
  /** Starts or stops dictation; with `onTranscript` the text comes back to the assistant's field. */
  onDictation?: (options?: DictationOptions) => void;
  isPending?: boolean;
  /** The project's file paths, for "@" mentions and to know which read files can be opened. */
  filePaths?: string[];
  /** The file open in the editor, sent with every question unless the person leaves it out. */
  activeFilePath?: string;
  /** The saved conversations of this project, in this browser; without it there is no History. */
  history?: {
    conversations: readonly AssistantConversation[];
    currentId: string | null;
    onOpen: (id: string) => void;
    onDelete: (conversation: AssistantConversation) => void;
  };
  /** Shown over the assistant when it cannot be used yet (signed out, in the desktop app): the panel stays drawn, blurred and inert, so its suggestions and composer are seen, and this card says what opens it. The panel form only. */
  locked?: ReactNode;
}

/* ── Where the assistant lives ───────────────────────────────────────────── */

/**
 * The assistant has two forms, and the choice is the reader's, remembered on this device: a panel in the workspace, or a dock floating over the bottom of the editor that stays out of the layout. Kept as a tiny store so the View menu and the assistant itself can both switch it.
 */
export type AssistantForm = "panel" | "dock";
const FORM_KEY = "texer-assistant-form";
/** Kept per account, like the rest of the workspace (see useDockWorkspace); the browser-wide value older versions kept is read until the account has its own. The editor screen names the account; every other reader shares that choice. */
let formKey = FORM_KEY;
const formListeners = new Set<() => void>();
const subscribeForm = (l: () => void) => {
  formListeners.add(l);
  return () => {
    formListeners.delete(l);
  };
};
const readForm = (key: string): AssistantForm => {
  try {
    return (localStorage.getItem(key) ?? localStorage.getItem(FORM_KEY)) === "dock" ? "dock" : "panel";
  } catch {
    return "panel";
  }
};
export function setAssistantForm(form: AssistantForm) {
  try {
    localStorage.setItem(formKey, form);
  } catch {
    // Private windows may refuse storage; the choice then lasts for this page.
  }
  formListeners.forEach((l) => l());
}
/** The assistant's form. The editor screen passes the signed-in account; everything inside it passes nothing and reads the same account's choice. */
export function useAssistantForm(accountId?: number | null): AssistantForm {
  const key = accountId === undefined ? null : accountId === null ? FORM_KEY : `${FORM_KEY}:${accountId}`;
  // Before paint, so the readers inside the editor screen never show the browser-wide choice for a frame.
  useLayoutEffect(() => {
    if (key === null || key === formKey) return;
    formKey = key;
    formListeners.forEach((l) => l());
  }, [key]);
  return useSyncExternalStore(subscribeForm, () => readForm(key ?? formKey), () => "panel");
}

/** The editor panel's box on screen, for the floating dock to sit over; null before the editor is laid out. */
function useEditorBox(enabled: boolean) {
  const [box, setBox] = useState<{ left: number; width: number; bottom: number; height: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let target: Element | null = null;
    const measure = () => {
      target = document.querySelector('[data-panel="editor"]');
      const r = target?.getBoundingClientRect();
      if (!r || r.width < 1) return setBox(null);
      setBox((b) => (b && b.left === r.left && b.width === r.width && b.bottom === r.bottom && b.height === r.height ? b : { left: r.left, width: r.width, bottom: r.bottom, height: r.height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (target) observer.observe(target);
    // The dock moves panels without always resizing them (a sidebar closing shifts the editor), so the box is checked again on a slow beat too.
    const id = window.setInterval(measure, 800);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.clearInterval(id);
      window.removeEventListener("resize", measure);
    };
  }, [enabled]);
  return box;
}

/* ── The assistant ───────────────────────────────────────────────────────── */

export function AiChatPanel({
  onToggle,
  onSend,
  onClear,
  turns = [],
  status = null,
  model = null,
  onModelChange,
  onOpenSettings,
  hasCompileErrors = false,
  diff = null,
  currentText,
  proposal,
  onFileSelect,
  onOpenReferences,
  onDictation,
  filePaths = [],
  activeFilePath,
  history,
  locked,
}: AiChatPanelProps) {
  const form = useAssistantForm();
  const selection = useEditorSelection();
  const composer = useRef<ComposerApi>(null);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [includeSelection, setIncludeSelection] = useState(true);
  const [includeFile, setIncludeFile] = useState(true);
  const [dockOpen, setDockOpen] = useState(false);
  /* The list of saved conversations shows in place of the conversation until one is opened or Back is pressed. */
  const [showHistory, setShowHistory] = useState(false);
  /* The answer being written: the question, the stream, how many committed turns it stands for once they arrive, and how many turns there were when it was sent. */
  const [live, setLive] = useState<{ question: AssistantTurn; answer: LiveAnswer; at: number; replace: boolean; abort: AbortController; caught?: boolean } | null>(null);
  /* Editing the last question: the next send replaces it and its answer. */
  const [editingLast, setEditingLast] = useState(false);
  const lastSend = useRef<{ prompt: string; options: AssistantSendOptions } | null>(null);
  const online = useSyncExternalStore(
    (l) => {
      window.addEventListener("online", l);
      window.addEventListener("offline", l);
      return () => {
        window.removeEventListener("online", l);
        window.removeEventListener("offline", l);
      };
    },
    () => navigator.onLine,
    () => true,
  );
  const edits = diff?.edits ?? [];
  const local = model?.provider === "local";
  // Blocked: nothing can answer for this person (no key, and the platform path is off or not in the plan). The local test model, chosen in development, always can.
  const blocked = !!status && !status.available && !(local && status.localModel);
  // Locked, the panel shows as it would when ready (behind the lock's card, inert), so its suggestions are drawn.
  const unavailable = (blocked || status === null) && !locked;

  // The person's own slash commands (Settings, Axya) join the assistant's as soon as they are read.
  useEffect(() => {
    editorSettingsAPI
      .getAssistantCommands()
      .then(setCustomCommands)
      .catch(() => undefined);
  }, []);

  // A selection belongs to its file: switching files drops it until the editor reports a new one.
  useEffect(() => {
    noteEditorSelection(null);
  }, [activeFilePath]);
  // A new selection is sent unless the person leaves it out again; so is a newly opened file.
  const selectionKey = selection ? `${selection.fromLine}-${selection.toLine}` : "";
  const [seenSelection, setSeenSelection] = useState(selectionKey);
  if (seenSelection !== selectionKey) {
    setSeenSelection(selectionKey);
    setIncludeSelection(true);
  }
  const [seenFile, setSeenFile] = useState(activeFilePath);
  if (seenFile !== activeFilePath) {
    setSeenFile(activeFilePath);
    setIncludeFile(true);
  }

  // A reply opens the floating dock, so it is never missed behind a closed one; so do new proposed changes.
  const [seenEdits, setSeenEdits] = useState(edits.length);
  if (seenEdits !== edits.length) {
    setSeenEdits(edits.length);
    if (edits.length > seenEdits) setDockOpen(true);
  }

  const busy = live ? "pending" : "idle";
  const ctx: CommandContext = { activeFilePath, hasSelection: !!selection, hasCompileErrors };
  // How many committed turns the live answer stands for, once they arrive: the question and its answer.
  const committed = live ? turns.length - (live.replace ? live.at - 2 : live.at) : 0;
  const hide = live && committed >= 2 ? 2 : 0;
  // Once the answer is committed and its text has caught up, the committed turn takes its place.
  if (live?.caught && hide) setLive(null);

  const send = async (prompt: string, options: AssistantSendOptions) => {
    if (!onSend || unavailable || live) return;
    const withSelection = !!options.withSelection && !!selection && includeSelection;
    const replace = !!options.replaceLast || editingLast;
    const sent: AssistantSendOptions = { ...options, withSelection, withoutActiveFile: !includeFile, replaceLast: replace };
    lastSend.current = { prompt, options: { ...sent, replaceLast: false } };
    setNotice(null);
    setInput("");
    setEditingLast(false);
    setDockOpen(true);
    setShowHistory(false);
    const answer = new LiveAnswer();
    const abort = new AbortController();
    const question: AssistantTurn = { role: "user", content: prompt, label: options.label };
    setLive({ question, answer, at: turns.length, replace, abort });
    const sink: LiveSink = {
      meta: (m) => answer.meta(m),
      text: (d) => answer.text(d),
      activity: (a) => answer.activity(a),
      notice: (n) => answer.notice(n),
    };
    let result: AssistantSendResult;
    try {
      result = await onSend(prompt, sent, sink, abort.signal);
    } catch {
      result = { kept: false, reason: "failed" };
    }
    answer.finish();
    if (!result.kept) {
      // Nothing was added: the question goes back into the field, unless something new was typed meanwhile.
      setLive((now) => (now?.answer === answer ? null : now));
      setInput((now) => now || options.label || prompt);
      if (replace) setEditingLast(true);
    }
    // Kept: the live answer stays until its text has caught up, then gives way to the committed turn (onLiveCaughtUp).
  };

  const runCommand = (command: SlashCommand, text: string) => {
    const why = command.unavailable?.(ctx);
    if (why) {
      setNotice(`/${command.name}: ${why}.`);
      return;
    }
    if (command.takesInput && !text) {
      setInput(`/${command.name} `);
      composer.current?.focus();
      return;
    }
    const result = command.build(ctx, text);
    if (result.kind === "clear") {
      live?.abort.abort();
      setLive(null);
      setInput("");
      setNotice(null);
      setEditingLast(false);
      setShowHistory(false);
      onClear?.();
      return;
    }
    void send(result.prompt, { ...result.options, label: `/${command.name}${text ? ` ${text}` : ""}` });
  };

  const submit = (text: string) => {
    const parsed = parseCommand(text);
    if (parsed) return runCommand(parsed.command, parsed.input);
    void send(text, { withSelection: true });
  };

  /** Asks the last question again, in place of its answer. */
  const retry = () => {
    const question = [...turns].reverse().find((t) => t.role === "user");
    const last = lastSend.current;
    if (last && question && (last.options.label ?? last.prompt) === (question.label ?? question.content)) return void send(last.prompt, { ...last.options, replaceLast: true });
    if (question) void send(question.content, { label: question.label, replaceLast: true, withSelection: false });
  };

  /** Puts the last question back in the field; sending it replaces the question and its answer. */
  const editLast = () => {
    const question = [...turns].reverse().find((t) => t.role === "user");
    if (!question) return;
    setInput(question.label ?? question.content);
    setEditingLast(true);
    composer.current?.focus();
  };

  /** A file edited after its proposal: drop the stale proposal and ask for the change again against the text as it is now. */
  const reask = (path: string) => {
    if (!proposal) return;
    const name = path.slice(path.lastIndexOf("/") + 1);
    proposal.rejectFile(path);
    void send(`\`${path}\` was edited after your last proposal for it, so that proposal was dropped. Read the file again and make the same change against its current text, keeping the newer edits.`, { label: `Ask again about ${name}` });
  };

  const stop = () => {
    live?.abort.abort();
    composer.current?.focus();
  };

  const command = (name: string) => SLASH_COMMANDS.find((c) => c.name === name)!;
  const fileName = activeFilePath?.slice(activeFilePath.lastIndexOf("/") + 1);
  const suggestions: Array<{ label: string; command?: string; prompt?: string }> = [];
  if (hasCompileErrors) suggestions.push({ label: "Fix the errors from the last compile", command: "fix" });
  if (selection) suggestions.push({ label: "Explain the selected text", command: "explain" }, { label: "Improve the writing of the selection", command: "improve" });
  if (activeFilePath) suggestions.push({ label: `Find where ${fileName} needs citations`, command: "cite" }, { label: `Summarize ${fileName}`, prompt: `Summarize \`${activeFilePath}\` in a few short bullet points: what it covers, and what still looks unfinished. Do not change any file.` });
  suggestions.push({ label: "Make a table from a description", command: "table" });
  const suggest = (s: (typeof suggestions)[number]) => (s.command ? runCommand(command(s.command), "") : void send(s.prompt ?? s.label, { label: s.label }));

  const empty = turns.length === 0 && !live && edits.length === 0;
  const follow = `${turns.length}:${live ? 1 : 0}:${edits.length}`;
  const choose = (choice: ModelChoice) => onModelChange?.(choice);

  /* ── The pieces both forms share ── */

  const blockedCard = status && <BlockedCard status={status} onOpenSettings={onOpenSettings} onUseLocal={status.localModel ? () => choose({ provider: "local", model: null }) : undefined} />;

  const emptyState = (
    <div className="flex flex-col items-center gap-4 px-4 py-6 text-center">
      {/* Locked, the lock's card carries the mark. */}
      {!locked && (
        <span className="grid size-12 place-items-center rounded-[var(--radius-card)] border border-line bg-card">
          <AxyaMark size={24} />
        </span>
      )}
      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className="type-large font-medium text-foreground">Ask Axya</h2>
        {blocked && <p className="type-base text-muted-foreground">Axya needs a model to answer with. See below.</p>}
      </div>
      {!unavailable && (
        <ul className="flex w-full max-w-sm flex-col gap-1.5" aria-label="Suggestions">
          {suggestions.slice(0, 4).map((s) => (
            <li key={s.label}>
              <Button type="button" variant="outline" onClick={() => suggest(s)} className="w-full justify-start truncate font-normal">
                {s.label}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!unavailable && (
        <p className="type-small text-muted-foreground">
          Type <kbd className="rounded-[var(--radius-inset)] border border-line bg-surface px-1 font-mono">/</kbd> for commands and <kbd className="rounded-[var(--radius-inset)] border border-line bg-surface px-1 font-mono">@</kbd> to name a file.
        </p>
      )}
    </div>
  );

  const thread = (
    <div className="flex flex-col gap-5 px-4 py-4">
      <Conversation
        turns={turns}
        live={live ? { question: live.question, answer: live.answer, hide } : null}
        onLiveCaughtUp={() => setLive((now) => (now && !now.caught ? { ...now, caught: true } : now))}
        onRetry={onSend && !unavailable && !live ? retry : undefined}
        onEditLast={onSend && !unavailable && !live ? editLast : undefined}
        onOpenFile={onFileSelect}
        onOpenReferences={onOpenReferences}
        filePaths={filePaths}
        footer={edits.length > 0 && !live && proposal ? <ProposedChanges edits={edits} currentText={currentText} actions={{ ...proposal, reask: unavailable ? undefined : reask }} onOpenFile={onFileSelect} /> : undefined}
      />
    </div>
  );

  const noticeLine = (notice || editingLast || !online) && (
    <p role="status" className="flex min-h-9 items-center gap-2 px-1 pb-2 type-small text-muted-foreground">
      <span className="min-w-0 flex-1">{!online ? "You are offline. Axya answers again once the connection is back." : editingLast ? "Editing your last question: sending replaces it and its answer." : notice}</span>
      {(notice || editingLast) && online && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            if (editingLast) {
              setEditingLast(false);
              setInput("");
            }
            setNotice(null);
          }}
          aria-label={editingLast ? "Cancel editing" : "Dismiss"}
          className="text-muted-foreground"
        >
          <X aria-hidden className="size-4" />
        </Button>
      )}
    </p>
  );

  const picker = status && !blocked && <ModelPicker status={status} value={model} onChange={choose} onOpenSettings={onOpenSettings} disabled={!!live} />;

  const composerProps = {
    value: input,
    onChange: (v: string) => {
      setInput(v);
      if (notice) setNotice(null);
    },
    onSubmit: submit,
    onStop: stop,
    busy,
    disabled: unavailable || !online,
    commandContext: ctx,
    onCommand: (c: SlashCommand) => runCommand(c, ""),
    filePaths,
    activeFilePath,
    includeFile,
    onIncludeFileChange: setIncludeFile,
    selection,
    includeSelection,
    onIncludeSelectionChange: setIncludeSelection,
    onDictation: onDictation ? (options: DictationOptions) => onDictation(options) : undefined,
    onEditLast: turns.some((t) => t.role === "user") && !live ? editLast : undefined,
    apiRef: composer,
  } as const;

  const historyList = history && (
    <HistoryList
      conversations={history.conversations}
      currentId={turns.length ? history.currentId : null}
      busy={!!live}
      onBack={() => setShowHistory(false)}
      onNew={() => runCommand(command("clear"), "")}
      onOpen={(id) => {
        setNotice(null);
        setEditingLast(false);
        if (id !== history.currentId) history.onOpen(id);
        setShowHistory(false);
      }}
      onDelete={(conversation) => history.onDelete(conversation)}
      className="min-h-0 flex-1"
    />
  );
  const historyButton = history && (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={() => {
        setDockOpen(true);
        setShowHistory((v) => !v);
      }}
      aria-label="History"
      aria-pressed={showHistory}
      title="History"
      className="text-muted-foreground hover:text-foreground aria-pressed:bg-surface-hover aria-pressed:text-foreground"
    >
      <History aria-hidden className="size-4" />
    </Button>
  );

  /* ── Floating: a bar over the bottom of the editor that opens into a card ── */
  const box = useEditorBox(form === "dock");
  // The dock is drawn into the page's body, which exists only in the browser.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (form === "dock") {
    const margin = 16;
    const style: CSSProperties = box
      ? { left: box.left + margin, width: Math.max(0, box.width - margin * 2), bottom: Math.max(margin, window.innerHeight - box.bottom + margin) }
      : { left: margin, right: margin, bottom: margin };
    const maxHeight = box ? Math.max(240, box.height - margin * 2) : undefined;
    const dock = (
      <div className="pointer-events-none fixed z-40 flex justify-center" style={style}>
        <section
          aria-label="Axya"
          style={{ maxHeight }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && dockOpen && !e.defaultPrevented) {
              e.preventDefault();
              setDockOpen(false);
            }
          }}
          className="assistant-dock pointer-events-auto flex w-full max-w-[44rem] flex-col overflow-hidden rounded-[var(--radius-tray)] border border-line bg-panel shadow-modal"
          data-open={dockOpen || undefined}
        >
          {dockOpen && (
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line ps-4 pe-2">
              <AxyaMark size={16} />
              <h2 className="type-base font-medium text-foreground">Axya</h2>
              <span className="ms-auto flex items-center gap-0.5">
                {historyButton}
                {turns.length > 0 && (
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => runCommand(command("clear"), "")} aria-label="New conversation" title="New conversation" className="text-muted-foreground hover:text-foreground">
                    <Plus aria-hidden className="size-4" />
                  </Button>
                )}
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setAssistantForm("panel")} aria-label="Use as a panel" title="Use as a panel" className="text-muted-foreground hover:text-foreground">
                  <PanelBottom aria-hidden className="size-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setDockOpen(false)} aria-label="Collapse" title="Collapse (Escape)" className="text-muted-foreground hover:text-foreground">
                  <ChevronDown aria-hidden className="size-4" />
                </Button>
                {onToggle && (
                  <Button type="button" variant="ghost" size="icon-sm" onClick={onToggle} aria-label="Close Axya" title="Close" className="text-muted-foreground hover:text-foreground">
                    <X aria-hidden className="size-4" />
                  </Button>
                )}
              </span>
            </header>
          )}
          {dockOpen && showHistory && historyList ? (
            <div className="flex h-[min(32rem,60vh)] min-h-0 shrink flex-col">{historyList}</div>
          ) : (
            dockOpen && (empty ? <div className="min-h-0 shrink overflow-y-auto">{emptyState}</div> : <StickyScroll follow={follow} className="h-[min(32rem,60vh)] shrink">{thread}</StickyScroll>)
          )}
          <div className={cn("shrink-0 p-2", dockOpen && "border-t border-line")}>
            {dockOpen && noticeLine}
            {blocked && dockOpen ? (
              blockedCard
            ) : blocked ? (
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon" onClick={() => setDockOpen(true)} aria-label="Open the conversation" title="Open the conversation">
                  <AxyaMark size={18} />
                </Button>
                <p className="min-w-0 flex-1 truncate type-base text-muted-foreground">Axya needs an API key to answer.</p>
                <Button type="button" size="sm" onClick={onOpenSettings}>
                  Add an API key
                </Button>
              </div>
            ) : (
              <Composer
                {...composerProps}
                compact={!dockOpen}
                leading={
                  !dockOpen && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => setDockOpen(true)} aria-label="Open the conversation" title="Open the conversation" className="relative">
                      <AxyaMark size={18} />
                      {(edits.length > 0 || turns.length > 0) && <span aria-hidden className="absolute end-1.5 top-1.5 size-2 rounded-full bg-accent ring-2 ring-surface" />}
                    </Button>
                  )
                }
                model={dockOpen ? picker : undefined}
                trailing={
                  dockOpen ? null : (
                    <Button type="button" variant="ghost" size="icon" onClick={() => setAssistantForm("panel")} aria-label="Use as a panel" title="Use as a panel" className="text-muted-foreground hover:text-foreground">
                      <PanelBottom aria-hidden className="size-4" />
                    </Button>
                  )
                }
              />
            )}
          </div>
        </section>
      </div>
    );
    return mounted ? createPortal(dock, document.body) : null;
  }

  /* ── Panel: fills its place in the workspace; the dock's tab names it ── */
  return (
    <div className="relative h-full min-h-0 bg-panel">
      <div inert={!!locked} className={cn("flex h-full min-h-0 flex-col", locked && "pointer-events-none blur-[2px] select-none")}>
        {showHistory && historyList ? (
          historyList
        ) : empty ? (
          <div className="scrollbar-modern flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="my-auto">{emptyState}</div>
          </div>
        ) : (
          <StickyScroll follow={follow} className="flex-1">
            {thread}
          </StickyScroll>
        )}
        <div className="shrink-0 px-3 pt-1 pb-3">
          {noticeLine}
          {blocked ? (
            blockedCard
          ) : (
            <Composer
              {...composerProps}
              model={picker}
              trailing={
                <>
                  {historyButton}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="More" title="More" className="text-muted-foreground hover:text-foreground">
                        <MoreHorizontal aria-hidden className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top">
                      <DropdownMenuItem disabled={turns.length === 0} onSelect={() => runCommand(command("clear"), "")}>
                        <Plus aria-hidden />
                        New conversation
                      </DropdownMenuItem>
                      {history && (
                        <DropdownMenuItem onSelect={() => setShowHistory(true)}>
                          <History aria-hidden />
                          History
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => setAssistantForm("dock")}>
                        <Dock aria-hidden />
                        Float over the editor
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              }
            />
          )}
        </div>
      </div>
      {locked && <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-[color-mix(in_oklch,var(--panel)_45%,transparent)] p-4">{locked}</div>}
    </div>
  );
}

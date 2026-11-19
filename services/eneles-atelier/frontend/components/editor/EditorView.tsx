"use client";

import { EditorTour, useEditorTour } from "@/components/editor/EditorTour";
import { formatCount } from "@/lib/utils";
import { downloadCompiledPdf, pdfFileName } from "@/lib/editor/download-pdf";
import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from "react";
import {
  LatexEditor,
  type LatexEditorHandle,
} from "@/components/editor/LatexEditor";
import { PdfPreview } from "@/components/editor/PdfPreview";
import { FileTree, type ProjectFileItem } from "@/components/editor/FileTree";
import { ProjectToolbar } from "@/components/editor/ProjectToolbar";
import { EditorRibbon } from "@/components/editor/EditorRibbon";
import { ErrorLog, type LogEntry } from "@/components/editor/ErrorLog";
import { TableOfContents } from "@/components/editor/TableOfContents";
import { HistoryPanel, type HistoryRestoreResult } from "@/components/editor/HistoryPanel";
import { ReferencesPanel } from "@/components/editor/ReferencesPanel";
import { DockWorkspace, PanelSlot, TabBadge, useDockWorkspace } from "@/components/editor/workspace/DockWorkspace";
import { useStableCallback } from "@/hooks/useStableCallback";
import type { PanelId } from "@/components/editor/workspace/panels";
import { AiChatPanel, setAssistantForm, useAssistantForm } from "@/components/editor/AiChatPanel";
import { noteEditorSelection } from "@/components/editor/assistant/editor-selection";
import { toHistory, type AssistantSendOptions, type AssistantSendResult, type AssistantTurn, type LiveSink } from "@/components/editor/assistant/types";
import { useAssistantHistory } from "@/components/editor/assistant/history";
import { AI_STATUS_EVENT } from "@/components/editor/assistant/ai-status";
import { acceptIntoBase, applyToCurrent, diffHunks, placeAll, rejectFromProposal } from "@/lib/ai-diff";
import { setDictationMode } from "@/hooks/useSpeechRecognition";
import { DrawingPanel } from "@/components/editor/DrawingPanel";
import { ShareDialog } from "@/components/editor/ShareDialog";
import { SettingsDialog } from "@/components/editor/SettingsDialog";
import { DictionaryDialog } from "@/components/editor/DictionaryDialog";
import { CommandPalette } from "@/components/editor/CommandPalette";
import { InsertPalette } from "@/components/editor/InsertPalette";
import { ShortcutsDialog } from "@/components/editor/ShortcutsDialog";
import { SaveTemplateDialog } from "@/components/editor/SaveTemplateDialog";
import { ReviewPanel } from "@/components/editor/ReviewPanel";
import { CommentLayer } from "@/components/editor/review/CommentLayer";
import { ReviewStore } from "@/components/editor/review/store";
import type { Person } from "@/components/editor/review/parts";
import type { CommentHue } from "@/lib/review/hues";
import { BinaryPreview } from "@/components/editor/BinaryPreview";
import { GithubDialog } from "@/components/editor/GithubDialog";
import { AddReferenceDialog } from "@/components/editor/AddReferenceDialog";
import { WordCountDialog } from "@/components/editor/WordCountDialog";
import { toFileItems } from "@/lib/editor/file-items";
import { isText } from "@/lib/project-import";
import { ChatPanel } from "@/components/editor/ChatPanel";
import type { CommentTarget, ReviewProps } from "@/components/editor/LatexEditor";
import type { Suggestion } from "@/lib/review/track-changes";
import { useAuth } from "@/lib/auth-context";
import {
  projectsAPI,
  asVersionConflict,
  type ProjectCollaborator,
  type ProjectInvitation,
  type ProjectCollaboratorUser,
  type PendingAiDiff,
  aiAPI,
  AiRefusal,
  type AiChatEdit,
  type AiStatus,
  editorSettingsAPI,
  collabAPI,
  type CommentThread,
  type ChatMessage,
} from "@/lib/api";
import { dictionaryFor } from "@/lib/spell/extension";
import { DICTIONARY_CHANGED, announceDictionaryChange } from "@/lib/spell/personal";
import { useCollaboration } from "@/hooks/useCollaboration";
import { useYjsCollaboration } from "@/hooks/useYjsCollaboration";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useCompositor } from "@/hooks/useCompositor";
import { toast } from "sonner";
import { planPreamble, splitTikzSource } from "@/lib/tikz/insert";
import { loadFileTreeState, saveFileTreeState } from "@/lib/file-tree-state";

// Custom Hooks
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useEditorState } from "@/hooks/useEditorState";
import { useAiDiff } from "@/hooks/useAiDiff";
import { useCompile } from "@/hooks/useCompile";

const DEFAULT_DOCUMENT = `\\documentclass{article}
\\begin{document}
Hello World
\\end{document}`;

interface EditorViewProps {
  projectId: string;
  projectTitle: string;
  /** Set when this project is a reference paper: the project it belongs to. */
  referenceOf?: { uid: string; title: string } | null;
  initialFiles?: ProjectFileItem[];
  initialContent?: string;
  onBack: () => void;
  myRole?: "owner" | "viewer" | "editor";
  collaborators?: ProjectCollaborator[];
  pendingInvitations?: ProjectInvitation[];
  owner?: ProjectCollaboratorUser | null;
  initialFileContents?: Record<string, string>;
  /** fileId → `version` as loaded, for optimistic-locking on save. */
  initialFileVersions?: Record<string, number>;
  initialPendingAiDiff?: PendingAiDiff | null;
  initialAccess?: "private" | "view" | "edit";
}

/** While the assistant floats, its content stays mounted although its dock panel is closed. */
const FLOATING_ASSISTANT: PanelId[] = ["assistant"];

export function EditorView({
  projectId,
  projectTitle: initialTitle,
  referenceOf,
  initialFiles = [],
  initialContent = "",
  onBack,
  myRole = "owner",
  collaborators: initialCollaborators = [],
  pendingInvitations: initialPendingInvitations = [],
  owner = null,
  initialFileContents,
  initialFileVersions,
  initialPendingAiDiff = null,
  initialAccess = "private",
}: EditorViewProps) {
  const { isAuthenticated, user } = useAuth();
  const isOwner = myRole === "owner";
  const canEdit = myRole === "owner" || myRole === "editor";

  // ─── Project State ───
  const [title, setTitle] = useState(initialTitle);
  // The browser tab is named after the project, and follows a rename.
  useEffect(() => {
    if (title) document.title = `${title} - Eneles`;
  }, [title]);
  // The first-run tutorial: opens once per browser, a moment after the editor is on screen, and again from the View menu.
  const tour = useEditorTour(true);
  const [files, setFiles] = useState<ProjectFileItem[]>(
    initialFiles.length
      ? initialFiles
      : [{ id: "main", path: "main.tex", isMain: true, type: "tex" }],
  );
  const [activeFileId, setActiveFileIdState] = useState<string>(() => {
    const stored = loadFileTreeState(projectId);
    if (stored?.activeFileId && files.some((f) => f.id === stored.activeFileId))
      return stored.activeFileId;
    return files.find((f) => f.isMain)?.id || files[0]?.id || "main";
  });
  const [fileContents, setFileContents] = useState<Record<string, string>>(
    initialFileContents || {
      [activeFileId]: initialContent || DEFAULT_DOCUMENT,
    },
  );
  const currentContent = fileContents[activeFileId] || "";

  // ─── Auto-save State ───
  const [saveStatus, setSaveStatus] = useState<
    "saved" | "saving" | "unsaved" | "error"
  >("saved");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUnsavedChangesRef = useRef(false);

  // ─── UI State ───
  // Which panels are open, and where, is the dock's to know (components/editor/workspace). Everything the panels show is still owned here and handed to them as props.
  const workspace = useDockWorkspace(user?.id);
  const dock = workspace.controller;

  // The assistant has two forms (see AiChatPanel). As a panel it is one of the dock's panels. Floating, it stays out of the dock: its panel is closed and it draws itself over the editor, taking no room in the workspace. Either way it is the same mounted assistant; only where its element sits changes.
  const assistantForm = useAssistantForm(user?.id ?? null);
  const [floatingAssistant, setFloatingAssistant] = useState(true);
  const [seenAssistantForm, setSeenAssistantForm] = useState(assistantForm);
  if (seenAssistantForm !== assistantForm) {
    setSeenAssistantForm(assistantForm);
    // Choosing to float it is asking to see it.
    if (assistantForm === "dock") setFloatingAssistant(true);
  }
  const lastAssistantForm = useRef(assistantForm);
  useEffect(() => {
    const changed = lastAssistantForm.current !== assistantForm;
    lastAssistantForm.current = assistantForm;
    // A layout chosen from View → Layouts while it floats leaves it out of the dock.
    dock.setOutside("assistant", assistantForm === "dock");
    if (assistantForm === "dock") dock.hide("assistant");
    else if (changed) dock.show("assistant");
  }, [assistantForm, dock]);
  const assistantFloating = assistantForm === "dock" && floatingAssistant;
  const assistantOn = assistantForm === "dock" ? floatingAssistant : workspace.isOpen("assistant");
  const showAssistant = () => {
    if (assistantForm === "dock") setFloatingAssistant(true);
    else dock.show("assistant");
  };
  const toggleAssistant = () => {
    if (assistantForm === "dock") setFloatingAssistant((on) => !on);
    else workspace.toggle("assistant");
  };
  const [showDrawing, setShowDrawing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Which tab Settings opens at: the assistant's card opens it at Axya, to add a key.
  const [settingsTab, setSettingsTab] = useState<"editor" | "assistant">("editor");
  const [showDictionary, setShowDictionary] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showGithub, setShowGithub] = useState(false);
  const [showAddReference, setShowAddReference] = useState(false);
  const [showWordCount, setShowWordCount] = useState(false);
  const [editorMode, setEditorModeState] = useState<"code" | "visual">(() =>
    typeof window !== "undefined" && localStorage.getItem("texer-editor-mode") === "visual" ? "visual" : "code",
  );
  const setEditorMode = useCallback((mode: "code" | "visual") => {
    setEditorModeState(mode);
    localStorage.setItem("texer-editor-mode", mode);
  }, []);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [showInsertPalette, setShowInsertPalette] = useState(false);
  const [insertPaletteCoords, setInsertPaletteCoords] = useState<{
    left: number;
    top: number;
    bottom: number;
  } | null>(null);

  const editorRef = useRef<LatexEditorHandle>(null);
  const activeFileIdRef = useRef(activeFileId);
  activeFileIdRef.current = activeFileId;

  // Per-file editor view state (selection + scroll), so switching files and
  // back restores the cursor/scroll position. Lives in the parent so it
  // survives the per-file editor remount (key={activeFileId}). Mirrors how
  // Overleaf preserves per-document view state.
  const editorViewStateRef = useRef<
    Map<string, { selection: unknown; scrollTop: number }>
  >(new Map());

  // ─── History (the whole project's, 30-day retention) ───
  // Bumped whenever this browser has saved a version, so the History panel brings itself up to date; it fetches only while its tab is in front.
  const [historyRevision, setHistoryRevision] = useState(0);
  const fetchHistory = useCallback((snap?: { reason?: string } | null) => {
    if (snap?.reason !== "content unchanged") setHistoryRevision((n) => n + 1);
  }, []);
  // A request to show some files' history: the file tree's Show history, the File menu, or the command palette. The panel opens filtered to them.
  const [historyFocus, setHistoryFocus] = useState<{ paths: string[]; seq: number } | null>(null);

  // ─── Custom Hooks ───
  const addLog = useCallback(
    (type: LogEntry["type"], message: string, line?: number) => {
      setLogs((prev) => [
        ...prev,
        { type, message, line, timestamp: new Date() },
      ]);
    },
    [],
  );

  const {
    projectSettings,
    setProjectSettings,
    editorSettings,
    setEditorSettings,
    editorThemeId,
    updateEditorTheme,
  } = useEditorState({ projectId, isAuthenticated });

  // The person's own dictionary, for the spell checker.
  const [personalWords, setPersonalWords] = useState<string[]>([]);
  useEffect(() => {
    if (!isAuthenticated) return;
    let live = true;
    editorSettingsAPI
      .getDictionary()
      .then((d) => live && setPersonalWords(d.words || []))
      .catch(() => {});
    const onChange = (e: Event) => setPersonalWords((e as CustomEvent<string[]>).detail);
    window.addEventListener(DICTIONARY_CHANGED, onChange);
    return () => {
      live = false;
      window.removeEventListener(DICTIONARY_CHANGED, onChange);
    };
  }, [isAuthenticated]);
  const addToDictionary = useCallback((word: string) => {
    const lower = word.toLowerCase();
    setPersonalWords((prev) => {
      if (prev.includes(lower)) return prev;
      const next = [...prev, lower].sort();
      announceDictionaryChange(next);
      return next;
    });
    // Kept with the account, so the word is accepted in every project and on every device.
    editorSettingsAPI
      .addWord(lower)
      .then(() => toast.success(`“${word}” added to your dictionary`))
      .catch(() => {
        toast.error(`Could not save “${word}” to your dictionary`);
      });
  }, []);

  // ─── Compositor: single insertion middleman ───
  // compose() is STABLE (never recreated). All useCallbacks can safely
  // reference it without adding it to deps: it always reads current autoIndent.
  const compose = useCompositor({
    editorRef,
    autoIndent: editorSettings?.autoIndent ?? false,
  });

  const { toggleDictation } = useSpeechRecognition({
    isAuthenticated,
    // forceRaw=true: transcript is plain prose, indentation would mangle it
    onTranscriptAction: (t: string) => {
      compose(t + " ", true);
    },
    onLogAction: (type, message) => addLog(type, message),
  });

  const {
    isCompiling,
    pdfUrl,
    buildKey,
    synctexData,
    compileDuration,
    compileErrors,
    handleCompile,
  } = useCompile({
    projectId,
    isAuthenticated,
    onLogAction: addLog,
    onAutoOpenLogAction: () => dock.show("logs"),
  });

  // Accepted AI edits (and other whole-file writes) go through the shared
  // document when the file is live there, so the editor and collaborators see
  // them; local state is updated too, for compiles and offline saves.
  const replaceInSharedDocRef = useRef<((path: string, content: string) => boolean) | null>(null);
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  const updateFileContentLocallyAction = useCallback(
    (path: string, content: string) => {
      replaceInSharedDocRef.current?.(path, content);
      const file = filesRef.current.find((f) => f.path === path);
      if (file) setFileContents((prev) => ({ ...prev, [file.id]: content }));
    },
    [],
  );

  // ── Optimistic locking ──────────────────────────────────────────────────
  //
  // fileId → the `version` this client last saw. Sent as `expectedVersion` so
  // the API rejects a write that would clobber somebody else's save rather
  // than silently winning. Yjs already reconciles concurrent edits inside a
  // live session; this covers the cases it cannot see: a collaborator on a
  // stale socket, a second tab, or an AI edit applied while the room was down.
  const fileVersionsRef = useRef<Map<string, number>>(
    new Map(Object.entries(initialFileVersions ?? {})),
  );
  // The open file is live: bound to the shared document and connected (set further down, once the collaboration hooks have run).
  const liveRef = useRef(false);
  // A live file's text is everyone's merged text, so a save of it never conflicts with another person's save of the same live file: the version check is for the cases the shared document cannot see (see above). With it, two people typing in one file made each other's saves fail every few seconds with "Someone else saved this file".
  const expectedVersionOf = (fileId: string) => (fileId === activeFileIdRef.current && liveRef.current ? undefined : fileVersionsRef.current.get(fileId));

  const rememberVersion = useCallback(
    (fileId: string, version: number | undefined) => {
      if (typeof version === "number") {
        fileVersionsRef.current.set(fileId, version);
      } else {
        // The API didn't report a version, so we have nothing trustworthy to
        // compare against next time. Drop it and fall back to an unguarded
        // write rather than sending a stale number and 409-ing forever.
        fileVersionsRef.current.delete(fileId);
      }
    },
    [],
  );

  /**
   * Handle a failed save that turned out to be a version conflict.
   *
   * Returns true when the error was a conflict and has been dealt with, so the
   * caller can stop. The user's text is never discarded: the server copy is
   * only adopted for files they aren't currently looking at.
   */
  const handleSaveConflict = useCallback(
    (fileId: string, err: unknown) => {
      const conflict = asVersionConflict(err);
      if (!conflict) return false;

      // Re-sync to the server's version so the user's next save can succeed.
      fileVersionsRef.current.set(fileId, conflict.currentVersion);
      hasUnsavedChangesRef.current = true;
      setSaveStatus("error");

      if (fileId === activeFileIdRef.current) {
        toast.warning("Someone else saved this file", {
          description:
            "Your changes are still here. Save again to overwrite, or reload the project to take theirs.",
        });
      } else {
        // Not on screen: safe to take the server copy without losing anything
        // the user can see.
        setFileContents((prev) => ({
          ...prev,
          [fileId]: conflict.currentContent,
        }));
      }
      return true;
    },
    [],
  );

  const { aiPendingDiff, setAiPendingDiff } = useAiDiff({
    projectId,
    isAuthenticated,
    canEdit,
    initialDiff: initialPendingAiDiff,
  });

  // ─── Persistence & Sync ───
  useEffect(() => {
    saveFileTreeState(projectId, {
      activeFileId,
      expandedFolderIds: loadFileTreeState(projectId)?.expandedFolderIds ?? [],
    });
  }, [projectId, activeFileId]);

  // Latest set of expanded folder ids, seeded from storage. Held in a ref so it
  // survives FileTree remounts (e.g. toggling the file-tree panel) and avoids
  // re-reading localStorage on every render.
  const expandedFolderIdsRef = useRef<string[]>(
    loadFileTreeState(projectId)?.expandedFolderIds ?? [],
  );

  // Persist expanded folders whenever the tree changes. Stable identity so the
  // FileTree effect doesn't fire every render; reads the live activeFileId from
  // a ref so it never clobbers the saved active file.
  const handleExpandedFoldersChange = useCallback(
    (ids: string[]) => {
      expandedFolderIdsRef.current = ids;
      saveFileTreeState(projectId, {
        activeFileId: activeFileIdRef.current,
        expandedFolderIds: ids,
      });
    },
    [projectId],
  );

  // ── Collaboration socket: presence + cursors (document sync is Yjs) ──
  const { connected, remoteUsers, emitCursorMove, socketRef } =
    useCollaboration({
      projectUid: projectId,
      isAuthenticated,
      activeFile: files.find((f) => f.id === activeFileId)?.path || null,
      currentUserId: user?.id ?? null,
    });

  // ── Yjs CRDT collaboration (the single source of truth for document sync) ──
  const { yjsExtension, ytext, replaceFileText } = useYjsCollaboration({
    socketRef,
    socketConnected: connected,
    activeFile: (() => {
      const f = files.find((x) => x.id === activeFileId);
      return f && !f.binary ? f.path : null;
    })(),
    currentUserId: user?.id ?? null,
    currentUserName: user?.name ?? "Anonymous",
    enabled: !!isAuthenticated && !!projectId,
  });
  useEffect(() => {
    replaceInSharedDocRef.current = replaceFileText;
  }, [replaceFileText]);

  // ─── Handlers ───
  const setActiveFileId = useCallback(
    (id: string) => setActiveFileIdState(id),
    [],
  );

  const handleSave = useCallback(
    async (content?: string, fileIdOverride?: string) => {
      if (!isAuthenticated || !canEdit) return;
      const targetId = fileIdOverride ?? activeFileId;
      const file = files.find((f) => f.id === targetId);
      if (!file || file.type === "folder") return;
      // Read content from CodeMirror directly (source of truth when Yjs is active),
      // falling back to React state for inactive files.
      const toSave =
        content ??
        (targetId === activeFileId
          ? (editorRef.current?.getContent() ?? fileContents[targetId] ?? "")
          : (fileContents[targetId] ?? ""));
      setSaveStatus("saving");
      try {
        const fileIdNum = parseInt(targetId, 10);
        if (!isNaN(fileIdNum)) {
          const saved = await projectsAPI.updateFile(projectId,
            fileIdNum,
            {
              content: toSave,
              expectedVersion: expectedVersionOf(targetId),
            },
          );
          rememberVersion(targetId, saved?.version);
        }
        // Create DB history snapshot (30-day retention)
        const snap = await projectsAPI.createHistorySnapshot(projectId,
          file.path,
          toSave,
        );
        fetchHistory(snap);
        hasUnsavedChangesRef.current = false;
        setSaveStatus("saved");
      } catch (e) {
        if (handleSaveConflict(targetId, e)) return;
        console.error("Save failed", e);
        setSaveStatus("error");
      }
    },
    [
      isAuthenticated,
      canEdit,
      activeFileId,
      files,
      fileContents,
      projectId,
      fetchHistory,
      rememberVersion,
      handleSaveConflict,
    ],
  );

  // A diagram from the TikZ template picker: the figure goes in at the cursor, and the packages and libraries it needs are added once to the main document's preamble.
  const insertTikzTemplate = useCallback(
    (source: string) => {
      // The figure gets lines of its own, whatever the cursor is in the middle of, at the indentation of the line it goes on.
      const at = editorRef.current?.getCursorPosition();
      const line = at ? (editorRef.current?.getContent().split("\n")[at.line - 1] ?? "") : "";
      const indent = /^\s*/.exec(line)?.[0] ?? "";
      const before = at && line.slice(0, at.column).trim() ? `\n${indent}` : "";
      const after = at && line.slice(at.column).trim() ? `\n${indent}` : "";
      compose(`${before}${splitTikzSource(source).body.split("\n").map((l, i) => (i && l ? indent + l : l)).join("\n")}${after}`, true);
      const main = files.find((f) => f.path === projectSettings.mainDocument && f.type !== "folder");
      if (!main) return;
      const read = (id: string) => (id === activeFileIdRef.current ? editorRef.current?.getContent() : undefined) ?? fileContents[id] ?? "";
      const plan = planPreamble(source, read(main.id), files.filter((f) => f.type !== "folder").map((f) => ({ path: f.path, content: read(f.id) })));
      if (!plan.lines.length) return;
      if (plan.next === null) {
        toast(`Add to the preamble of ${main.path}`, { description: plan.lines.join("\n") });
        return;
      }
      const next = plan.next;
      const live = replaceInSharedDocRef.current?.(main.path, next) ?? false;
      if (!live && main.id === activeFileIdRef.current) editorRef.current?.setValue(next);
      setFileContents((prev) => ({ ...prev, [main.id]: next }));
      if (main.id !== activeFileIdRef.current) void handleSave(next, main.id);
      toast.success(`Added to the preamble of ${main.path}`, { description: plan.lines.join("\n") });
    },
    [compose, files, fileContents, projectSettings.mainDocument, handleSave],
  );

  // A new tab size reindents every text file: groups of the old size at the start of each line become the new size. Each file goes through the shared document when it is live there (as other whole-file writes do), so the open editor and collaborators see it, and is saved.
  const reindentProject = useCallback(
    (oldSize: number, newSize: number) => {
      if (!canEdit) return;
      let changed = 0;
      for (const file of files) {
        if (file.type === "folder" || file.binary) continue;
        const active = file.id === activeFileIdRef.current;
        const content = (active ? editorRef.current?.getContent() : undefined) ?? fileContents[file.id];
        if (!content) continue;
        const next = content
          .split("\n")
          .map((line) => {
            const spaces = /^( +)/.exec(line)?.[1].length ?? 0;
            return spaces ? " ".repeat(Math.floor(spaces / oldSize) * newSize + (spaces % oldSize)) + line.slice(spaces) : line;
          })
          .join("\n");
        if (next === content) continue;
        changed++;
        const live = replaceInSharedDocRef.current?.(file.path, next) ?? false;
        if (!live && active) editorRef.current?.setValue(next);
        setFileContents((prev) => ({ ...prev, [file.id]: next }));
        void handleSave(next, file.id);
      }
      if (changed) toast.success(`Reindented ${formatCount(changed, "file", "files")} from ${oldSize} to ${newSize} spaces`);
    },
    [canEdit, files, fileContents, handleSave],
  );

  const triggerAutoSave = useCallback(async () => {
    if (!hasUnsavedChangesRef.current || !isAuthenticated || !canEdit) return;
    setSaveStatus("saving");
    const targetId = activeFileIdRef.current;
    try {
      const file = files.find((f) => f.id === targetId);
      if (!file || file.type === "folder") return;
      // Read from CodeMirror directly: when Yjs is active, React state may be stale
      const toSave =
        editorRef.current?.getContent() ?? fileContents[targetId] ?? "";
      const fileIdNum = parseInt(targetId, 10);
      if (!isNaN(fileIdNum)) {
        const saved = await projectsAPI.updateFile(projectId, fileIdNum, {
          content: toSave,
          expectedVersion: expectedVersionOf(targetId),
        });
        rememberVersion(targetId, saved?.version);
      }
      const snap = await projectsAPI.createHistorySnapshot(projectId,
        file.path,
        toSave,
      );
      fetchHistory(snap);
      hasUnsavedChangesRef.current = false;
      setSaveStatus("saved");
    } catch (e) {
      if (handleSaveConflict(targetId, e)) return;
      console.error("Auto-save failed", e);
      setSaveStatus("error");
    }
  }, [
    isAuthenticated,
    canEdit,
    files,
    fileContents,
    projectId,
    fetchHistory,
    rememberVersion,
    handleSaveConflict,
  ]);

  // File → Download PDF: the same download as the button on the PDF panel, available whether or not that panel is open.
  const handleDownloadPdf = useCallback(async () => {
    if (!pdfUrl) return;
    try {
      await downloadCompiledPdf({ pdfUrl, buildKey, projectId, isAuthenticated, fileName: pdfFileName(title) });
    } catch {
      toast.error("The PDF could not be downloaded. Compile again, then try once more.");
    }
  }, [pdfUrl, buildKey, projectId, isAuthenticated, title]);

  // A compile reads the saved copy of each file, so what was typed since the last save is saved first. Without this, compiling within a few seconds of typing built the old text.
  const compileAfterSaving = useCallback(async () => {
    if (!isCompiling && hasUnsavedChangesRef.current) await triggerAutoSave();
    await handleCompile();
  }, [isCompiling, triggerAutoSave, handleCompile]);

  // Auto-compile (the PDF panel's switch and Settings): each auto-save compiles after it. A ref, so the save's timer reaches the current setting and compiler.
  const autoCompileRef = useRef<() => void>(() => {});
  useEffect(() => {
    autoCompileRef.current = () => {
      if (projectSettings.autoCompile && !isCompiling) void handleCompile();
    };
  }, [projectSettings.autoCompile, isCompiling, handleCompile]);

  // Clean up the auto-save debounce timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  const handleContentChange = useCallback(
    (newContent: string) => {
      setFileContents((prev) => ({ ...prev, [activeFileId]: newContent }));

      // Real-time collaboration sync is handled entirely by Yjs (yCollab) via
      // the shared Y.Doc. This callback only mirrors content into React state
      // and schedules the DB auto-save.

      // Mark as unsaved and restart auto-save timer (saves to DB, not WebSocket)
      hasUnsavedChangesRef.current = true;
      setSaveStatus("unsaved");
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        if (hasUnsavedChangesRef.current) {
          void triggerAutoSave().then(() => autoCompileRef.current());
        }
      }, 3000);
    },
    [activeFileId, triggerAutoSave],
  );

  const handleTitleChange = useCallback(
    async (newTitle: string) => {
      setTitle(newTitle);
      if (isAuthenticated)
        projectsAPI
          .updateProject(projectId, { title: newTitle })
          .catch(console.error);
    },
    [isAuthenticated, projectId],
  );

  const handleDownloadZip = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const JSZip = (await import("jszip")).default;
      const data = await projectsAPI.exportProject(projectId);
      const zip = new JSZip();
      for (const file of data.files) {
        zip.file(file.path, file.content, { base64: file.encoding === "base64" });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.name.replace(/[^a-zA-Z0-9-_ ]/g, "_")}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Project exported as ZIP");
    } catch (e: any) {
      console.error("Failed to export project:", e);
      toast.error(e.message || "Failed to export project");
    }
  }, [isAuthenticated, projectId]);

  const [collaborators, setCollaborators] = useState(initialCollaborators);
  const [pendingInvitations, setPendingInvitations] = useState(
    initialPendingInvitations,
  );
  const refreshCollaborators = useCallback(async () => {
    if (!isAuthenticated) return;
    const data = await projectsAPI.getCollaborators(projectId);
    setCollaborators(data.collaborators);
    setPendingInvitations(data.pendingInvitations);
  }, [isAuthenticated, projectId]);

  // Thin alias: child components (toolbar, palette, drawing panel) call this.
  // compose is stable so this callback is also stable.
  const handleInsertSnippet = useCallback(
    (snippet: string) => {
      compose(snippet);
    },
    [compose],
  );

  // The assistant: the conversation in use and the saved ones (kept in this browser for this account and project), and whether AI is set up on this server.
  const aiHistory = useAssistantHistory(projectId, user?.id);
  const aiTurns = aiHistory.turns;
  const setAiTurns = aiHistory.setTurns;
  // Whether the assistant can answer for this person and with what: read on open, when the window comes back into focus (a key added on the AI page in another tab), and whenever a settings page says it changed.
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const refreshAiStatus = useCallback(() => {
    aiAPI
      .chatStatus()
      .then((s) => {
        setAiStatus(s);
        setDictationMode(s.dictation);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!isAuthenticated) return;
    refreshAiStatus();
    window.addEventListener("focus", refreshAiStatus);
    window.addEventListener(AI_STATUS_EVENT, refreshAiStatus);
    return () => {
      window.removeEventListener("focus", refreshAiStatus);
      window.removeEventListener(AI_STATUS_EVENT, refreshAiStatus);
    };
  }, [isAuthenticated, refreshAiStatus]);

  /** "fake-large, OpenAI-compatible": who answered, shown under the answer. */
  const describeModel = (meta: { model: string; providerName: string; source: string } | null) => (!meta ? undefined : meta.source === "local" ? "Local test model" : meta.source === "platform" ? meta.model : `${meta.model}, ${meta.providerName}`);

  /**
   * Asks the assistant and streams its answer into the panel's live view. When it ends the question and the answer are committed to the conversation, together: an answer, a partial answer marked stopped, or an inline error with what arrived before it. Proposed edits join the waiting proposal, replacing an earlier one for the same file.
   */
  const handleAiSend = async (prompt: string, options: AssistantSendOptions, live: LiveSink, signal: AbortSignal): Promise<AssistantSendResult> => {
    if (!isAuthenticated || !canEdit) return { kept: false, reason: "refused" };
    const dropLast = (turns: AssistantTurn[]) => (options.replaceLast && turns.length >= 2 ? turns.slice(0, -2) : turns);
    const earlier = dropLast(aiTurns);
    const selection = options.withSelection ? editorRef.current?.getCommentTarget()?.quote : undefined;
    const context = {
      ...(options.withErrors && compileErrors.length ? { compileErrors: compileErrors.slice(0, 20).join("\n") } : {}),
      ...(selection ? { selection } : {}),
    };
    const choice = aiHistory.model;
    let text = "";
    let meta: { model: string; providerName: string; source: string; trimmed: { sent: number; total: number } | null } | null = null;
    const notices: string[] = [];
    let result: { message: string; edits: AiChatEdit[]; read: string[] } | null = null;
    let failure: { message: string; retryable: boolean; code?: string } | null = null;
    const commit = (answer: Omit<AssistantTurn, "role">) =>
      setAiTurns((turns) =>
        [...dropLast(turns), { role: "user" as const, content: prompt, label: options.label }, { role: "assistant" as const, model: describeModel(meta), ...(notices.length ? { notices } : {}), ...(meta?.trimmed ? { trimmed: meta.trimmed } : {}), ...answer }].slice(-40),
      );
    try {
      const { ended } = await aiAPI.streamChat(
        projectId,
        {
          message: prompt,
          files: files.filter((f) => f.type !== "folder" && !f.binary).map((f) => ({ path: f.path, content: (f.id === activeFileId ? editorRef.current?.getContent() : undefined) ?? fileContents[f.id] ?? "" })),
          activeFilePath: options.withoutActiveFile ? undefined : (files.find((f) => f.id === activeFileId)?.path ?? undefined),
          tabSize: projectSettings.tabSize ?? 4,
          history: toHistory(earlier.slice(-40)),
          context: Object.keys(context).length ? context : undefined,
          ...(choice ? { provider: choice.provider, ...(choice.model ? { model: choice.model } : {}) } : {}),
        },
        (event) => {
          if (event.type === "meta") {
            meta = event;
            live.meta(event);
          } else if (event.type === "text") {
            text += event.delta;
            live.text(event.delta);
          } else if (event.type === "activity") live.activity(event);
          else if (event.type === "notice") {
            notices.push(event.message);
            live.notice(event.message);
          } else if (event.type === "result") result = event;
          else if (event.type === "error") failure = { message: event.message, retryable: event.retryable, code: event.code };
        },
        signal,
      );
      const done = result as { message: string; edits: AiChatEdit[]; read: string[] } | null;
      if (done) {
        commit({ content: done.message || text.trim() || (done.edits.length ? "I proposed the changes below." : "Done."), read: done.read });
        if (done.edits.length) {
          setAiPendingDiff((prev) => {
            const replaced = new Set(done.edits.map((e) => e.path));
            return { edits: [...(prev?.edits ?? []).filter((e) => !replaced.has(e.path)), ...done.edits], message: done.message };
          });
          showAssistant();
        }
      } else if (failure) commit({ content: text, error: failure });
      else if (ended !== "done") commit({ content: text, error: { message: "The answer stopped before it finished. What arrived is kept.", retryable: true } });
      else commit({ content: text || "Done." });
      return { kept: true };
    } catch (e) {
      if (signal.aborted) {
        if (!text.trim()) return { kept: false, reason: "stopped" };
        commit({ content: text, stopped: true });
        return { kept: true };
      }
      if (e instanceof AiRefusal) {
        if (e.code === "no_key") {
          refreshAiStatus();
          return { kept: false, reason: "refused" };
        }
        commit({ content: "", error: { message: e.message, retryable: e.status === 429 || e.status >= 500, code: e.code ?? undefined } });
        return { kept: true };
      }
      commit({ content: text, error: { message: navigator.onLine ? "The connection to the server was lost before the answer finished. What arrived is kept." : "You went offline before the answer finished. What arrived is kept.", retryable: true, code: "network" } });
      return { kept: true };
    }
  };
  const aiFilePaths = useMemo(() => files.filter((f) => f.type !== "folder").map((f) => f.path), [files]);
  const openFileByPath = (path: string) => {
    const file = files.find((f) => f.path === path && f.type !== "folder");
    if (file) setActiveFileId(file.id);
  };

  // Proposed changes are accepted or rejected in the assistant, so it opens whenever there are some, including ones that came back with the project.
  const [seenAiDiff, setSeenAiDiff] = useState<typeof aiPendingDiff>(null);
  if (seenAiDiff !== aiPendingDiff) {
    setSeenAiDiff(aiPendingDiff);
    if (aiPendingDiff?.edits.length && assistantForm === "dock") setFloatingAssistant(true);
  }
  useEffect(() => {
    if (aiPendingDiff?.edits.length && assistantForm === "panel") dock.show("assistant");
  }, [aiPendingDiff, assistantForm, dock]);

  // ─── File Ops ───
  const handleFileCreate = async (path: string) => {
    if (!isAuthenticated || !canEdit) return;

    // Optimistic: add immediately with temp ID
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const ext = path.split(".").pop()?.toLowerCase() || "tex";
    const type: ProjectFileItem["type"] =
      ext === "bib" ? "bib" : ext === "sty" ? "sty" : "tex";
    const optimisticFile: ProjectFileItem = { id: tempId, path, type };

    setFiles((prev) => [...prev, optimisticFile]);
    setFileContents((prev) => ({ ...prev, [tempId]: "" }));
    setActiveFileId(tempId);

    try {
      const f = await projectsAPI.createFile(projectId, {
        path,
        isMain: false,
      });
      const realId = f.id.toString();
      rememberVersion(realId, f.version);
      // Swap temp ID with real ID
      setFiles((prev) =>
        prev.map((file) =>
          file.id === tempId ? { ...file, id: realId, path: f.path } : file,
        ),
      );
      setFileContents((prev) => {
        const updated = { ...prev, [realId]: prev[tempId] ?? "" };
        delete updated[tempId];
        return updated;
      });
      setActiveFileId(realId);
    } catch (e) {
      // Rollback
      setFiles((prev) => prev.filter((file) => file.id !== tempId));
      setFileContents((prev) => {
        const updated = { ...prev };
        delete updated[tempId];
        return updated;
      });
      setActiveFileId(files[0]?.id || "");
      toast.error("Failed to create file");
    }
  };

  /** A file's text as it is now: the editor's for the open file, the last known otherwise; null when there is no such file. */
  const currentTextOf = (path: string): string | null => {
    const file = filesRef.current.find((f) => f.path === path && f.type !== "folder");
    if (!file) return null;
    return (file.id === activeFileIdRef.current ? editorRef.current?.getContent() : undefined) ?? fileContentsRef.current[file.id] ?? "";
  };

  /** Writes a file's new text and saves it now (autosave only ever saves the open file); a file that does not exist yet is created. */
  const writeProjectFile = async (path: string, content: string) => {
    const file = filesRef.current.find((f) => f.path === path && f.type !== "folder");
    try {
      if (file) {
        updateFileContentLocallyAction(path, content);
        await handleSave(content, file.id);
      } else {
        const created = await projectsAPI.createFile(projectId, { path, content, isMain: false });
        const id = created.id.toString();
        const ext = created.path.split(".").pop()?.toLowerCase();
        rememberVersion(id, created.version);
        setFiles((prev) => [...prev, { id, path: created.path, type: ext === "bib" ? "bib" : ext === "sty" ? "sty" : "tex" }]);
        setFileContents((prev) => ({ ...prev, [id]: content }));
      }
    } catch {
      toast.error(`The change to ${path} could not be saved.`);
    }
  };

  /** Replaces one file's entry in the proposal, or drops it when nothing is left to review. */
  const updateProposal = (path: string, next: AiChatEdit | null) =>
    setAiPendingDiff((prev) => {
      if (!prev) return null;
      const edits = prev.edits.flatMap((e) => (e.path !== path ? [e] : next && (next.deleted || next.created || next.oldContent !== next.newContent) ? [next] : []));
      return edits.length ? { ...prev, edits } : null;
    });

  /**
   * Accepting the assistant's changes. A change made against a file that was edited since is placed onto the current text by a three-way merge (lib/ai-diff.ts): it applies where its lines moved to, and is held back, never written over the newer edit, when someone changed its lines. Accepting a whole file applies every change that still fits and leaves the rest to ask again.
   */
  const acceptAiHunk = async (path: string, hunkId: string) => {
    if (!canEdit) return;
    const edit = aiPendingDiff?.edits.find((e) => e.path === path);
    const hunk = edit && diffHunks(edit.oldContent, edit.newContent).find((h) => h.id === hunkId);
    if (!edit || !hunk) return;
    const current = currentTextOf(path) ?? "";
    const next = applyToCurrent(edit.oldContent, current, hunk);
    if (next === null) {
      toast.warning("This change would write over an edit made since Axya proposed it.", { description: "Reject it, or ask Axya again." });
      return;
    }
    updateProposal(path, { ...edit, oldContent: acceptIntoBase(edit.oldContent, hunk) });
    if (next !== current) await writeProjectFile(path, next);
  };

  const rejectAiHunk = (path: string, hunkId: string) => {
    const edit = aiPendingDiff?.edits.find((e) => e.path === path);
    const hunk = edit && diffHunks(edit.oldContent, edit.newContent).find((h) => h.id === hunkId);
    if (!edit || !hunk) return;
    updateProposal(path, { ...edit, newContent: rejectFromProposal(edit.newContent, hunk) });
  };

  const acceptAiFile = async (path: string) => {
    if (!isAuthenticated || !canEdit) return;
    const edit = aiPendingDiff?.edits.find((e) => e.path === path);
    if (!edit) return;
    const current = currentTextOf(path);
    if (edit.deleted) {
      updateProposal(path, null);
      const file = filesRef.current.find((f) => f.path === path && f.type !== "folder");
      if (file) await handleFileDelete(file.id);
      return;
    }
    if (edit.created || current === null || current === edit.oldContent) {
      updateProposal(path, null);
      await writeProjectFile(path, edit.newContent);
      return;
    }
    // Edited since: apply the changes that still fit, one at a time, each against the text the last one left.
    let base = edit.oldContent;
    let text = current;
    for (let guard = 0; guard < 500; guard++) {
      const next = placeAll(base, edit.newContent, text).find((p) => p.place.kind !== "conflict");
      if (!next) break;
      const applied = applyToCurrent(base, text, next.hunk);
      if (applied === null) break;
      text = applied;
      base = acceptIntoBase(base, next.hunk);
    }
    updateProposal(path, { ...edit, oldContent: base });
    if (base !== edit.newContent) toast.warning(`Some changes to ${path} were kept back: they would write over edits made since.`);
    if (text !== current) await writeProjectFile(path, text);
  };

  const aiProposalActions = {
    acceptFile: (path: string) => void acceptAiFile(path),
    rejectFile: (path: string) => updateProposal(path, null),
    acceptHunk: (path: string, id: string) => void acceptAiHunk(path, id),
    rejectHunk: rejectAiHunk,
    acceptAll: () => {
      for (const e of aiPendingDiff?.edits ?? []) void acceptAiFile(e.path);
    },
    rejectAll: () => setAiPendingDiff(null),
  };

  const handleFolderCreate = async (path: string) => {
    if (!isAuthenticated || !canEdit) return;

    // Optimistic: add folder immediately with temp ID
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const optimisticFolder: ProjectFileItem = {
      id: tempId,
      path,
      type: "folder",
    };

    setFiles((prev) => [...prev, optimisticFolder]);

    try {
      const f = await projectsAPI.createFile(projectId, {
        path,
        isFolder: true,
        isMain: false,
      });
      const realId = f.id.toString();
      setFiles((prev) =>
        prev.map((file) =>
          file.id === tempId ? { ...file, id: realId, path: f.path } : file,
        ),
      );
    } catch (e) {
      // Rollback
      setFiles((prev) => prev.filter((file) => file.id !== tempId));
      toast.error("Failed to create folder");
    }
  };

  /** A file or folder takes a new path: a folder's contents go with it, and so does the compiler's entry point when it is the main document or inside the folder. The server does the same on its side. */
  const repath = (from: string, to: string) => {
    const moved = (path: string) => (path === from ? to : path.startsWith(from + "/") ? to + path.slice(from.length) : path);
    setFiles((prev) => prev.map((f) => (moved(f.path) === f.path ? f : { ...f, path: moved(f.path) })));
    setProjectSettings((prev) => (moved(prev.mainDocument) === prev.mainDocument ? prev : { ...prev, mainDocument: moved(prev.mainDocument) }));
  };

  const handleFileRename = async (id: string, newName: string) => {
    if (!isAuthenticated || !canEdit) return;
    const file = files.find((f) => f.id === id);
    if (!file) return;
    const dir = file.path.includes("/")
      ? file.path.substring(0, file.path.lastIndexOf("/") + 1)
      : "";
    const newPath = dir + newName;
    const oldPath = file.path;

    // The server first, then the tree. The live text is kept under the file's path, and the server moves it with the rename; asking for the new path before the rename has landed found nothing there, and the file opened empty (and was then saved empty).
    try {
      const fileIdNum = parseInt(id, 10);
      if (!isNaN(fileIdNum)) {
        await projectsAPI.updateFile(projectId, fileIdNum, {
          path: newPath,
        });
      }
      repath(oldPath, newPath);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Rename failed");
    }
  };

  /** Make a .tex file the document the compiler starts from. The API moves the file's own flag with the setting. */
  const handleSetMain = async (id: string) => {
    const file = files.find((f) => f.id === id);
    if (!file || !isAuthenticated || !canEdit) return;
    const before = projectSettings.mainDocument;
    setProjectSettings((prev) => ({ ...prev, mainDocument: file.path }));
    setFiles((prev) => prev.map((f) => ({ ...f, isMain: f.id === id })));
    try {
      await projectsAPI.updateProjectSettings(projectId, { mainDocument: file.path });
      toast.success(`${file.path} is now the main document`);
    } catch {
      setProjectSettings((prev) => ({ ...prev, mainDocument: before }));
      setFiles((prev) => prev.map((f) => ({ ...f, isMain: f.path === before })));
      toast.error("Could not change the main document");
    }
  };

  const handleFileDelete = async (id: string) => {
    if (!isAuthenticated || !canEdit) return;

    // Save for rollback
    const deletedFile = files.find((f) => f.id === id);
    const deletedContent = fileContents[id];

    // Optimistic: remove immediately
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (activeFileId === id) {
      const remaining = files.filter((f) => f.id !== id && f.type !== "folder");
      setActiveFileId(remaining[0]?.id || "main");
    }

    try {
      const fileIdNum = parseInt(id, 10);
      if (!isNaN(fileIdNum)) {
        await projectsAPI.deleteFile(projectId, fileIdNum);
      }
    } catch (e) {
      // Rollback
      if (deletedFile) {
        setFiles((prev) => [...prev, deletedFile]);
        if (deletedContent !== undefined) {
          setFileContents((prev) => ({ ...prev, [id]: deletedContent }));
        }
      }
      toast.error("Delete failed");
    }
  };

  const handleFileMove = async (id: string, targetFolderId: string | null) => {
    if (!isAuthenticated || !canEdit) return;
    const file = files.find((f) => f.id === id);
    if (!file) return;
    const targetFolder = targetFolderId
      ? files.find((f) => f.id === targetFolderId)
      : null;
    const fileName = file.path.split("/").pop()!;
    const newPath = targetFolder
      ? `${targetFolder.path}/${fileName}`
      : fileName;
    const oldPath = file.path;

    // The server first, then the tree, for the same reason as a rename.
    try {
      const fileIdNum = parseInt(id, 10);
      if (!isNaN(fileIdNum)) {
        await projectsAPI.updateFile(projectId, fileIdNum, {
          path: newPath,
        });
      }
      repath(oldPath, newPath);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Move failed");
    }
  };

  // ─── File Upload (sidebar dropzone, any file type) ───
  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!isAuthenticated || !canEdit) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const text = isText(file.name, bytes);
        const created = text
          ? await projectsAPI.createFile(projectId, {
              path: file.name,
              content: new TextDecoder().decode(bytes),
              isMain: false,
            })
          : await projectsAPI.uploadFile(projectId, file, file.name);
        const fileType: ProjectFileItem["type"] = /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)
          ? "image"
          : file.name.endsWith(".bib")
            ? "bib"
            : /\.(sty|cls)$/.test(file.name)
              ? "sty"
              : file.name.endsWith(".tex")
                ? "tex"
                : "other";
        const newFile: ProjectFileItem = {
          id: created.id.toString(),
          path: created.path,
          type: fileType,
          binary: !text,
        };
        setFiles((prev) => [...prev.filter((f) => f.path !== created.path), newFile]);
        if (text) {
          setFileContents((prev) => ({ ...prev, [newFile.id]: created.content ?? "" }));
        }
        toast.success(`Uploaded ${file.name}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Failed to upload ${file.name}`);
      }
    },
    [isAuthenticated, canEdit, projectId],
  );

  // ─── Image Drop into Editor ───
  const [editorDragOver, setEditorDragOver] = useState(false);

  const handleEditorImageDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setEditorDragOver(false);
      if (!canEdit) return;

      // ── Case 1: Internal drag from the file tree (image already uploaded) ──
      const treeImagePath = e.dataTransfer.getData("treeimagepath");
      if (treeImagePath) {
        const baseName =
          treeImagePath
            .split("/")
            .pop()
            ?.replace(/\.[^.]+$/, "") ?? "image";
        const fileName = treeImagePath.split("/").pop() ?? treeImagePath;
        compose(
          `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{${treeImagePath}}\n  \\caption{}\n  \\label{fig:${baseName}}\n\\end{figure}`,
        );
        toast.success(`Inserted figure: ${fileName}`);
        return;
      }

      // ── Case 2: OS file drop (new image, needs uploading) ──
      if (!isAuthenticated) return;
      const imageFiles = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (!imageFiles.length) return;
      for (const file of imageFiles) {
        try {
          const created = await projectsAPI.uploadFile(projectId, file, file.name);
          const newFile: ProjectFileItem = {
            id: created.id.toString(),
            path: created.path,
            type: "image",
            binary: true,
          };
          setFiles((prev) => [...prev.filter((f) => f.path !== created.path), newFile]);
          // Insert LaTeX reference at cursor
          const baseName = file.name.replace(/\.[^.]+$/, "");
          compose(
            `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{${file.name}}\n  \\caption{}\n  \\label{fig:${baseName}}\n\\end{figure}`,
          );
          toast.success(`Inserted figure: ${file.name}`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : `Failed to add ${file.name}`);
        }
      }
    },
    [isAuthenticated, canEdit, projectId, compose],
  );

  // ─── Render Helpers ───
  const activeFileItem = files.find((f) => f.id === activeFileId) ?? null;
  const activePath = useMemo(
    () => files.find((f) => f.id === activeFileId)?.path || null,
    [files, activeFileId],
  );

  // ─── Review (comments and suggested changes) and the project chat ───
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  // The comment being written and the thread open over the text, shared by the review panel and the comment popover (components/editor/review).
  const [reviewStore] = useState(() => new ReviewStore(editorRef));
  // A thread picked in another file is shown once that file is open.
  const pendingRevealRef = useRef<number | null>(null);

  const loadThreads = useCallback(() => {
    if (!isAuthenticated) return;
    collabAPI.comments(projectId).then(setThreads).catch(() => {});
  }, [isAuthenticated, projectId]);
  const replaceThread = useCallback((t: CommentThread) => {
    setThreads((prev) => [...prev.filter((x) => x.id !== t.id), t]);
  }, []);

  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatMore, setChatMore] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const loadChat = useCallback(
    async (before?: number) => {
      setChatLoading(true);
      try {
        const page = await collabAPI.chat(projectId, before);
        setChat((prev) => {
          const merged = before ? [...page.messages, ...prev] : [...page.messages, ...prev.filter((m) => !page.messages.some((x) => x.id === m.id))];
          return merged.sort((a, b) => a.id - b.id);
        });
        setChatMore(page.hasMore);
      } catch {
        toast.error("Could not load the chat");
      } finally {
        setChatLoading(false);
      }
    },
    [projectId],
  );
  // Whenever the chat is on screen, however it got there (its toolbar button, the View menu, a tab brought to the front, a restored layout), nothing in it is unread, and its history is loaded once.
  const chatRequestedRef = useRef(false);
  useEffect(
    () =>
      dock.subscribe(() => {
        if (!dock.getSnapshot().visible.includes("chat")) return;
        setChatUnread(0);
        if (chatRequestedRef.current) return;
        chatRequestedRef.current = true;
        void loadChat();
      }),
    [dock, loadChat],
  );

  // Comments and chat arrive on the live connection; after a reconnect the
  // comments are fetched again in case something was missed.
  useEffect(() => {
    if (connected) loadThreads();
    const socket = socketRef.current;
    if (!socket) return;
    const onComments = () => loadThreads();
    const onChat = (m: ChatMessage) => {
      setChat((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (!dock.getSnapshot().visible.includes("chat") && m.userId !== user?.id) setChatUnread((n) => n + 1);
    };
    socket.on("comments-changed", onComments);
    socket.on("chat-message", onChat);
    return () => {
      socket.off("comments-changed", onComments);
      socket.off("chat-message", onChat);
    };
  }, [connected, socketRef, loadThreads, user?.id, dock]);

  const fileComments = useMemo(
    () =>
      threads
        .filter((t) => t.path === activePath && !t.resolved)
        .map((t) => ({ id: t.id, anchorStart: t.anchorStart, anchorEnd: t.anchorEnd, quote: t.quote, offset: t.offset, hue: t.color })),
    [threads, activePath],
  );
  // A thread picked in another file: shown once that file's highlights are in.
  useEffect(() => {
    const id = pendingRevealRef.current;
    if (id !== null && editorRef.current?.revealComment(id)) pendingRevealRef.current = null;
  }, [fileComments]);
  // A comment started or a thread opened from the text goes to the Review panel when it is open: its tab comes to the front of its group (behind Axya by default) and keyboard focus stays in the editor. Closed, hidden by a maximized group, or on a narrow screen, where it would cover the editor, the popover over the text is used instead.
  const reviewToFront = useCallback((): boolean => {
    const now = dock.getSnapshot();
    if (now.visible.includes("review")) return true;
    if (!now.open.includes("review") || now.maximized !== null || now.narrow) return false;
    dock.show("review");
    return true;
  }, [dock]);
  const reviewProps = useMemo<ReviewProps | null>(
    () =>
      user
        ? {
            // There is no suggesting mode: a suggestion is made on a selection ("Suggest" beside it), one change at a time.
            suggesting: false,
            user: { id: user.id, name: user.name || "Someone" },
            onSuggestionsChange: setSuggestions,
            comments: fileComments,
            activeCommentId: activeThreadId,
            // With the review panel open a highlight selects its card there (its tab comes to the front); otherwise its thread opens over the text.
            onCommentClick: (id: number) => {
              setActiveThreadId(id);
              if (!reviewToFront()) reviewStore.openThread(id);
            },
            onCommentShortcut: () => {
              if (!editorRef.current?.getCommentTarget()) return void toast("Select the text you want to comment on first.");
              reviewStore.compose(reviewToFront() ? "panel" : "popover");
            },
            onSelectionChange: () => reviewStore.selectionChanged(),
          }
        : null,
    [user, fileComments, activeThreadId, reviewToFront, reviewStore],
  );
  // Everyone who can be mentioned in a comment: the owner, the collaborators, and the reader.
  const reviewPeople = useMemo<Person[]>(() => {
    const seen = new Map<number, Person>();
    const add = (p: { id: number; name: string | null; avatarUrl?: string | null } | null | undefined) => {
      if (p && p.name && !seen.has(p.id)) seen.set(p.id, { id: p.id, name: p.name, avatarUrl: p.avatarUrl ?? null });
    };
    add(owner);
    for (const c of collaborators) add(c.user);
    if (user) add({ id: user.id, name: user.name ?? null, avatarUrl: user.avatarUrl ?? null });
    return [...seen.values()];
  }, [owner, collaborators, user]);
  const openReviewCount =
    threads.filter((t) => t.path === activePath && !t.resolved).length + suggestions.length;

  const reviewActions = {
    onCreateComment: async (target: CommentTarget, content: string, hue: CommentHue) => {
      if (!activePath) return null;
      try {
        const t = await collabAPI.addComment(projectId, {
          path: activePath,
          anchorStart: target.anchorStart,
          anchorEnd: target.anchorEnd,
          quote: target.quote,
          offset: target.from,
          content,
          color: hue,
        });
        replaceThread(t);
        setActiveThreadId(t.id);
        return t;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not add the comment");
        return null;
      }
    },
    onSetColor: (threadId: number, hue: string) => {
      collabAPI
        .setColor(projectId, threadId, hue)
        .then(replaceThread)
        .catch((e) => toast.error(e instanceof Error ? e.message : "Could not change the color"));
    },
    onReply: async (threadId: number, content: string) => {
      try {
        replaceThread(await collabAPI.reply(projectId, threadId, content));
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not send the reply");
        return false;
      }
    },
    onResolve: (threadId: number, resolved: boolean) => {
      collabAPI
        .resolve(projectId, threadId, resolved)
        .then(replaceThread)
        .catch((e) => toast.error(e instanceof Error ? e.message : "Could not change the comment"));
    },
    onDeleteThread: (threadId: number) => {
      collabAPI
        .deleteThread(projectId, threadId)
        .then(() => setThreads((prev) => prev.filter((t) => t.id !== threadId)))
        .catch((e) => toast.error(e instanceof Error ? e.message : "Could not delete the comment"));
    },
    onEditMessage: async (messageId: number, content: string) => {
      try {
        replaceThread(await collabAPI.editMessage(projectId, messageId, content));
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save the comment");
        return false;
      }
    },
    onDeleteMessage: (messageId: number) => {
      collabAPI
        .deleteMessage(projectId, messageId)
        .then(loadThreads)
        .catch((e) => toast.error(e instanceof Error ? e.message : "Could not delete the comment"));
    },
    onSettle: (ids: string[] | "all", action: "accept" | "reject") => {
      const n = editorRef.current?.settleSuggestions(ids, action) ?? 0;
      if (ids === "all" && n > 0) toast.success(`${action === "accept" ? "Accepted" : "Rejected"} ${n} suggestion${n === 1 ? "" : "s"}`);
    },
    onRevealSuggestion: (s: Suggestion) => editorRef.current?.revealRange(s.from, s.kind === "insert" ? s.to : s.from),
    onSelectThread: (id: number | null) => {
      setActiveThreadId(id);
      if (id === null) return;
      const thread = threads.find((t) => t.path !== activePath && t.id === id);
      const file = thread ? files.find((f) => f.path === thread.path) : undefined;
      if (file) {
        pendingRevealRef.current = id;
        setActiveFileId(file.id);
        return;
      }
      editorRef.current?.revealComment(id);
    },
  };

  // A GitHub pull (here or by the owner elsewhere) changed files: reload the
  // list and the text of files not being edited live.
  useEffect(() => {
    liveRef.current = !!yjsExtension && connected;
  }, [yjsExtension, connected]);
  const reloadFiles = useCallback(async () => {
    try {
      const list = await projectsAPI.getFiles(projectId);
      const items = toFileItems(list);
      setFiles(items);
      setFileContents((prev) => {
        const next = { ...prev };
        for (const f of list) {
          if (f.isFolder || f.filePath) continue;
          const id = f.id.toString();
          // Versions always follow the server, or the next save would be
          // refused as a conflict; live text comes from the shared document.
          if (typeof f.version === "number") fileVersionsRef.current.set(id, f.version);
          if (id === activeFileIdRef.current && liveRef.current) continue;
          next[id] = f.content ?? "";
        }
        return next;
      });
      if (!items.some((f) => f.id === activeFileIdRef.current)) {
        const main = items.find((f) => f.isMain) ?? items.find((f) => f.type !== "folder");
        if (main) setActiveFileId(main.id);
      }
    } catch {
      toast.error("Could not reload the project's files");
    }
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onFiles = (change?: { reason?: string; by?: number }) => {
      // Our own create, rename, move, or delete is already on screen.
      if (change?.reason === "tree" && change.by === user?.id) return;
      void reloadFiles();
      if (change?.reason === "github-pull") toast("Files changed after a pull from GitHub");
    };
    socket.on("files-changed", onFiles);
    return () => {
      socket.off("files-changed", onFiles);
    };
  }, [connected, socketRef, reloadFiles, user?.id]);

  // Every text file's latest text, for \cite and \ref completion and the
  // reference dialog. The open file's text comes from the editor itself.
  const fileContentsRef = useRef(fileContents);
  const activePathRef = useRef(activePath);
  useEffect(() => {
    fileContentsRef.current = fileContents;
    activePathRef.current = activePath;
  }, [fileContents, activePath]);
  const projectIndex = useMemo(
    () => ({
      otherFiles: () =>
        filesRef.current
          .filter((f) => !f.binary && f.type !== "folder")
          .map((f) => ({ path: f.path, text: fileContentsRef.current[f.id] ?? "" })),
      activePath: () => activePathRef.current,
    }),
    [],
  );
  // Images the document includes, shown in visual mode. \includegraphics
  // often leaves the extension out.
  const imageUrl = useCallback(
    (path: string) => {
      const clean = path.replace(/^\.\//, "");
      const file = filesRef.current.find(
        (f) => f.binary && /\.(png|jpe?g|gif|webp)$/i.test(f.path) && (f.path === clean || f.path.replace(/\.[^.]+$/, "") === clean),
      );
      return file ? projectsAPI.rawFileUrl(projectId, file.id) : null;
    },
    [projectId],
  );

  const wordCountFiles = useCallback(() => {
    const map = new Map<string, string>();
    for (const f of projectIndex.otherFiles()) map.set(f.path, f.text);
    const active = activePathRef.current;
    if (active && !activeFileItem?.binary) map.set(active, editorRef.current?.getContent() ?? map.get(active) ?? "");
    return map;
  }, [projectIndex, activeFileItem]);
  // The .bib files as they are when the reference dialog opens.
  const [bibFiles, setBibFiles] = useState<{ path: string; text: string }[]>([]);
  const openAddReference = () => {
    setBibFiles(
      files
        .filter((f) => f.path.toLowerCase().endsWith(".bib") && !f.binary)
        .map((f) => ({
          path: f.path,
          text: f.id === activeFileId ? (editorRef.current?.getContent() ?? "") : (fileContents[f.id] ?? ""),
        })),
    );
    setShowAddReference(true);
  };

  const sendChat = useCallback(
    async (content: string) => {
      try {
        const m = await collabAPI.postChat(projectId, content);
        setChat((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not send the message");
        return false;
      }
    },
    [projectId],
  );
  // The proposal for the open file, placed on its text as it is now: the editor shows each change in place, with Accept and Reject, while the file stays editable.
  const pendingEdit = useMemo(() => (activePath && canEdit ? (aiPendingDiff?.edits.find((e) => e.path === activePath && !e.created && !e.deleted) ?? null) : null), [activePath, aiPendingDiff, canEdit]);
  const diffHighlights = useMemo(() => {
    if (!pendingEdit) return null;
    const placed = placeAll(pendingEdit.oldContent, pendingEdit.newContent, currentContent);
    return {
      hunks: placed
        .filter((p) => p.place.kind !== "applied")
        .map(({ hunk, place }) => ({
          id: hunk.id,
          start: place.kind === "clean" ? place.start : Math.min(hunk.oldStart, currentContent.split("\n").length),
          removeCount: place.kind === "clean" ? hunk.oldLines.length : 0,
          added: hunk.newLines,
          state: place.kind === "clean" ? ("clean" as const) : ("conflict" as const),
        })),
    };
  }, [pendingEdit, currentContent]);

  // ─── History ───
  const historyFilePaths = useMemo(() => files.filter((f) => f.type !== "folder").map((f) => f.path), [files]);
  const showHistoryFor = useStableCallback((path: string) => {
    setHistoryFocus((prev) => ({ paths: [path], seq: (prev?.seq ?? 0) + 1 }));
    dock.show("history");
  });
  const onHistoryOpenFile = useStableCallback((path: string) => {
    const file = files.find((f) => f.path === path && f.type !== "folder");
    if (file) setActiveFileId(file.id);
  });
  // The server has restored a version, through the live document when the file is open there (everyone's editor follows that on its own). This browser brings its own copy up to date: the text where nothing live carries it, and the stored version, so its next save is not refused as a conflict. A file made again arrives with the reload every browser does on the restore's announcement.
  const onHistoryRestored = useStableCallback((result: HistoryRestoreResult) => {
    // A deleted file made again: the file list is read again here too, not only when the announcement arrives, so the restorer sees it even if their live connection is down.
    if (result.created) void reloadFiles();
    const file = files.find((f) => f.path === result.filePath && f.type !== "folder");
    if (!file) return;
    if (typeof result.fileVersion === "number") rememberVersion(file.id, result.fileVersion);
    setFileContents((prev) => ({ ...prev, [file.id]: result.content }));
    if (!result.live && file.id === activeFileIdRef.current) editorRef.current?.setValue(result.content);
  });

  // ─── Panels ───
  // Handlers for the memoised panels and palettes (the file tree, the outline, the formatting bar, the palettes): the same function on every render, running the latest code, so a keystroke does not redraw them (see useStableCallback).
  const onFileCreate = useStableCallback(handleFileCreate);
  const onFolderCreate = useStableCallback(handleFolderCreate);
  const onFileRename = useStableCallback(handleFileRename);
  const onFileDelete = useStableCallback(handleFileDelete);
  const onFileMove = useStableCallback(handleFileMove);
  const onSetMain = useStableCallback(handleSetMain);
  const onFileUpload = useStableCallback(handleFileUpload);
  // The Contents outline reads every text file, so a chapter in its own file is numbered where the main file puts it.
  const outlineSources = useMemo(() => Object.fromEntries(files.filter((f) => f.type !== "folder" && !f.binary).map((f) => [f.path, fileContents[f.id] ?? ""])), [files, fileContents]);
  // A heading in another file opens that file first, then goes to the line once the editor has it.
  const onJumpToHeading = useStableCallback((path: string, line: number) => {
    const target = files.find((f) => f.path === path && f.type !== "folder");
    if (!target || target.id === activeFileId) {
      editorRef.current?.gotoLine(line);
      return;
    }
    setActiveFileId(target.id);
    setTimeout(() => editorRef.current?.gotoLine(line), 80);
  });
  const onToggleDrawing = useStableCallback(() => {
    setShowDrawing(true);
    dock.show("pdf");
  });
  const onAddReference = useStableCallback(openAddReference);
  const onOpenCommandPalette = useStableCallback(() => setShowCommandPalette(true));
  const onOpenInsertPalette = useStableCallback(() => {
    setInsertPaletteCoords(editorRef.current?.getCursorCoords() ?? null);
    setShowInsertPalette(true);
  });
  // Every action the command palette (Ctrl+K) lists; it is also the keyboard's way to open and close each panel.
  const onPaletteAction = useStableCallback((action: string) => {
    if (action === "compile") compileAfterSaving();
    else if (action === "save") void handleSave();
    else if (action === "ai") showAssistant();
    else if (action === "toggleAssistant") toggleAssistant();
    else if (action === "toggleFileTree") dock.toggle("files");
    else if (action === "togglePdf") dock.toggle("pdf");
    else if (action === "toggleLogs") dock.toggle("logs");
    else if (action === "toggleReview") dock.toggle("review");
    else if (action === "fileHistory") {
      if (activePath) showHistoryFor(activePath);
      else dock.show("history");
    }
    else if (action === "toggleChat") dock.toggle("chat");
    else if (action === "resetLayout") dock.reset();
    else if (action === "toggleDrawing") onToggleDrawing();
    else if (action === "openSettings") setShowSettings(true);
    setShowCommandPalette(false);
  });
  const getCursorCoords = useStableCallback(() => editorRef.current?.getCursorCoords() ?? null);
  const onInsertTikz = useStableCallback(insertTikzTemplate);

  // What each dock panel shows. The dock decides where a panel sits and whether it is open; these decide only its content, from the state above.
  const panels: Record<PanelId, ReactNode> = {
    files: (
      <ErrorBoundary label="Files">
        <FileTree
          files={files}
          activeFileId={activeFileId}
          mainPath={projectSettings.mainDocument}
          onSetMain={canEdit ? onSetMain : undefined}
          onShowHistory={showHistoryFor}
          onFileSelect={setActiveFileId}
          onFileCreate={onFileCreate}
          onFolderCreate={onFolderCreate}
          onFileRename={onFileRename}
          onFileDelete={onFileDelete}
          onFileMove={onFileMove}
          onImageUpload={onFileUpload}
          remoteUsers={remoteUsers}
          initialExpandedFolderIds={expandedFolderIdsRef.current}
          onExpandedFoldersChange={handleExpandedFoldersChange}
        />
      </ErrorBoundary>
    ),
    contents: (
      <ErrorBoundary label="Contents">
        <TableOfContents sources={outlineSources} mainPath={projectSettings.mainDocument || null} activePath={activePath} onJump={onJumpToHeading} />
      </ErrorBoundary>
    ),
    references: (
      <ErrorBoundary label="References">
        <ReferencesPanel projectId={projectId} />
      </ErrorBoundary>
    ),
    history: (
      <ErrorBoundary label="History">
        <HistoryPanel
          projectId={projectId}
          dock={dock}
          canEdit={!!canEdit}
          currentUserId={user?.id ?? null}
          revision={historyRevision}
          focus={historyFocus}
          filePaths={historyFilePaths}
          onOpenFile={onHistoryOpenFile}
          onRestored={onHistoryRestored}
        />
      </ErrorBoundary>
    ),
    editor: (
      <div className="flex flex-col h-full">
        <EditorRibbon
          onInsertSnippet={handleInsertSnippet}
          editorThemeId={editorThemeId}
          onEditorThemeChange={updateEditorTheme}
          onToggleDrawing={onToggleDrawing}
          onAddReference={canEdit ? onAddReference : undefined}
          onInsertTikz={canEdit ? onInsertTikz : undefined}
          editorMode={editorMode}
          onEditorModeChange={setEditorMode}
          onOpenCommandPalette={onOpenCommandPalette}
          onOpenInsertPalette={onOpenInsertPalette}
        />
        <div
          className="flex-1 min-h-0 flex flex-col relative"
          onDragOver={(e) => {
            const types = e.dataTransfer.types;
            const isImageDrop =
              types.includes("treeimagepath") || // browsers lowercased custom keys
              types.includes("treeImagePath") ||
              Array.from(e.dataTransfer.items).some((i) =>
                i.type.startsWith("image/"),
              );
            if (isImageDrop) {
              e.preventDefault();
              setEditorDragOver(true);
            }
          }}
          onDragLeave={(e) => {
            // Only clear when truly leaving this container
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setEditorDragOver(false);
            }
          }}
        >
          {/*
            Drop intercept overlay: rendered ABOVE CodeMirror (z-20) with pointer-events-auto.
            CodeMirror captures drops on its own canvas first; by placing a real interactive
            overlay on top we ensure our handler fires, not CodeMirror's.
          */}
          {editorDragOver && (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center bg-accent/10 border-2 border-dashed border-accent rounded-md"
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setEditorDragOver(false);
                }
              }}
              onDrop={handleEditorImageDrop}
            >
              <p className="text-sm font-medium text-foreground pointer-events-none">
                Drop image
              </p>
            </div>
          )}

          {activeFileItem?.binary ? (
            <BinaryPreview projectId={projectId} fileId={activeFileItem.id} path={activeFileItem.path} />
          ) : (
          <ErrorBoundary label="The editor" resetKeys={[activeFileId]}>
            <LatexEditor
              key={activeFileId}
              ref={editorRef}
              value={currentContent}
              onChange={canEdit ? handleContentChange : undefined}
              onSave={canEdit ? () => handleSave() : undefined}
              onCompile={compileAfterSaving}
              themeId={editorThemeId}
              readOnly={!canEdit}
              onCursorActivity={(line, ch, selection) => {
                emitCursorMove(line, ch, selection);
                // The assistant shows which lines are selected, to send them with a question.
                noteEditorSelection(selection);
              }}
              remoteCursors={remoteUsers
                .filter(
                  (u) => u.activeFile === activePath && u.cursor != null,
                )
                .map((u) => ({
                  userId: u.userId,
                  name: u.name,
                  color: u.color,
                  line: u.cursor!.line,
                  ch: u.cursor!.ch,
                }))}
              diffHighlights={diffHighlights}
              onHunkAction={(id, action) => {
                if (!activePath) return;
                if (action === "accept") void acceptAiHunk(activePath, id);
                else rejectAiHunk(activePath, id);
              }}
              fontSize={editorSettings?.fontSize}
              fontFamily={editorSettings?.fontFamily}
              lineHeight={editorSettings?.lineHeight}
              autoComplete={editorSettings?.autoComplete ?? true}
              autoCloseBrackets={editorSettings?.autoCloseBrackets ?? true}
              codeCheck={editorSettings?.codeCheck ?? true}
              spellLang={editorSettings && !activePath?.toLowerCase().endsWith(".bib") ? dictionaryFor(editorSettings.spellcheckLang) : null}
              personalWords={personalWords}
              onAddWord={canEdit ? addToDictionary : undefined}
              autoIndent={editorSettings?.autoIndent ?? false}
              tabSize={projectSettings.tabSize ?? 4}
              isMainFile={activePath === projectSettings.mainDocument}
              yjsExtension={yjsExtension}
              yjsText={ytext}
              initialViewState={editorViewStateRef.current.get(
                activeFileId,
              )}
              onSaveViewState={(s) =>
                editorViewStateRef.current.set(activeFileId, s)
              }
              review={reviewProps}
              projectIndex={projectIndex}
              visual={editorMode === "visual"}
              imageUrl={imageUrl}
              onOpenFile={openFileByPath}
            />
          </ErrorBoundary>
          )}
        </div>
      </div>
    ),
    pdf: (
      <div className="flex h-full flex-col bg-background">
        {showDrawing ? (
          <ErrorBoundary label="The drawing canvas">
            <DrawingPanel
              onInsertCode={handleInsertSnippet}
              onClose={() => setShowDrawing(false)}
            />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary
            label="The PDF preview"
            resetKeys={[buildKey, pdfUrl]}
          >
            <PdfPreview
            pdfUrl={pdfUrl}
            buildKey={buildKey}
            projectId={projectId}
            isAuthenticated={isAuthenticated}
            fileName={title}
            synctexData={synctexData}
            mainFile={projectSettings.mainDocument}
            isCompiling={isCompiling}
            errors={compileErrors}
            onCompile={compileAfterSaving}
            pdfTheme={editorSettings?.pdfTheme}
            autoCompile={projectSettings.autoCompile}
            onToggleAutoCompile={() => {
              const next = !projectSettings.autoCompile;
              setProjectSettings((prev) => ({
                ...prev,
                autoCompile: next,
              }));
              if (isAuthenticated)
                projectsAPI
                  .updateProjectSettings(projectId, {
                    autoCompile: next,
                  })
                  .catch(console.error);
            }}
            compileMode={projectSettings.compileMode}
            onCompileModeChange={(mode) => {
              setProjectSettings((prev) => ({
                ...prev,
                compileMode: mode,
              }));
              if (isAuthenticated)
                projectsAPI
                  .updateProjectSettings(projectId, {
                    compileMode: mode,
                  })
                  .catch(console.error);
            }}
            stopOnFirstError={projectSettings.stopOnFirstError}
            onToggleStopOnFirstError={() => {
              const next = !projectSettings.stopOnFirstError;
              setProjectSettings((prev) => ({
                ...prev,
                stopOnFirstError: next,
              }));
              if (isAuthenticated)
                projectsAPI
                  .updateProjectSettings(projectId, {
                    stopOnFirstError: next,
                  })
                  .catch(console.error);
            }}
            onRecompileFromScratch={compileAfterSaving}
            sourceFiles={Object.fromEntries(
              files
                .filter((f) => f.type !== "folder")
                .map((f) => [f.path, fileContents[f.id] ?? ""]),
            )}
            onSourceJump={(line, filePath, word) => {
              // Switch to the file that contains the match
              const targetFile = files.find(
                (f) => f.path === filePath,
              );
              if (targetFile && targetFile.id !== activeFileId) {
                setActiveFileId(targetFile.id);
                // Give React a tick to mount the new file in the editor
                setTimeout(
                  () =>
                    editorRef.current?.gotoLineWord(line, word),
                  80,
                );
              } else {
                editorRef.current?.gotoLineWord(line, word);
              }
            }}
          />
          </ErrorBoundary>
        )}
      </div>
    ),
    logs: (
      <ErrorBoundary label="Logs">
        <ErrorLog logs={logs} onClear={() => setLogs([])} />
      </ErrorBoundary>
    ),
    review: (
      <ErrorBoundary label="Review">
        <ReviewPanel
          store={reviewStore}
          onOpenFile={openFileByPath}
          people={reviewPeople}
          path={activePath}
          threads={threads}
          suggestions={suggestions}
          userId={user?.id ?? null}
          isOwner={isOwner}
          canEdit={canEdit}
          live={!!yjsExtension}
          activeThreadId={activeThreadId}
          {...reviewActions}
        />
      </ErrorBoundary>
    ),
    chat: (
      <ErrorBoundary label="Chat">
        <ChatPanel
          messages={chat}
          hasMore={chatMore}
          loading={chatLoading}
          userId={user?.id ?? null}
          people={reviewPeople}
          onLoadMore={() => void loadChat(chat[0]?.id)}
          onSend={sendChat}
        />
      </ErrorBoundary>
    ),
    // The assistant fills its panel (the dock's tab names it). Floating, the same mounted tree draws itself over the editor through a portal (see AiChatPanel).
    assistant: (
      <div className="h-full bg-panel">
        <div className="h-full">
          <ErrorBoundary label="AI chat">
            <AiChatPanel
              onToggle={toggleAssistant}
              onSend={handleAiSend}
              onClear={() => setAiTurns([])}
              turns={aiTurns}
              history={{
                conversations: aiHistory.conversations,
                currentId: aiHistory.currentId,
                onOpen: aiHistory.open,
                onDelete: (conversation) => {
                  const wasCurrent = aiHistory.currentId === conversation.id;
                  aiHistory.remove(conversation.id);
                  toast("Conversation deleted", { action: { label: "Undo", onClick: () => aiHistory.restore(conversation, wasCurrent) } });
                },
              }}
              status={aiStatus}
              model={aiHistory.model}
              onModelChange={aiHistory.setModel}
              onOpenSettings={() => {
                setSettingsTab("assistant");
                setShowSettings(true);
              }}
              hasCompileErrors={compileErrors.length > 0}
              diff={aiPendingDiff}
              currentText={(path) => {
                const file = files.find((f) => f.path === path && f.type !== "folder");
                return file ? (fileContents[file.id] ?? "") : null;
              }}
              proposal={aiProposalActions}
              onDictation={toggleDictation}
              filePaths={aiFilePaths}
              activeFilePath={activePath ?? undefined}
              onFileSelect={openFileByPath}
              onOpenReferences={() => dock.show("references")}
            />
          </ErrorBoundary>
        </div>
      </div>
    ),
  };

  const panelTitles = useMemo(() => (showDrawing ? { pdf: "Drawing" } : undefined), [showDrawing]);
  const panelBadges = useMemo(
    () => ({
      review: openReviewCount > 0 ? <TabBadge label={`${openReviewCount} open in this file`}>{openReviewCount > 99 ? "99+" : openReviewCount}</TabBadge> : null,
      chat: chatUnread > 0 ? <TabBadge label={`${chatUnread} new`}>{chatUnread > 99 ? "99+" : chatUnread}</TabBadge> : null,
      logs: compileErrors.length > 0 ? <TabBadge label={`${compileErrors.length} ${compileErrors.length === 1 ? "error" : "errors"}`} tone="danger">{compileErrors.length > 99 ? "99+" : compileErrors.length}</TabBadge> : null,
    }),
    [openReviewCount, chatUnread, compileErrors.length],
  );

  return (
    <div className="flex flex-col h-full w-full bg-background">
      <ProjectToolbar
        projectTitle={title}
        onTitleChange={canEdit ? handleTitleChange : undefined}
        onSave={() => handleSave()}
        onDownloadPdf={pdfUrl ? handleDownloadPdf : undefined}
        onOpenShortcuts={() => setShowShortcuts(true)}
        onShowTutorial={tour.show}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
        onInsertSnippet={
          canEdit ? (t: string) => handleInsertSnippet(t) : undefined
        }
        workspace={workspace}
        assistant={{ form: assistantForm, on: assistantOn, toggle: toggleAssistant, setForm: setAssistantForm }}
        onOpenSettings={() => setShowSettings(true)}
        onCompile={compileAfterSaving}
        onDownloadSource={handleDownloadZip}
        onSaveAsTemplate={canEdit ? () => setShowSaveTemplate(true) : undefined}
        onOpenGithub={() => setShowGithub(true)}
        onOpenWordCount={() => setShowWordCount(true)}
        onShowFileHistory={activePath ? () => showHistoryFor(activePath) : undefined}
        reviewCount={openReviewCount}
        chatUnread={chatUnread}
        logErrors={compileErrors.length}
        onBack={onBack}
        onShareClick={() => setShowShareDialog(true)}
        canEdit={canEdit}
        collaborators={collaborators}
        owner={owner}
        remoteUsers={remoteUsers}
        saveStatus={saveStatus}
        referenceOf={referenceOf}
      />

      <CommandPalette
        open={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        search={commandSearch}
        setSearch={setCommandSearch}
        onAction={onPaletteAction}
        onInsert={canEdit ? handleInsertSnippet : undefined}
        onInsertTikz={canEdit ? onInsertTikz : undefined}
      />

      <InsertPalette
        open={showInsertPalette}
        onOpenChange={setShowInsertPalette}
        onInsert={handleInsertSnippet}
        onInsertTikz={canEdit ? onInsertTikz : undefined}
        cursorCoords={insertPaletteCoords}
        getCursorCoords={getCursorCoords}
      />

      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />

      <WordCountDialog
        open={showWordCount}
        onOpenChange={setShowWordCount}
        mainPath={projectSettings.mainDocument || "main.tex"}
        files={wordCountFiles}
      />

      <AddReferenceDialog
        open={showAddReference}
        onOpenChange={setShowAddReference}
        projectId={projectId}
        bibFiles={bibFiles}
        canCite={!!activePath?.endsWith(".tex") && canEdit && !activeFileItem?.binary}
        onAdded={({ key, cite }) => {
          if (cite) editorRef.current?.insertAtCursor(`\\cite{${key}}`);
          void reloadFiles();
        }}
      />

      <GithubDialog
        open={showGithub}
        onOpenChange={setShowGithub}
        projectId={projectId}
        beforeSync={canEdit ? () => handleSave() : undefined}
        onPulled={() => void reloadFiles()}
      />

      <SaveTemplateDialog
        open={showSaveTemplate}
        onOpenChange={setShowSaveTemplate}
        projectId={projectId}
        projectTitle={title}
        beforeSave={() => handleSave()}
      />

      <ShareDialog
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        projectUid={projectId}
        projectTitle={title}
        isOwner={isOwner}
        collaborators={collaborators}
        pendingInvitations={pendingInvitations}
        onCollaboratorsChange={refreshCollaborators}
        initialAccess={initialAccess}
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        <DockWorkspace workspace={workspace} panels={panels} titles={panelTitles} badges={panelBadges} mounted={assistantFloating ? FLOATING_ASSISTANT : undefined} />
        <EditorTour open={tour.open} onClose={tour.close} />
        {user && (
          <CommentLayer
            store={reviewStore}
            editor={editorRef}
            path={activePath}
            threads={threads}
            people={reviewPeople}
            userId={user.id}
            isOwner={isOwner}
            canEdit={canEdit}
            reviewToFront={reviewToFront}
            canSuggest={canEdit && !!yjsExtension}
            onCreate={reviewActions.onCreateComment}
            {...reviewActions}
          />
        )}
      </div>
      {/* Floating, the assistant draws its own dock over the editor; its panel's element only needs somewhere to live, and takes no room. */}
      {assistantFloating && <PanelSlot workspace={workspace} id="assistant" className="hidden" />}

      <SettingsDialog
        open={showSettings}
        onOpenChange={(open) => {
          setShowSettings(open);
          if (!open) {
            setSettingsTab("editor");
            refreshAiStatus();
          }
        }}
        initialTab={settingsTab}
        onOpenDictionary={() => setShowDictionary(true)}
        projectUid={projectId}
        projectFiles={files}
        onEditorSettingsChange={(s) => {
          setEditorSettings(s);
          // The theme chosen in Settings applies at once (the dialog has already saved it).
          if (s.editorTheme && s.editorTheme !== editorThemeId) updateEditorTheme(s.editorTheme);
        }}
        onProjectSettingsChange={(s) => setProjectSettings(s)}
        onReindentProject={reindentProject}
      />
      <DictionaryDialog
        open={showDictionary}
        onOpenChange={setShowDictionary}
      />
    </div>
  );
}

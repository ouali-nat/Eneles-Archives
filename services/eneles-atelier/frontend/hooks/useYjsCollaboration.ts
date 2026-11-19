"use client";

import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from "react";
import type { Socket } from "socket.io-client";
import * as Y from "yjs";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { suggestionsMap } from "@/lib/review/anchors";
import { keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";

// ─── Types ───

/** Bytes as they arrive: binary from current servers (an ArrayBuffer in the browser), an array of numbers from older ones. `new Uint8Array(…)` reads both. */
type Bytes = ArrayBuffer | Uint8Array | number[];

/** How long cursor and selection changes are gathered before they are sent to the others. */
const AWARENESS_INTERVAL_MS = 80;

export interface UseYjsCollaborationOptions {
  /** Shared socket ref from useCollaboration: MUST be the same socket, no duplicate connections */
  socketRef: React.RefObject<Socket | null>;
  /** Whether the shared socket is connected */
  socketConnected: boolean;
  /** Current file path (e.g. "main.tex"): switches the active Y.Text binding */
  activeFile: string | null;
  /** Current user info for awareness (cursors) */
  currentUserId?: number | null;
  currentUserName?: string;
  currentUserColor?: string;
  enabled?: boolean;
}

export interface UseYjsCollaborationReturn {
  /** CodeMirror extension array: yCollab + awareness cursors + undo keymap, for the ACTIVE file */
  yjsExtension: Extension | null;
  /** Whether the active file has synced with the server */
  synced: boolean;
  /** The Y.Text bound to the active file (null until that file has synced) */
  ytext: Y.Text | null;
  /** Writes a file's whole new text as one minimal change; false when not synced here */
  replaceFileText: (path: string, content: string) => boolean;
  /** Connected and synced for the active file */
  connected: boolean;
}

// ─── Hook ───
//
// Design (mirrors Overleaf + CodeMirror's canonical multi-file model):
//   • The SERVER is authoritative: it owns the Y.Doc and seeds each file's
//     Y.Text from the database exactly once (see collaboration.gateway).
//   • Everything the editor binds to (Y.Text, undo manager, yCollab extension)
//     is derived SYNCHRONOUSLY from `activeFile`. There is no `synced`/`ytext`
//     React state that can lag the active file by a render, which is what
//     previously bound the PREVIOUS file's document to the current file.
//   • A file's binding is only produced once that specific file has synced
//     (tracked in `syncedFiles`). Until then `yjsExtension` is null and the
//     editor is driven by its `value` prop (on-disk content).
// Pair this with `key={activeFileId}` on the editor so each file gets a fresh
// EditorState (the React equivalent of Overleaf rebuilding state per document).

export function useYjsCollaboration({
  socketRef,
  socketConnected,
  activeFile,
  currentUserId = null,
  currentUserName = "Anonymous",
  currentUserColor = "#30bced",
  enabled = true,
}: UseYjsCollaborationOptions): UseYjsCollaborationReturn {
  // ── Refs that persist across renders and file switches ──

  /** Single Y.Doc per hook instance (per project), never recreated */
  const ydocRef = useRef<Y.Doc | null>(null);
  /** Awareness instance tied to the Y.Doc (shared across files) */
  const awarenessRef = useRef<Awareness | null>(null);
  /** Current active file, as a ref, to avoid stale closures in socket handlers. Updated as each render commits, so every socket handler, document update, and passive effect sees the committed file. */
  const activeFileRef = useRef<string | null>(activeFile);
  useLayoutEffect(() => {
    activeFileRef.current = activeFile;
  });
  /** Per-file undo managers, kept so undo history survives file switches */
  const undoManagersRef = useRef<Map<string, Y.UndoManager>>(new Map());
  /** Files that have completed their initial sync this session */
  const syncedFilesRef = useRef<Set<string>>(new Set());
  /** Local Y.Doc update handler (for detach) */
  const docUpdateHandlerRef = useRef<
    ((update: Uint8Array, origin: unknown) => void) | null
  >(null);
  /** Awareness change handler (for detach) */
  const awarenessChangeHandlerRef = useRef<((...args: any[]) => void) | null>(
    null,
  );
  /** Socket we've attached Yjs listeners to (for cleanup) */
  const attachedSocketRef = useRef<Socket | null>(null);
  /** The server document's epoch this Y.Doc was built from (see the gateway's ensureEpoch); null until the first sync. */
  const epochRef = useRef<string | null>(null);
  /** A change was made here while it could not be sent (the connection was down). */
  const unsentRef = useRef(false);

  // ── State ──
  // `syncTick` exists only to recompute the derived bindings when a file
  // transitions to "synced". The actual synced-set lives in a ref so socket
  // handlers can read/write it without stale closures.
  const [syncTick, setSyncTick] = useState(0);

  const markSynced = useCallback((file: string) => {
    if (!syncedFilesRef.current.has(file)) {
      syncedFilesRef.current.add(file);
      setSyncTick((t) => t + 1);
    }
  }, []);

  // ── Lazy-initialise Y.Doc + Awareness (once) ──

  const getOrCreateYdoc = useCallback((): Y.Doc => {
    if (!ydocRef.current) ydocRef.current = new Y.Doc();
    return ydocRef.current;
  }, []);

  const getOrCreateAwareness = useCallback((): Awareness => {
    if (!awarenessRef.current) {
      awarenessRef.current = new Awareness(getOrCreateYdoc());
    }
    return awarenessRef.current;
  }, [getOrCreateYdoc]);

  /** Get (or lazily create) the undo manager for a file's Y.Text */
  const getUndoManager = useCallback(
    (file: string): Y.UndoManager => {
      let undo = undoManagersRef.current.get(file);
      if (!undo) {
        // The file's suggestions share its undo history, so undoing an
        // edit made while suggesting also takes back its suggestion.
        const doc = getOrCreateYdoc();
        undo = new Y.UndoManager([doc.getText(file), suggestionsMap(doc, file)]);
        undoManagersRef.current.set(file, undo);
      }
      return undo;
    },
    [getOrCreateYdoc],
  );

  // ── Ask the server for its (DB-seeded) state for a file ──
  // Bytes travel as binary: Socket.IO carries a Uint8Array as an attachment, a third the size of the same bytes as a JSON array of numbers (a 300 KB document was 1.1 MB on the wire). Servers from before the switch read either.
  const requestFileSync = useCallback(
    (socket: Socket, file: string) => {
      const sv = Y.encodeStateVector(getOrCreateYdoc());
      socket.emit("yjs-sync", { file, sv });
    },
    [getOrCreateYdoc],
  );

  // ── Attach / detach Yjs listeners on the shared socket ──

  const attachSocketListeners = useCallback(
    (socket: Socket) => {
      if (attachedSocketRef.current === socket) return;

      const ydoc = getOrCreateYdoc();

      const handleYjsSync = (data: { file: string; update: Bytes; sv?: Bytes; epoch?: string }) => {
        if (!data.update || !data.file) return;
        // A different epoch: the server's document was made again from the saved files (it could not restore the one this page edited). The two histories share no past, and merging them would put every line in twice; the page starts again from the server's copy.
        if (data.epoch) {
          if (epochRef.current && epochRef.current !== data.epoch) {
            console.warn("[useYjsCollaboration] the server's document was replaced; reloading to edit the current one");
            window.location.reload();
            return;
          }
          epochRef.current = data.epoch;
        }
        try {
          Y.applyUpdate(ydoc, new Uint8Array(data.update), "remote");
        } catch (err) {
          console.error("[useYjsCollaboration] sync apply error:", err);
        }
        // This file's authoritative (seeded) state is now present locally →
        // it's safe to bind yCollab to it.
        markSynced(data.file);
        // The other half of the exchange: whatever this page has that the server does not (typed while the connection was down, when nothing could be sent) goes to it now. Before, it never did: the server, and everyone else, went on without it, and the next save of the server's copy overwrote it.
        if (data.sv) {
          try {
            const server = Y.decodeStateVector(new Uint8Array(data.sv));
            // New text the server lacks (a client of ours is further along than the server knows) is always sent. Deletions cannot be told apart from ones it already has (the delete set always travels whole), so they are sent only after changes were made while disconnected.
            const ahead = [...Y.decodeStateVector(Y.encodeStateVector(ydoc))].some(([client, clock]) => clock > (server.get(client) ?? 0));
            if (ahead || unsentRef.current) {
              socket.emit("yjs-update", { file: data.file, update: Y.encodeStateAsUpdate(ydoc, new Uint8Array(data.sv)) });
              unsentRef.current = false;
            }
          } catch (err) {
            console.error("[useYjsCollaboration] resync error:", err);
          }
        }
      };

      const handleYjsUpdate = (data: { file: string; update: Bytes }) => {
        if (!data.update) return;
        try {
          Y.applyUpdate(ydoc, new Uint8Array(data.update), "remote");
        } catch (err) {
          console.error("[useYjsCollaboration] update apply error:", err);
        }
      };

      const handleYjsAwarenessUpdate = (data: {
        data?: Bytes;
        update?: Bytes;
      }) => {
        const bytes = data.data || data.update;
        const awareness = awarenessRef.current;
        if (!bytes || !awareness) return;
        try {
          applyAwarenessUpdate(awareness, new Uint8Array(bytes), "remote");
        } catch (err) {
          console.error("[useYjsCollaboration] awareness apply error:", err);
        }
      };

      socket.on("yjs-sync", handleYjsSync);
      socket.on("yjs-update", handleYjsUpdate);
      socket.on("yjs-awareness-update", handleYjsAwarenessUpdate);
      attachedSocketRef.current = socket;

      return () => {
        socket.off("yjs-sync", handleYjsSync);
        socket.off("yjs-update", handleYjsUpdate);
        socket.off("yjs-awareness-update", handleYjsAwarenessUpdate);
        attachedSocketRef.current = null;
      };
    },
    [getOrCreateYdoc, markSynced],
  );

  // ── Main effect: Y.Doc + awareness + local→server relays ──

  useEffect(() => {
    if (!enabled) return;

    const ydoc = getOrCreateYdoc();
    const awareness = getOrCreateAwareness();

    awareness.setLocalStateField("user", {
      name: currentUserName,
      color: currentUserColor,
      colorLight: currentUserColor + "33",
      userId: currentUserId,
    });

    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      const socket = socketRef.current;
      const file = activeFileRef.current;
      if (!socket?.connected || !file) {
        unsentRef.current = true;
        return;
      }
      socket.emit("yjs-update", { file, update });
    };
    if (docUpdateHandlerRef.current) {
      ydoc.off("update", docUpdateHandlerRef.current);
    }
    docUpdateHandlerRef.current = onDocUpdate;
    ydoc.on("update", onDocUpdate);

    // The editor reports the cursor on every keystroke and every arrow key. Changes are gathered and sent at most once every AWARENESS_INTERVAL_MS, with the latest state, so fast typing is a few messages a second instead of one per key.
    const pendingAwareness = new Set<number>();
    let awarenessTimer: ReturnType<typeof setTimeout> | null = null;
    const flushAwareness = () => {
      awarenessTimer = null;
      const socket = socketRef.current;
      if (!socket?.connected || pendingAwareness.size === 0) return;
      try {
        const encoded = encodeAwarenessUpdate(awareness, [...pendingAwareness]);
        pendingAwareness.clear();
        socket.emit("yjs-awareness-update", { data: encoded });
      } catch (err) {
        console.error("[useYjsCollaboration] awareness encode error:", err);
      }
    };
    const onAwarenessChange = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === "remote") return;
      for (const id of [...changes.added, ...changes.updated, ...changes.removed]) pendingAwareness.add(id);
      if (!awarenessTimer) awarenessTimer = setTimeout(flushAwareness, AWARENESS_INTERVAL_MS);
    };
    if (awarenessChangeHandlerRef.current) {
      awareness.off("change", awarenessChangeHandlerRef.current);
    }
    awarenessChangeHandlerRef.current = onAwarenessChange;
    awareness.on("change", onAwarenessChange);

    return () => {
      if (awarenessTimer) clearTimeout(awarenessTimer);
      if (docUpdateHandlerRef.current) {
        ydoc.off("update", docUpdateHandlerRef.current);
        docUpdateHandlerRef.current = null;
      }
      if (awarenessChangeHandlerRef.current) {
        awareness.off("change", awarenessChangeHandlerRef.current);
        awarenessChangeHandlerRef.current = null;
      }
      for (const undo of undoManagersRef.current.values()) undo.destroy();
      undoManagersRef.current.clear();
      syncedFilesRef.current.clear();
      epochRef.current = null;
      awareness.destroy();
      awarenessRef.current = null;
      ydoc.destroy();
      ydocRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, getOrCreateYdoc, getOrCreateAwareness]);

  // ── Attach listeners + (re)sync when socket connects ──

  useEffect(() => {
    const socket = socketRef.current;
    if (!enabled || !socket) {
      attachedSocketRef.current = null;
      return;
    }
    const cleanup = attachSocketListeners(socket);
    if (socket.connected && activeFileRef.current) {
      requestFileSync(socket, activeFileRef.current);
    }
    return cleanup;
  }, [
    enabled,
    socketConnected,
    socketRef,
    attachSocketListeners,
    requestFileSync,
  ]);

  // ── Request sync whenever the active file changes ──

  useEffect(() => {
    if (!activeFile) return;
    const socket = socketRef.current;
    if (socket?.connected) requestFileSync(socket, activeFile);
  }, [activeFile, requestFileSync, socketConnected]);

  // ── Keep awareness user info current ──

  useEffect(() => {
    const awareness = awarenessRef.current;
    if (!awareness) return;
    awareness.setLocalStateField("user", {
      name: currentUserName,
      color: currentUserColor,
      colorLight: currentUserColor + "33",
      userId: currentUserId,
    });
  }, [currentUserName, currentUserColor, currentUserId]);

  // ── Derived, file-correct bindings ──
  // Both are computed SYNCHRONOUSLY from `activeFile`, so they can never refer
  // to a previously-selected file. They are non-null only once THIS file has
  // synced (its DB-seeded content is present locally).

  // The binding outlives a dropped connection. It used to come off with it, and what was typed meanwhile went into the editor alone; on reconnecting, the editor was reset to the shared text and that typing vanished. Bound, it goes into the shared document, which sends it once the connection is back (see the sync handler).
  const isActiveSynced =
    !!activeFile &&
    enabled &&
    syncedFilesRef.current.has(activeFile);

  const ytext = useMemo<Y.Text | null>(() => {
    void syncTick;
    if (!isActiveSynced || !activeFile) return null;
    return ydocRef.current?.getText(activeFile) ?? null;
  }, [activeFile, isActiveSynced, syncTick]);

  const yjsExtension = useMemo<Extension | null>(() => {
    void syncTick;
    if (!isActiveSynced || !activeFile || !ytext) return null;
    const awareness = awarenessRef.current;
    if (!awareness) return null;
    try {
      const undoManager = getUndoManager(activeFile);
      return [
        yCollab(ytext, awareness, { undoManager }),
        keymap.of(yUndoManagerKeymap),
      ];
    } catch (err) {
      console.error("[useYjsCollaboration] yCollab build error:", err);
      return null;
    }
  }, [activeFile, isActiveSynced, ytext, syncTick, getUndoManager]);

  /**
   * Writes a whole file's new text into the shared document (an accepted AI
   * edit, for instance) as one minimal change: the common start and end stay
   * untouched, so collaborators' cursors and edits elsewhere survive, and the
   * change lands on the normal undo stack. False when the file is not synced
   * here, so the caller falls back to local state.
   */
  const replaceFileText = useCallback((path: string, content: string): boolean => {
    const ydoc = ydocRef.current;
    if (!ydoc || !syncedFilesRef.current.has(path)) return false;
    const text = ydoc.getText(path);
    const current = text.toString();
    if (current === content) return true;
    let start = 0;
    const max = Math.min(current.length, content.length);
    while (start < max && current[start] === content[start]) start++;
    let endOld = current.length;
    let endNew = content.length;
    while (endOld > start && endNew > start && current[endOld - 1] === content[endNew - 1]) {
      endOld--;
      endNew--;
    }
    ydoc.transact(() => {
      if (endOld > start) text.delete(start, endOld - start);
      if (endNew > start) text.insert(start, content.slice(start, endNew));
    });
    return true;
  }, []);

  return {
    yjsExtension,
    replaceFileText,
    synced: isActiveSynced && socketConnected,
    ytext,
    connected: isActiveSynced && socketConnected,
  };
}

export default useYjsCollaboration;

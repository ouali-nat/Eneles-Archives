"use client";

import { API_URL } from "@/lib/site-urls";
import { getApiSessionToken } from "@/lib/api/client";
import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";

const WS_URL = (API_URL)
  .replace(/\/api$/, "")
  .replace(/\/$/, "");

// ─── Types ───

export interface RemoteUser {
  userId: number;
  name: string;
  email: string;
  avatarUrl?: string;
  color: string;
  activeFile: string | null;
  cursor: { line: number; ch: number } | null;
  selection: {
    fromLine: number;
    fromCh: number;
    toLine: number;
    toCh: number;
  } | null;
}

export interface CursorUpdate {
  socketId: string;
  userId: number;
  name: string;
  color: string;
  cursor: { line: number; ch: number } | null;
  selection: {
    fromLine: number;
    fromCh: number;
    toLine: number;
    toCh: number;
  } | null;
  activeFile: string | null;
}

interface UseCollaborationOptions {
  projectUid: string;
  isAuthenticated: boolean;
  activeFile: string | null;
  /** Current user's ID, used to filter self from remote list and ignore own echoes */
  currentUserId?: number | null;
  enabled?: boolean;
}

export function useCollaboration({
  projectUid,
  isAuthenticated,
  activeFile,
  currentUserId = null,
  enabled = true,
}: UseCollaborationOptions) {
  const socketRef = useRef<Socket | null>(null);
  const [remoteUsers, setRemoteUsers] = useState<RemoteUser[]>([]);
  const [connected, setConnected] = useState(false);

  // Keep a ref to activeFile to avoid stale closures. Updated as each render commits, so every socket handler and passive effect sees the committed file.
  const activeFileRef = useRef(activeFile);
  useLayoutEffect(() => {
    activeFileRef.current = activeFile;
  });

  // Cursor update listeners (the editor registers one)
  const cursorListenersRef = useRef<Set<(update: CursorUpdate) => void>>(
    new Set(),
  );

  // Connect to WebSocket
  useEffect(() => {
    if (!enabled || !isAuthenticated || !projectUid) return;

    const socket = io(`${WS_URL}/collaboration`, {
      // Embedded Eneles sessions use an in-memory bearer token; ordinary visits use the HttpOnly cookie.
      auth: { token: getApiSessionToken() || undefined },
      withCredentials: true,
      transports: ["websocket", "polling"],
      // Keeps trying for as long as the page is open, backing off to one attempt every ten seconds: after ten tries it used to stop for good, and the editor quietly stopped being live until a reload.
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      // Join the project room once connected
      socket.emit("join-project", {
        projectUid,
        activeFile: activeFileRef.current,
      });
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setRemoteUsers([]);
    });

    socket.on("connect_error", (err) => {
      console.error("[useCollaboration] connect_error:", err.message);
    });

    // Full presence sync from server: exclude self if currentUserId provided
    // The owner changed this person's role or removed them. The server already
    // enforces it; reloading brings the editor's controls in line.
    socket.on("access-changed", () => {
      window.location.reload();
    });
    // The session was signed out, revoked, or expired, or the account disabled: the server closes the socket, and the page reloads into whatever the sign-in now allows.
    socket.on("session-ended", () => {
      window.location.reload();
    });

    socket.on("presence-sync", (users: RemoteUser[]) => {
      const filtered =
        currentUserId != null
          ? users.filter((u) => u.userId !== currentUserId)
          : users;
      setRemoteUsers(filtered);
    });

    // Individual cursor updates (high frequency): never apply to self. Every one used to re-render the whole editor screen; those that arrive within one frame are applied together, the latest per person.
    const pendingCursors = new Map<number, CursorUpdate>();
    let cursorFrame = 0;
    const applyCursors = () => {
      cursorFrame = 0;
      const updates = new Map(pendingCursors);
      pendingCursors.clear();
      setRemoteUsers((prev) =>
        prev.map((u) => {
          const update = updates.get(u.userId);
          return update ? { ...u, cursor: update.cursor, selection: update.selection, activeFile: update.activeFile } : u;
        }),
      );
    };
    socket.on("cursor-update", (update: CursorUpdate) => {
      if (currentUserId != null && update.userId === currentUserId) return;
      pendingCursors.set(update.userId, update);
      if (!cursorFrame) cursorFrame = requestAnimationFrame(applyCursors);
      cursorListenersRef.current.forEach((listener) => listener(update));
    });

    return () => {
      cancelAnimationFrame(cursorFrame);
      socket.emit("leave-project");
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
      setRemoteUsers([]);
    };
  }, [enabled, isAuthenticated, projectUid, currentUserId]);

  // Emit file selection changes
  useEffect(() => {
    if (!socketRef.current?.connected || !activeFile) return;
    socketRef.current.emit("file-select", { file: activeFile });
  }, [activeFile]);

  // ─── Emitters ───

  /** Send cursor position to the server (debounce externally if needed) */
  const emitCursorMove = useCallback(
    (
      line: number,
      ch: number,
      selection?: {
        fromLine: number;
        fromCh: number;
        toLine: number;
        toCh: number;
      },
    ) => {
      socketRef.current?.emit("cursor-move", { line, ch, selection });
    },
    [],
  );

  /** Register a cursor update listener (returns unsubscribe fn) */
  const onCursorUpdate = useCallback(
    (listener: (update: CursorUpdate) => void) => {
      cursorListenersRef.current.add(listener);
      return () => {
        cursorListenersRef.current.delete(listener);
      };
    },
    [],
  );

  return {
    connected,
    remoteUsers,
    emitCursorMove,
    onCursorUpdate,
    /** Exposed so the Yjs hook can share the same socket (no duplicate connection) */
    socketRef,
  };
}

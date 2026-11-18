"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { AssistantTurn } from "./types";

/*
 * The assistant's conversation history, kept in this browser for each account and project. Every conversation has a title (its first question), the time it was last used, and its turns; the one in use is remembered too, so it is there again when the project is reopened. Proposed changes are not part of a conversation: they belong to the project and are kept by the server.
 *
 * Limits keep the store small: at most MAX_CONVERSATIONS per project (the least recently used go first), MAX_TURNS turns in each, MAX_TURN_CHARS characters in a turn, and about MAX_BYTES for the whole project. When the browser refuses to store more, the oldest conversations are dropped until it fits.
 */

const VERSION = 1;
const PREFIX = `texer-assistant-history:v${VERSION}`;
export const MAX_CONVERSATIONS = 30;
const MAX_TURNS = 40;
const MAX_TURN_CHARS = 20_000;
const MAX_BYTES = 600_000;

/** Which provider and model answer: one the person has a key for, "platform", or "local" (development only). */
export interface ModelChoice {
  provider: string;
  model: string | null;
}

export interface AssistantConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: AssistantTurn[];
  /** The model chosen for this conversation, remembered with it. */
  model?: ModelChoice;
}

interface Stored {
  v: number;
  currentId: string | null;
  conversations: AssistantConversation[];
}

const keyFor = (userId: number | string, projectId: string) => `${PREFIX}:${userId}:${projectId}`;

/** A conversation's title: its first question, on one line, without a leading slash command's slash. */
export function titleOf(turns: readonly AssistantTurn[]): string {
  const first = turns.find((t) => t.role === "user");
  const text = (first?.label || first?.content || "").replace(/\s+/g, " ").trim();
  if (!text) return "New conversation";
  return text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
}

function clean(turns: readonly AssistantTurn[]): AssistantTurn[] {
  return turns.slice(-MAX_TURNS).map((t) => ({
    ...t,
    content: t.content.length > MAX_TURN_CHARS ? `${t.content.slice(0, MAX_TURN_CHARS)}…` : t.content,
    read: t.read?.slice(0, 50),
  }));
}

function read(key: string): Stored {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { v: VERSION, currentId: null, conversations: [] };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed.v !== VERSION || !Array.isArray(parsed.conversations)) return { v: VERSION, currentId: null, conversations: [] };
    const conversations = parsed.conversations.filter((c): c is AssistantConversation => !!c && typeof c.id === "string" && Array.isArray(c.turns) && typeof c.updatedAt === "number");
    const currentId = conversations.some((c) => c.id === parsed.currentId) ? (parsed.currentId as string) : null;
    return { v: VERSION, currentId, conversations };
  } catch {
    return { v: VERSION, currentId: null, conversations: [] };
  }
}

function write(key: string, stored: Stored) {
  // Most recent first, within the count, then within the size; a refusal from the browser drops the oldest until it is taken.
  const conversations = [...stored.conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
  let next: Stored = { ...stored, conversations };
  let text = JSON.stringify(next);
  while (text.length > MAX_BYTES && next.conversations.length > 1) {
    next = { ...next, conversations: next.conversations.slice(0, -1) };
    text = JSON.stringify(next);
  }
  for (;;) {
    try {
      if (next.conversations.length === 0 && !next.currentId) localStorage.removeItem(key);
      else localStorage.setItem(key, text);
      return;
    } catch {
      if (next.conversations.length <= 1) return;
      next = { ...next, conversations: next.conversations.slice(0, -1) };
      text = JSON.stringify(next);
    }
  }
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export interface AssistantHistory {
  /** The turns of the conversation in use, oldest first. */
  turns: AssistantTurn[];
  /** Replaces or updates the turns in use; emptying them starts a new conversation and keeps the old one in the history. */
  setTurns: (next: AssistantTurn[] | ((turns: AssistantTurn[]) => AssistantTurn[])) => void;
  /** Every saved conversation, most recently used first. */
  conversations: AssistantConversation[];
  currentId: string | null;
  open: (id: string) => void;
  remove: (id: string) => void;
  /** Puts a removed conversation back (Undo); `current` makes it the one in use again, as it was. */
  restore: (conversation: AssistantConversation, current?: boolean) => void;
  startNew: () => void;
  /** The model chosen for the conversation in use (or for the next one, before it has turns); null for the account's default. */
  model: ModelChoice | null;
  setModel: (choice: ModelChoice | null) => void;
}

// One store per account and project, shared by every hook that reads it, read from the browser's storage the first time it is asked for.
type Store = { state: Stored; listeners: Set<() => void> };
const stores = new Map<string, Store>();
/* The model chosen before a new conversation has its first turn, per account and project; it goes with the conversation once it starts. */
const drafts = new Map<string, ModelChoice | null>();
const EMPTY: Stored = { v: VERSION, currentId: null, conversations: [] };
const EMPTY_CONVERSATIONS: AssistantConversation[] = [];

function storeFor(key: string): Store {
  let store = stores.get(key);
  if (!store) {
    store = { state: read(key), listeners: new Set() };
    stores.set(key, store);
  }
  return store;
}

function commit(key: string, next: Stored) {
  const store = storeFor(key);
  store.state = next;
  write(key, next);
  store.listeners.forEach((listener) => listener());
}

// Another tab of the same project keeps its own copy; a change there is taken up here, keeping the conversation this tab has open.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (!e.key || !stores.has(e.key)) return;
    const store = stores.get(e.key)!;
    const stored = read(e.key);
    const keep = store.state.currentId && stored.conversations.some((c) => c.id === store.state.currentId);
    store.state = { ...stored, currentId: keep ? store.state.currentId : stored.currentId };
    store.listeners.forEach((listener) => listener());
  });
}

/** The assistant's conversations for one account and project, kept in this browser. Without an account nothing is stored. */
export function useAssistantHistory(projectId: string, userId: number | string | null | undefined): AssistantHistory {
  const key = userId !== null && userId !== undefined && projectId ? keyFor(userId, projectId) : null;
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!key) return () => {};
      const store = storeFor(key);
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    [key],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => (key ? storeFor(key).state : EMPTY),
    () => EMPTY,
  );
  // Without an account the conversation lives only in this page.
  const [local, setLocal] = useState<AssistantTurn[]>([]);
  const [draft, setDraft] = useState<ModelChoice | null>(() => (key ? (drafts.get(key) ?? null) : null));

  const current = state.conversations.find((c) => c.id === state.currentId) ?? null;
  const turns = key ? (current?.turns ?? EMPTY_CONVERSATIONS_TURNS) : local;

  const setTurns = useCallback<AssistantHistory["setTurns"]>(
    (update) => {
      if (!key) {
        setLocal((before) => clean(typeof update === "function" ? update(before) : update));
        return;
      }
      const now = storeFor(key).state;
      const active = now.conversations.find((c) => c.id === now.currentId) ?? null;
      const before = active?.turns ?? [];
      const after = clean(typeof update === "function" ? update(before) : update);
      if (after.length === 0) {
        commit(key, { ...now, currentId: null });
        return;
      }
      const time = Date.now();
      if (!active) {
        const model = drafts.get(key) ?? undefined;
        const conversation: AssistantConversation = { id: newId(), title: titleOf(after), createdAt: time, updatedAt: time, turns: after, ...(model ? { model } : {}) };
        commit(key, { ...now, currentId: conversation.id, conversations: [conversation, ...now.conversations] });
        return;
      }
      const changed: AssistantConversation = { ...active, turns: after, title: active.turns.length ? active.title : titleOf(after), updatedAt: time };
      commit(key, { ...now, conversations: now.conversations.map((c) => (c.id === active.id ? changed : c)) });
    },
    [key],
  );

  const open = useCallback((id: string) => key && commit(key, { ...storeFor(key).state, currentId: id }), [key]);
  const startNew = useCallback(() => {
    if (key) commit(key, { ...storeFor(key).state, currentId: null });
    else setLocal([]);
  }, [key]);
  const remove = useCallback(
    (id: string) => {
      if (!key) return;
      const now = storeFor(key).state;
      commit(key, { ...now, currentId: now.currentId === id ? null : now.currentId, conversations: now.conversations.filter((c) => c.id !== id) });
    },
    [key],
  );
  const restore = useCallback(
    (conversation: AssistantConversation, current = false) => {
      if (!key) return;
      const now = storeFor(key).state;
      if (now.conversations.some((c) => c.id === conversation.id)) return;
      commit(key, { ...now, currentId: current ? conversation.id : now.currentId, conversations: [...now.conversations, conversation] });
    },
    [key],
  );

  const conversations = useMemo(() => (state.conversations.length ? [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt) : EMPTY_CONVERSATIONS), [state.conversations]);

  const setModel = useCallback(
    (choice: ModelChoice | null) => {
      if (key) drafts.set(key, choice);
      setDraft(choice);
      if (!key) return;
      const now = storeFor(key).state;
      const active = now.conversations.find((c) => c.id === now.currentId);
      if (!active) return;
      const { model: _old, ...rest } = active;
      void _old;
      commit(key, { ...now, conversations: now.conversations.map((c) => (c.id === active.id ? (choice ? { ...rest, model: choice } : rest) : c)) });
    },
    [key],
  );
  const model = current ? (current.model ?? null) : draft;

  return { turns, setTurns, conversations, currentId: state.currentId, open, remove, restore, startNew, model, setModel };
}

const EMPTY_CONVERSATIONS_TURNS: AssistantTurn[] = [];

import { API_URL, handleResponse, apiFetch } from "./client";

export interface PersonRef {
  id: number;
  name: string | null;
  avatarUrl?: string | null;
}

export interface CommentMessage {
  id: number;
  threadId: number;
  authorId: number;
  content: string;
  createdAt: string;
  editedAt: string | null;
  author: PersonRef;
}

export interface CommentThread {
  id: number;
  path: string;
  anchorStart: string | null;
  anchorEnd: string | null;
  quote: string;
  offset: number;
  /** The highlight's hue (lib/review/hues.ts); null is the default. */
  color: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedById: number | null;
  createdById: number;
  createdAt: string;
  updatedAt: string;
  createdBy: PersonRef;
  messages: CommentMessage[];
}

export interface ChatMessage {
  id: number;
  userId: number;
  content: string;
  createdAt: string;
  user: PersonRef;
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const base = (uid: string) => `${API_URL}/projects/${encodeURIComponent(uid)}`;

/** Comments on project files, and the project chat. */
export const collabAPI = {
  async comments(uid: string): Promise<CommentThread[]> {
    return handleResponse(await apiFetch(`${base(uid)}/comments`));
  },
  async addComment(
    uid: string,
    data: { path: string; anchorStart?: string | null; anchorEnd?: string | null; quote: string; offset: number; content: string; color?: string | null },
  ): Promise<CommentThread> {
    const { anchorStart, anchorEnd, color, ...rest } = data;
    return handleResponse(
      await apiFetch(
        `${base(uid)}/comments`,
        send("POST", { ...rest, ...(anchorStart ? { anchorStart } : {}), ...(anchorEnd ? { anchorEnd } : {}), ...(color ? { color } : {}) }),
      ),
    );
  },
  async reply(uid: string, threadId: number, content: string): Promise<CommentThread> {
    return handleResponse(await apiFetch(`${base(uid)}/comments/${threadId}/replies`, send("POST", { content })));
  },
  async resolve(uid: string, threadId: number, resolved: boolean): Promise<CommentThread> {
    return handleResponse(await apiFetch(`${base(uid)}/comments/${threadId}`, send("PATCH", { resolved })));
  },
  /** Change a thread's highlight color; null puts the default back. */
  async setColor(uid: string, threadId: number, color: string | null): Promise<CommentThread> {
    return handleResponse(await apiFetch(`${base(uid)}/comments/${threadId}`, send("PATCH", { color })));
  },
  async deleteThread(uid: string, threadId: number): Promise<void> {
    await handleResponse(await apiFetch(`${base(uid)}/comments/${threadId}`, send("DELETE")));
  },
  async editMessage(uid: string, messageId: number, content: string): Promise<CommentThread> {
    return handleResponse(await apiFetch(`${base(uid)}/comments/messages/${messageId}`, send("PATCH", { content })));
  },
  async deleteMessage(uid: string, messageId: number): Promise<void> {
    await handleResponse(await apiFetch(`${base(uid)}/comments/messages/${messageId}`, send("DELETE")));
  },
  async chat(uid: string, before?: number): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
    const q = before ? `?before=${before}&limit=50` : "?limit=50";
    return handleResponse(await apiFetch(`${base(uid)}/chat${q}`));
  },
  async postChat(uid: string, content: string): Promise<ChatMessage> {
    return handleResponse(await apiFetch(`${base(uid)}/chat`, send("POST", { content })));
  },
};

import { API_URL, ApiError, handleResponse, apiFetch } from "./client";
import type { AiChatEdit, AiChatTurn } from "./types";

/** The providers a person can bring a key for. "compatible" is any API that speaks OpenAI's, at a base URL the person gives. */
export type AiProviderId = "anthropic" | "openai" | "gemini" | "openrouter" | "mistral" | "groq" | "xai" | "deepseek" | "compatible";

export interface AiProviderInfo {
  id: AiProviderId;
  name: string;
  keyUrl: string | null;
  keyPrefix: string | null;
  needsBaseUrl: boolean;
}

/** A saved key as the server describes it: never the key itself. */
export interface AiStoredKey {
  provider: AiProviderId;
  name?: string;
  last4: string;
  baseUrl: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AiModel {
  id: string;
  name: string;
  contextTokens: number | null;
  maxOutputTokens: number | null;
  /** Can call the editing tools: true, false, or null (not known; tried, and answered without edits if refused). */
  tools: boolean | null;
  suggested?: "flagship" | "fast";
}

export interface AiPreferences {
  provider: string | null;
  model: string | null;
  temperature: number | null;
  maxOutputTokens: number | null;
  systemNote: string | null;
}

export interface AiStatus {
  available: boolean;
  provider: string | null;
  reason: "no_key" | null;
  /** Platform AI is on and the plan lacks it: Upgrade is offered. */
  upgrade: boolean;
  source: "own" | "platform" | "local" | null;
  canStoreKeys: boolean;
  platform: { enabled: boolean; configured: boolean; included: boolean; available: boolean; model: string | null };
  keys: AiStoredKey[];
  preferences: AiPreferences;
  /** The scripted local test model is offered (development only). */
  localModel: boolean;
  /** How dictation is transcribed for this person. */
  dictation: "own" | "platform" | "local" | "browser";
}

export interface AiUsageSummary {
  days: number;
  totals: { calls: number; inputTokens: number; outputTokens: number };
  byModel: Array<{ kind: string; provider: string | null; model: string | null; keySource: string | null; calls: number; requests: number; inputTokens: number; outputTokens: number; audioBytes: number; lastUsedAt: string | null }>;
}

/** What the server streams while it answers. */
export type AiStreamEvent =
  | { type: "meta"; provider: string; providerName: string; model: string; source: "own" | "platform" | "local"; tools: boolean; trimmed: { sent: number; total: number } | null }
  | { type: "text"; delta: string }
  | { type: "activity"; id: string; tool: string; path: string | null; state: "running" | "done" | "failed" }
  | { type: "notice"; message: string }
  | { type: "result"; message: string; edits: AiChatEdit[]; read: string[] }
  | { type: "error"; message: string; code: string; retryable: boolean }
  | { type: "done" };

export interface AiChatRequest {
  message: string;
  files: Array<{ path: string; content: string }>;
  activeFilePath?: string;
  /** The project's tab size, so the assistant indents as the project does. */
  tabSize?: number;
  history?: AiChatTurn[];
  context?: { compileErrors?: string; selection?: string };
  provider?: string;
  model?: string;
}

/** A refusal before the stream started: the code says what fixes it (no_key: add a key; rate_limited: wait). */
export class AiRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly upgrade: boolean,
  ) {
    super(message);
    this.name = "AiRefusal";
  }
}

const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const aiAPI = {
  /** Whether the editor's assistant answers for this person, with what, and if not, why. */
  async chatStatus(): Promise<AiStatus> {
    return handleResponse(await apiFetch(`${API_URL}/ai/chat/status`));
  },

  async providers(): Promise<AiProviderInfo[]> {
    return handleResponse(await apiFetch(`${API_URL}/ai/providers`));
  },

  async keys(): Promise<{ canStore: boolean; keys: AiStoredKey[] }> {
    return handleResponse(await apiFetch(`${API_URL}/ai/keys`));
  },

  /** Checks the key with the provider, then stores it sealed. Throws with the provider's reason when it is refused. */
  async saveKey(provider: AiProviderId, key: string, baseUrl?: string): Promise<AiStoredKey & { models: number }> {
    return handleResponse(await apiFetch(`${API_URL}/ai/keys`, { method: "POST", ...json({ provider, key, baseUrl }) }));
  },

  async removeKey(provider: AiProviderId): Promise<void> {
    const response = await apiFetch(`${API_URL}/ai/keys/${provider}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) await handleResponse(response);
  },

  async models(provider: string, refresh = false): Promise<AiModel[]> {
    const data = await handleResponse(await apiFetch(`${API_URL}/ai/models?provider=${encodeURIComponent(provider)}${refresh ? "&refresh=1" : ""}`));
    return (data as { models: AiModel[] }).models;
  },

  async preferences(): Promise<AiPreferences> {
    return handleResponse(await apiFetch(`${API_URL}/ai/preferences`));
  },

  async savePreferences(patch: Partial<AiPreferences>): Promise<AiPreferences> {
    return handleResponse(await apiFetch(`${API_URL}/ai/preferences`, { method: "PUT", ...json(patch) }));
  },

  async usage(days = 30): Promise<AiUsageSummary> {
    return handleResponse(await apiFetch(`${API_URL}/ai/usage?days=${days}`));
  },

  /**
   * Asks the assistant and reads its answer as it is written. `onEvent` gets each event in order. Resolves when the stream ends (done, error, or the connection closing); rejects with `AiRefusal` when the server refused before streaming, and with the fetch's own error when the network failed. Aborting `signal` closes the connection, which stops the model at the provider. `uid` is the Eneles project asked about; null asks about files that are not in a Eneles project (the desktop app's local folders), which come only with the request.
   */
  async streamChat(uid: string | null, request: AiChatRequest, onEvent: (event: AiStreamEvent) => void, signal: AbortSignal): Promise<{ ended: "done" | "error" | "closed" }> {
    const response = await apiFetch(uid === null ? `${API_URL}/ai/chat/stream` : `${API_URL}/projects/${uid}/ai/chat/stream`, { method: "POST", ...json(request), signal, headers: { "Content-Type": "application/json", Accept: "text/event-stream" } });
    if (!response.ok) {
      let body: { message?: string | string[]; code?: string; upgrade?: boolean } | null = null;
      try {
        body = await response.json();
      } catch {
        // Not JSON: the status says enough.
      }
      const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message || `The assistant could not answer (${response.status}).`;
      throw new AiRefusal(message, response.status, body?.code ?? null, !!body?.upgrade);
    }
    if (!response.body) throw new ApiError("The answer could not be read.", 502);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let ended: "done" | "error" | "closed" = "closed";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      // Events are separated by a blank line; a partial event waits for the rest.
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        let event: AiStreamEvent;
        try {
          event = JSON.parse(data) as AiStreamEvent;
        } catch {
          continue;
        }
        if (event.type === "done") ended = "done";
        if (event.type === "error") ended = "error";
        onEvent(event);
      }
    }
    return { ended };
  },

  async transcribeSpeech(audioBlob: Blob, filename = "audio.webm"): Promise<{ text: string; source?: string }> {
    const formData = new FormData();
    formData.append("audio", audioBlob, filename);
    const response = await apiFetch(`${API_URL}/ai/speech/transcribe`, { method: "POST", body: formData });
    return handleResponse(response);
  },
};

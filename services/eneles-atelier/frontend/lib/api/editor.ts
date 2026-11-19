import { API_URL, handleResponse, apiFetch } from "./client";
import type { EditorSettings, UserMacro } from "./types";

/** A slash command a person added to the assistant: "/name" sends `prompt`, with {file} replaced by the open file's path and {input} by what was typed after the command. */
export interface AssistantCommand {
  name: string;
  description: string;
  prompt: string;
  /** Attach the editor's selection when there is one. */
  useSelection: boolean;
}

// Extended Settings API: editor settings + dictionary
export const editorSettingsAPI = {
  async getEditorSettings(): Promise<EditorSettings> {
    const response = await apiFetch(`${API_URL}/settings/editor`);
    return handleResponse(response);
  },

  async updateEditorSettings(
    data: Partial<EditorSettings>,
  ): Promise<EditorSettings> {
    const response = await apiFetch(`${API_URL}/settings/editor`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return handleResponse(response);
  },

  async getDictionary(
  ): Promise<{ words: string[]; updatedAt: string }> {
    const response = await apiFetch(`${API_URL}/settings/dictionary`);
    return handleResponse(response);
  },

  async addWord(word: string) {
    const response = await apiFetch(`${API_URL}/settings/dictionary/words`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ word }),
    });
    return handleResponse(response);
  },

  async removeWord(word: string) {
    const response = await apiFetch(
      `${API_URL}/settings/dictionary/words/${encodeURIComponent(word)}`,
      {
        method: "DELETE",
      },
    );
    return handleResponse(response);
  },

  async setDictionary(words: string[]) {
    const response = await apiFetch(`${API_URL}/settings/dictionary`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ words }),
    });
    return handleResponse(response);
  },

  /** The person's own slash commands for the assistant, in their order. */
  async getAssistantCommands(): Promise<AssistantCommand[]> {
    const response = await apiFetch(`${API_URL}/settings/assistant-commands`);
    return handleResponse(response);
  },

  /** Replaces the list. Answers the saved list. */
  async updateAssistantCommands(commands: AssistantCommand[]): Promise<AssistantCommand[]> {
    const response = await apiFetch(`${API_URL}/settings/assistant-commands`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });
    return handleResponse(response);
  },

  async getMacros(): Promise<UserMacro[]> {
    const response = await apiFetch(`${API_URL}/settings/macros`);
    return handleResponse(response);
  },

  async updateMacros(
    macros: { name: string; expansion: string }[],
  ): Promise<UserMacro[]> {
    const response = await apiFetch(`${API_URL}/settings/macros`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ macros }),
    });
    return handleResponse(response);
  },

  async resetMacro(name?: string): Promise<UserMacro[]> {
    const response = await apiFetch(`${API_URL}/settings/macros/reset`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });
    return handleResponse(response);
  },
};

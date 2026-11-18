import { API_URL, handleResponse, apiFetch } from "./client";
import type { PaginatedResponse } from "./types";

// API Keys API
export const apiKeysAPI = {
  async getApiKeys(
    page = 1,
    limit = 50,
  ): Promise<PaginatedResponse<any>> {
    const response = await apiFetch(
      `${API_URL}/api-keys?page=${page}&limit=${limit}`,
      {
      },
    );
    return handleResponse(response);
  },

  async createApiKey(name: string) {
    const response = await apiFetch(`${API_URL}/api-keys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });
    return handleResponse(response);
  },

  async updateApiKeyName(id: number, name: string) {
    const response = await apiFetch(`${API_URL}/api-keys/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });
    return handleResponse(response);
  },

  async deleteApiKey(id: number) {
    const response = await apiFetch(`${API_URL}/api-keys/${id}`, {
      method: "DELETE",
    });
    return handleResponse(response);
  },
};

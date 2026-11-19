import { API_URL, handleResponse, apiFetch } from "./client";
import type { Snip, PaginatedResponse } from "./types";

export const snipsAPI = {
  async create(file: File, title?: string): Promise<Snip> {
    const formData = new FormData();
    formData.append("file", file);
    if (title) {
      formData.append("title", title);
    }

    const response = await apiFetch(`${API_URL}/snips`, {
      method: "POST",
      body: formData,
    });
    return handleResponse(response);
  },

  async processSnip(
    id: string,
  ): Promise<{
    id: string;
    status: string;
    latexContent: string;
    model?: string;
    duration_ms?: number;
  }> {
    const response = await apiFetch(`${API_URL}/snips/${id}/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    return handleResponse(response);
  },

  async getMySnips(
    page = 1,
    limit = 50,
  ): Promise<PaginatedResponse<Snip>> {
    const response = await apiFetch(
      `${API_URL}/snips?page=${page}&limit=${limit}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    return handleResponse(response);
  },

  async getSnip(id: string): Promise<Snip> {
    const response = await apiFetch(`${API_URL}/snips/${id}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    return handleResponse(response);
  },

  async getSnipImageUrl(id: string): Promise<string> {
    const response = await apiFetch(`${API_URL}/snips/${id}/image`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await handleResponse(response);
    return data.imageUrl;
  },

  async updateSnip(
    id: string,
    updateData: {
      latexCode?: string;
      processingStatus?: string;
      title?: string;
      description?: string;
      tags?: string[];
    },
  ) {
    const response = await apiFetch(`${API_URL}/snips/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: updateData.title,
        latexContent: updateData.latexCode,
        originalText: updateData.description,
        status: updateData.processingStatus,
        tags: updateData.tags,
      }),
    });
    return handleResponse(response);
  },

  async deleteSnip(id: string) {
    const response = await apiFetch(`${API_URL}/snips/${id}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
    });
    return handleResponse(response);
  },
};

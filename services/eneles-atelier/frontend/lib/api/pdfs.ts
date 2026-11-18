import { API_URL, handleResponse, apiFetch } from "./client";
import type { PDF, PaginatedResponse } from "./types";

// PDFs API
export const pdfsAPI = {
  async create(
    file: File,
    title?: string,
    pageCount?: number,
  ): Promise<PDF> {
    const formData = new FormData();
    formData.append("file", file);
    if (title) {
      formData.append("title", title);
    }
    if (pageCount) {
      formData.append("pageCount", pageCount.toString());
    }

    const response = await apiFetch(`${API_URL}/pdfs`, {
      method: "POST",
      body: formData,
    });
    return handleResponse(response);
  },

  async processPdf(
    id: string,
  ): Promise<{
    id: string;
    status: string;
    latexContent: string;
    pageCount?: number;
  }> {
    const response = await apiFetch(`${API_URL}/pdfs/${id}/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    return handleResponse(response);
  },

  async getMyPdfs(
    page = 1,
    limit = 50,
  ): Promise<PaginatedResponse<PDF>> {
    const response = await apiFetch(
      `${API_URL}/pdfs?page=${page}&limit=${limit}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    return handleResponse(response);
  },

  async getPdf(id: string): Promise<PDF> {
    const response = await apiFetch(`${API_URL}/pdfs/${id}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    return handleResponse(response);
  },

  async getPdfPreviewUrl(id: string): Promise<string> {
    const response = await apiFetch(`${API_URL}/pdfs/${id}/preview`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await handleResponse(response);
    return data.previewUrl;
  },

  /** A signed URL for the first-page PNG, or null when the PDF has none. */
  async getPdfThumbnailUrl(id: string): Promise<string | null> {
    const response = await apiFetch(`${API_URL}/pdfs/${id}/thumbnail`);
    if (response.status === 404) return null;
    const data = await handleResponse(response);
    return data.thumbnailUrl ?? null;
  },

  async updatePdf(
    id: string,
    updateData: {
      latexCode?: string;
      processingStatus?: string;
      title?: string;
      tags?: string[];
    },
  ) {
    const response = await apiFetch(`${API_URL}/pdfs/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: updateData.title,
        latexContent: updateData.latexCode,
        status: updateData.processingStatus,
        tags: updateData.tags,
      }),
    });
    return handleResponse(response);
  },

  async deletePdf(id: string) {
    const response = await apiFetch(`${API_URL}/pdfs/${id}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
    });
    return handleResponse(response);
  },
};

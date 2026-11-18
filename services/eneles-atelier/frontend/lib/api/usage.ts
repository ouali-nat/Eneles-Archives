import { API_URL, handleResponse, apiFetch } from "./client";

// Usage API
export const usageAPI = {
  async getCurrentUsage() {
    const response = await apiFetch(`${API_URL}/usage/current`);
    return handleResponse(response);
  },

  async getStatistics() {
    const response = await apiFetch(`${API_URL}/usage/statistics`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    return handleResponse(response);
  },
};

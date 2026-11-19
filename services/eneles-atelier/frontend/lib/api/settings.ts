import { API_URL, handleResponse, apiFetch } from "./client";
import type { PaginatedResponse } from "./types";

// Settings API
export const settingsAPI = {
  async getAppearanceSettings() {
    const response = await apiFetch(`${API_URL}/settings/appearance`);
    return handleResponse(response);
  },

  async updateAppearanceSettings(
    data: {
      theme?: string;
      animationsReducedMotion?: boolean;
      compactMode?: boolean;
    },
  ) {
    const response = await apiFetch(`${API_URL}/settings/appearance`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return handleResponse(response);
  },

  async getNotificationSettings() {
    const response = await apiFetch(`${API_URL}/settings/notifications`);
    return handleResponse(response);
  },

  async updateNotificationSettings(
    data: {
      notifyLowCredits?: boolean;
      emailNotifications?: boolean;
      marketingEmails?: boolean;
      securityAlerts?: boolean;
    },
  ) {
    const response = await apiFetch(`${API_URL}/settings/notifications`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return handleResponse(response);
  },

  async getSessions(
    page = 1,
    limit = 50,
  ): Promise<PaginatedResponse<any>> {
    const response = await apiFetch(
      `${API_URL}/settings/sessions?page=${page}&limit=${limit}`,
      {
      },
    );
    return handleResponse(response);
  },

  async deleteSession(sessionId: number) {
    const response = await apiFetch(`${API_URL}/settings/sessions/${sessionId}`, {
      method: "DELETE",
    });
    return handleResponse(response);
  },

  async getTwoFactorStatus() {
    const response = await apiFetch(`${API_URL}/settings/2fa/status`);
    return handleResponse(response);
  },

  async setupTwoFactor() {
    const response = await apiFetch(`${API_URL}/settings/2fa/setup`, {
      method: "POST",
    });
    return handleResponse(response);
  },

  async enableTwoFactor(secret: string, otpToken: string) {
    const response = await apiFetch(`${API_URL}/settings/2fa/enable`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ secret, token: otpToken }),
    });
    return handleResponse(response);
  },

  async disableTwoFactor(code: string) {
    const response = await apiFetch(`${API_URL}/settings/2fa/disable`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });
    return handleResponse(response);
  },
};

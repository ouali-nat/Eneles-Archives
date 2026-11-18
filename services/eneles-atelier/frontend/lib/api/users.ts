import { API_URL, handleResponse, apiFetch } from "./client";
import type { User } from "./types";

/**
 * Who a verification request is for. Exactly one field is set: `email` for a
 * login (the login response deliberately does not reveal a user id), or a
 * negative pending `userId` for a signup.
 */
export type VerificationIdentity = { email: string } | { userId: number };

export const usersAPI = {
  async signup(userData: {
    email: string;
    name?: string;
  }): Promise<{ userId?: number; email: string; message: string }> {
    const response = await apiFetch(`${API_URL}/auth/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(userData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errorData = JSON.parse(errorText);
        throw new Error(errorData.message || "Signup failed");
      } catch (e) {
        if (e instanceof Error && e.message !== "Signup failed") {
          throw e;
        }
        throw new Error("Signup failed");
      }
    }

    const data = await response.json();
    return data;
  },

  async login(credentials: {
    email: string;
    name?: string;
  }): Promise<{ email: string; message: string }> {
    const response = await apiFetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(credentials),
    });

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errorData = JSON.parse(errorText);
        throw new Error(errorData.message || "Login failed");
      } catch (e) {
        if (e instanceof Error && e.message !== "Login failed") {
          throw e;
        }
        throw new Error("Login failed");
      }
    }

    const data = await response.json();
    return data;
  },

  /**
   * Identifies who is verifying. Login flows pass `{ email }`, since the login
   * response no longer discloses a user id. Signup flows pass the negative
   * pending id as `{ userId }`.
   */
  async verifyLogin(identity: VerificationIdentity, code: string) {
    const response = await apiFetch(`${API_URL}/auth/verify-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...identity, code }),
      credentials: "include",
    });

    return handleResponse(response);
  },

  async verifyApp2FA(identity: VerificationIdentity, code: string) {
    const response = await apiFetch(`${API_URL}/auth/verify-2fa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...identity, code }),
    });
    return handleResponse(response);
  },

  async getProfile(): Promise<User> {
    const response = await apiFetch(`${API_URL}/users/profile`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    return handleResponse(response);
  },

  async updateProfile(
    userData: {
      name?: string;
      email?: string;
      bio?: string;
      affiliation?: string;
      location?: string;
      avatarUrl?: string;
    },
  ) {
    // Use /users/profile directly: the JWT identifies the user server-side,
    // no need for an extra GET round-trip to resolve the user id.
    const response = await apiFetch(`${API_URL}/users/profile`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(userData),
    });
    return handleResponse(response);
  },

  async deleteAccount() {
    const response = await apiFetch(`${API_URL}/users/profile`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
    });
    return handleResponse(response);
  },
};

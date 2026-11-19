import { API_URL, handleResponse, apiFetch } from "./client";

export const billingAPI = {
  /** Whether paid plans can be bought right now. Public. */
  async getStatus(): Promise<{ plansActive: boolean }> {
    const response = await apiFetch(`${API_URL}/billing/status`);
    return handleResponse(response);
  },

  async getSubscription() {
    const response = await apiFetch(`${API_URL}/billing/subscription`);
    return handleResponse(response);
  },

  async createCheckoutSession(
    params: { priceId?: string; plan?: string; interval?: string },
  ) {
    const response = await apiFetch(`${API_URL}/billing/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
    return handleResponse(response);
  },

  async createPortalSession() {
    const response = await apiFetch(`${API_URL}/billing/portal`, {
      method: "POST",
    });
    return handleResponse(response);
  },

  async getPaymentMethods() {
    const response = await apiFetch(`${API_URL}/billing/payment-methods`);
    return handleResponse(response);
  },

  async getInvoices() {
    const response = await apiFetch(`${API_URL}/billing/invoices`);
    return handleResponse(response);
  },

  async getPaymentHistory() {
    const response = await apiFetch(`${API_URL}/billing/payment-history`);
    return handleResponse(response);
  },

  async cancelSubscription(immediate = false) {
    const response = await apiFetch(`${API_URL}/billing/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ immediate }),
    });
    return handleResponse(response);
  },

  async reactivateSubscription() {
    const response = await apiFetch(`${API_URL}/billing/reactivate`, {
      method: "POST",
    });
    return handleResponse(response);
  },
};

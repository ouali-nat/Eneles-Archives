/**
 * Extraction API client
 *
 * Calls the NestJS API extract endpoint (POST /extract) which forwards
 * to Axya, the extraction service (AXYA_SERVICE_URL).
 */

import { API_URL, apiFetch } from "./api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ExtractionResult {
  /** The extracted LaTeX content */
  tex: string;
  /** Number of pages detected (if provided by service) */
  pages?: number;
  /** Which service handled the request */
  service_id?: string;
  /** Raw JSON from the service (for debugging) */
  raw?: Record<string, unknown>;
}

export interface ExtractionError {
  error: string;
  details?: string;
}

// ---------------------------------------------------------------------------
// Client-side helper: calls the NestJS API extract endpoint
// ---------------------------------------------------------------------------

/**
 * Extract LaTeX from a PDF file via the API.
 *
 * @param file       The PDF `File` object (from an <input> or drag-and-drop)
 * @param serviceId  Which backend model to use (default: server-configured)
 */
export async function extractPdfToTex(
  file: File,
  serviceId?: string,
): Promise<ExtractionResult> {
  const formData = new FormData();
  formData.append("file", file);
  if (serviceId) formData.append("service_id", serviceId);

  // Through the API client, so the sign-in goes with it (the endpoint needs one) and the desktop app's requests go through its program.
  const res = await apiFetch(`${API_URL}/extract`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    let msg = `Extraction failed (${res.status})`;
    try {
      const err: ExtractionError = await res.json();
      msg = err.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  return res.json();
}

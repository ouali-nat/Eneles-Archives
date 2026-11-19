import { API_URL } from "@/lib/site-urls";

export { API_URL };

/**
 * Every call to the API goes through here. The sign-in lives in an HttpOnly
 * cookie the API sets, which page scripts cannot read; `credentials:
 * "include"` is what makes the browser send it to the API's host.
 */
let enelesSsoApiToken: string | null = null;

/** The SSO exchange token lives in memory only; a page refresh obtains a fresh one from the Eneles parent session. */
export function setApiSessionToken(token: string | null): void { enelesSsoApiToken = token; }
export function getApiSessionToken(): string | null { return enelesSsoApiToken; }

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (enelesSsoApiToken && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${enelesSsoApiToken}`);
  return fetch(input, { ...init, headers, credentials: "include" });
}

/**
 * An HTTP error with the status and parsed body attached.
 *
 * `handleResponse` used to flatten every failure into a bare `Error` holding
 * only a message string, which meant callers could not distinguish a 409 from
 * a 500, nor read the structured payload the API sends with it. Extending
 * `Error` keeps every existing `catch (e) { e.message }` working unchanged.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The file was modified by someone else since this client last read it. */
  get isVersionConflict(): boolean {
    return this.status === 409;
  }
}

// Error handling wrapper
export const handleResponse = async (response: Response) => {
  if (!response.ok) {
    // Try to get the error details as JSON
    let errorMessage = `API error: ${response.status}`;
    let body: unknown = null;
    try {
      body = await response.json();
      const data = body as { message?: string | string[] };
      if (Array.isArray(data?.message)) errorMessage = data.message.join(", ");
      else if (data?.message) errorMessage = data.message;
    } catch {
      // If the response is not JSON, try to get it as text
      try {
        const errorText = await response.text();
        if (errorText) {
          errorMessage = errorText;
          body = errorText;
        }
      } catch {
        // Failed to parse error response
      }
    }
    throw new ApiError(errorMessage, response.status, body);
  }
  return response.json();
};

/** Payload the API attaches to a 409 from `PUT /projects/:uid/files/:id`. */
export interface FileVersionConflict {
  expectedVersion: number;
  currentVersion: number;
  currentContent: string;
}

/** Narrow an unknown caught value to a file-version conflict. */
export function asVersionConflict(err: unknown): FileVersionConflict | null {
  if (!(err instanceof ApiError) || !err.isVersionConflict) return null;
  const body = err.body as Partial<FileVersionConflict> | null;
  if (!body || typeof body.currentVersion !== "number") return null;
  return {
    expectedVersion: body.expectedVersion ?? -1,
    currentVersion: body.currentVersion,
    currentContent: body.currentContent ?? "",
  };
}

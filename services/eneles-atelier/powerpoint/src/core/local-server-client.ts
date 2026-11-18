import { CompileSvgResult, FontMode, ServerHealth, Settings, TexEngine } from "./types";

function baseUrl(settings: Settings): string {
  return settings.serverUrl.trim().replace(/\/+$/, "");
}

/** Same-origin webpack proxy (`/local-api` → the local compile server). Avoids mixed-content blocks. */
function proxyUrl(path: string): string {
  return `/local-api${path}`;
}

/**
 * Try the packaged app first. Its task pane and compile endpoint share an
 * HTTPS origin, which avoids the browser blocking a loopback HTTP request as
 * mixed content. Development still falls through to the explicit local URL
 * and then to webpack's `/local-api` proxy.
 */
async function fetchLocal(settings: Settings, path: string, init?: RequestInit): Promise<Response> {
  const endpoints = [path, `${baseUrl(settings)}${path}`, proxyUrl(path)];
  let firstError: unknown = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, init);
      // A 404 simply means this host is the webpack development server, not
      // the packaged Eneles host. Other statuses (notably 401) are meaningful
      // responses and must reach the caller unchanged.
      if (response.status !== 404) return response;
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }

  throw firstError instanceof Error
    ? firstError
    : new LocalServerError(
        "Could not reach the local server. Start powerpoint/local-server first.",
        "network",
      );
}

/**
 * The packaged desktop app keeps its compile API on the same HTTPS origin.
 * It can therefore supply its per-install token without asking the user to
 * copy it. The development server intentionally has no such endpoint, so a
 * missing endpoint is normal and returns null.
 */
export async function loadPackagedServerToken(): Promise<string | null> {
  try {
    const response = await fetch("/local-token", { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as { token?: unknown };
    return typeof data.token === "string" && data.token.trim() ? data.token : null;
  } catch {
    return null;
  }
}

export class LocalServerError extends Error {
  constructor(
    message: string,
    public readonly kind: "network" | "auth" | "server" = "server",
  ) {
    super(message);
    this.name = "LocalServerError";
  }
}

/** GET /health. Also probes whether the local server is running. */
export async function checkHealth(settings: Settings): Promise<ServerHealth> {
  let response: Response;
  try {
    response = await fetchLocal(settings, "/health", { method: "GET" });
  } catch {
    throw new LocalServerError(
      "Could not reach the local server. Start powerpoint/local-server first.",
      "network",
    );
  }
  if (!response.ok) {
    throw new LocalServerError(`Local server returned HTTP ${response.status}`, "server");
  }
  return (await response.json()) as ServerHealth;
}

export interface RenderOptions {
  source: string;
  engine: TexEngine;
  preamble: string;
  border: string;
  fontMode: FontMode;
}

/** POST /compile/svg against the local server. Never leaves this machine. */
export async function renderFullLatex(settings: Settings, opts: RenderOptions): Promise<CompileSvgResult> {
  let response: Response;
  try {
    response = await fetchLocal(settings, "/compile/svg", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Eneles-Token": settings.serverToken,
      },
      body: JSON.stringify(opts),
    });
  } catch {
    throw new LocalServerError(
      "Could not reach the local server. Start powerpoint/local-server first.",
      "network",
    );
  }

  if (response.status === 401) {
    throw new LocalServerError(
      "Token mismatch. Copy the token from the local server window into Settings.",
      "auth",
    );
  }

  const data = (await response.json().catch(() => null)) as CompileSvgResult | null;
  if (!data) {
    throw new LocalServerError(`Local server returned an unreadable response (HTTP ${response.status})`, "server");
  }
  return data;
}

export interface HistoryFileResult {
  success: boolean;
  errors?: string[];
}

async function postHistoryAction(settings: Settings, path: string, body: unknown): Promise<HistoryFileResult> {
  let response: Response;
  try {
    response = await fetchLocal(settings, path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Eneles-Token": settings.serverToken,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new LocalServerError("Could not reach the local server.", "network");
  }
  if (response.status === 401) {
    throw new LocalServerError("Token mismatch. Copy the token from the local server window into Settings.", "auth");
  }
  const data = (await response.json().catch(() => null)) as HistoryFileResult | null;
  if (!data) {
    throw new LocalServerError(`Local server returned an unreadable response (HTTP ${response.status})`, "server");
  }
  return data;
}

/** Persists a render's final SVG so the Recents tab's "open file location" has something real to point at. */
export function saveHistoryFile(settings: Settings, id: string, svg: string): Promise<HistoryFileResult> {
  return postHistoryAction(settings, "/history/save", { id, svg });
}

/** Reveals the saved render in Windows Explorer. */
export function openHistoryFile(settings: Settings, id: string): Promise<HistoryFileResult> {
  return postHistoryAction(settings, "/history/open", { id });
}

/** Deletes the saved render file. The history entry itself lives in localStorage; see src/core/history.ts. */
export function deleteHistoryFile(settings: Settings, id: string): Promise<HistoryFileResult> {
  return postHistoryAction(settings, "/history/delete", { id });
}

import { API_URL, handleResponse, apiFetch } from "./client";

export interface GithubStatus {
  linked: boolean;
  /** Linking, pushing, and pulling are the owner's. */
  canSync: boolean;
  repo?: string;
  branch?: string;
  lastCommitSha?: string | null;
  lastSyncedAt?: string | null;
  url?: string;
  remoteHasCommits?: boolean;
}

export interface GithubPullResult {
  upToDate: boolean;
  commit?: string;
  updated: string[];
  added: string[];
  removed: string[];
  conflicts: { path: string; copy?: string; reason: string }[];
  skipped: { path: string; reason: string }[];
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const base = (uid: string) => `${API_URL}/projects/${encodeURIComponent(uid)}/github`;

export const githubAPI = {
  async status(uid: string): Promise<GithubStatus> {
    return handleResponse(await apiFetch(base(uid)));
  },
  async link(uid: string, data: { repo: string; branch?: string; token: string }): Promise<GithubStatus> {
    return handleResponse(await apiFetch(base(uid), post(data)));
  },
  async unlink(uid: string): Promise<GithubStatus> {
    return handleResponse(await apiFetch(base(uid), { method: "DELETE" }));
  },
  async push(uid: string, message?: string): Promise<{ upToDate: boolean; commit?: string; changed?: number; deleted?: number }> {
    return handleResponse(await apiFetch(`${base(uid)}/push`, post({ message })));
  },
  async pull(uid: string, preferGithub = false): Promise<GithubPullResult> {
    return handleResponse(await apiFetch(`${base(uid)}/pull`, post({ preferGithub })));
  },
};

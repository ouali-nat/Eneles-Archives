import { API_URL, handleResponse, apiFetch } from "./client";

export interface LookedUpReference {
  key: string;
  bibtex: string;
  source: "doi" | "arxiv";
  title?: string;
}

export const referencesAPI = {
  /** A BibTeX entry for a DOI or an arXiv ID. */
  async lookup(id: string): Promise<LookedUpReference> {
    return handleResponse(await apiFetch(`${API_URL}/references/lookup?id=${encodeURIComponent(id)}`));
  },
  /** Add text at the end of a project file, live when it is open. */
  async appendToFile(projectUid: string, path: string, text: string): Promise<{ path: string; live: boolean; created?: boolean }> {
    return handleResponse(
      await apiFetch(`${API_URL}/projects/${encodeURIComponent(projectUid)}/files/append`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, text }),
      }),
    );
  },
};

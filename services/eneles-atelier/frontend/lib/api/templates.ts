import { API_URL, handleResponse, apiFetch } from "./client";

/** Template PDF/thumbnail URLs (public, no auth). Prebuilt files in builds bucket. */
export async function getTemplatePdfUrl(templateId: string): Promise<string> {
  const response = await apiFetch(
    `${API_URL}/templates/prebuilt/${encodeURIComponent(templateId)}/pdf`,
  );
  const data = await handleResponse(response);
  return data.url;
}

export async function getTemplateThumbUrl(templateId: string): Promise<string> {
  const response = await apiFetch(
    `${API_URL}/templates/prebuilt/${encodeURIComponent(templateId)}/thumb`,
  );
  const data = await handleResponse(response);
  return data.url;
}

export type TemplateReview = "none" | "pending" | "approved" | "rejected";

/** A template saved by a person, as opposed to the built-in library ones. */
export interface UserTemplate {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  category: string;
  isPublic: boolean;
  review: TemplateReview;
  tags: string[];
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  /** Author's own templates only. */
  reviewNote?: string | null;
  reportCount?: number;
  content?: string;
  files?: { path: string; content: string }[] | null;
  user?: { id: number; name: string | null; email?: string };
}

interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const userTemplatesAPI = {
  /** Approved shared templates and your own. */
  async list(params: { search?: string; page?: number; limit?: number } = {}): Promise<Page<UserTemplate>> {
    const q = new URLSearchParams();
    if (params.search) q.set("search", params.search);
    q.set("page", String(params.page ?? 1));
    q.set("limit", String(params.limit ?? 50));
    return handleResponse(await apiFetch(`${API_URL}/templates?${q}`));
  },
  async mine(): Promise<Page<UserTemplate>> {
    return handleResponse(await apiFetch(`${API_URL}/templates/mine?limit=100`));
  },
  async get(id: number): Promise<UserTemplate> {
    return handleResponse(await apiFetch(`${API_URL}/templates/${id}`));
  },
  async fromProject(
    projectUid: string,
    data: { name: string; description?: string; isPublic?: boolean },
  ): Promise<{ template: UserTemplate; leftOut: number }> {
    return handleResponse(
      await apiFetch(`${API_URL}/templates/from-project/${encodeURIComponent(projectUid)}`, json(data)),
    );
  },
  async update(id: number, data: Partial<Pick<UserTemplate, "name" | "description" | "isPublic" | "tags">>): Promise<UserTemplate> {
    return handleResponse(
      await apiFetch(`${API_URL}/templates/${id}`, { ...json(data), method: "PUT" }),
    );
  },
  async remove(id: number): Promise<void> {
    await handleResponse(await apiFetch(`${API_URL}/templates/${id}`, { method: "DELETE" }));
  },
  async use(id: number, title?: string): Promise<{ uid: string; title: string }> {
    return handleResponse(await apiFetch(`${API_URL}/templates/${id}/use`, json({ title })));
  },
  async report(id: number, reason?: string): Promise<void> {
    await handleResponse(await apiFetch(`${API_URL}/templates/${id}/report`, json({ reason })));
  },
  async reviewAccess(): Promise<{ reviewer: boolean }> {
    return handleResponse(await apiFetch(`${API_URL}/templates/review/access`));
  },
  async reviewQueue(): Promise<Page<UserTemplate>> {
    return handleResponse(await apiFetch(`${API_URL}/templates/review?limit=50`));
  },
  async decide(id: number, decision: "approve" | "reject", note?: string): Promise<UserTemplate> {
    return handleResponse(await apiFetch(`${API_URL}/templates/${id}/review`, json({ decision, note })));
  },
};

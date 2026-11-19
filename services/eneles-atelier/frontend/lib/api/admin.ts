import { API_URL, apiFetch, handleResponse } from "./client";

/**
 * The operators' panel. It answers only for administrators: the root account, and accounts whose administrator flag is on. Most routes only read; the account actions (disable, sign out, change plan, and the rest) change one account each and are written to the audit log. None of them returns what people wrote: no project titles or files, no snip or PDF contents.
 */

export type SortOrder = "asc" | "desc";

export interface DayCount {
  day: string;
  count: number;
}

export interface Tally {
  name: string;
  count: number;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface AdminMe {
  id: number;
  email: string;
  name: string;
  /** The root administrator: the one account that can make others administrators. */
  root: boolean;
}

export interface AdminOverview {
  generatedAt: string;
  users: {
    total: number;
    deleted: number;
    suspended: number;
    verified: number;
    twoFactor: number;
    byPlan: Record<string, number>;
    new: { day: number; week: number; month: number };
    active: { day: number; week: number; month: number };
  };
  sessions: { live: number; countries: Tally[]; devices: Tally[]; browsers: Tally[]; systems: Tally[] };
  content: { projects: number; references: number; files: number; sharedProjects: number; githubLinked: number; snips: number; pdfs: number; templates: number; apiKeys: number };
  storage: { pdfBytes: number; snipBytes: number; projectAssetBytes: number; totalBytes: number };
  thisMonth: { snipConversions: number; pdfPages: number; aiCalls: number; aiRequests: number; aiInputTokens: number; aiOutputTokens: number };
  billing: { subscriptions: Record<string, number>; revenue30d: { amount: number; currency: string; payments: number } };
  series: { days: number; signups: DayCount[]; projects: DayCount[]; snips: DayCount[]; logins: DayCount[]; aiRequests: DayCount[] };
}

export interface AdminUserRow {
  id: number;
  email: string;
  name: string;
  plan: string;
  status: string;
  verified: boolean;
  twoFactorEnabled: boolean;
  isAdmin: boolean;
  createdAt: string;
  lastActive: string | null;
  country: string | null;
  projects: number;
  snips: number;
  pdfs: number;
  liveSessions: number;
  storageBytes: number;
  aiRequests30d: number;
}

export interface AdminSession {
  id: number;
  userId: number;
  deviceType: string;
  browser: string;
  os: string;
  ipAddress: string | null;
  country: string | null;
  isActive: boolean;
  live: boolean;
  lastActive: string;
  expiresAt: string;
  createdAt: string;
  user?: { email: string; name: string };
}

export interface AdminAuditEvent {
  id: number;
  userId: number | null;
  email?: string | null;
  /** On the user page: the operator who did this, when it was not the account itself. */
  actor?: string | null;
  /** In the audit log: the account an operator acted on. */
  target?: { id: number; email: string | null } | null;
  action: string;
  resource?: string | null;
  outcome: string;
  ipAddress: string | null;
  country: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AiKindUse {
  kind: string;
  calls: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  audioBytes: number;
}

export interface AdminUserDetail {
  user: {
    id: number;
    email: string;
    name: string;
    affiliation: string | null;
    accountStatus: string;
    subscriptionType: string;
    verified: boolean;
    twoFactorEnabled: boolean;
    isAdmin: boolean;
    /** The root administrator's own account, which the panel cannot change. */
    root: boolean;
    createdAt: string;
    updatedAt: string;
    subscription: { status: string; stripeCurrentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; createdAt: string } | null;
  };
  counts: { projects: number; references: number; sharedWithOthers: number; collaborations: number; files: number; snips: number; pdfs: number; pdfPages: number; templates: number; apiKeys: number; sessions: number };
  storage: AdminOverview["storage"];
  lastProjectActivity: string | null;
  apiKeys: { id: number; keyPrefix: string; lastUsedAt: string | null; createdAt: string }[];
  sessions: AdminSession[];
  usage: { month: number; year: number; snipsUsed: number; pdfPagesUsed: number }[];
  ai: { byKind: AiKindUse[]; perDay: DayCount[] };
  payments: { id: number; amount: number; currency: string; status: string; createdAt: string }[];
  liveSessions: number;
  audit: AdminAuditEvent[];
}

export interface AdminBilling {
  currency: string;
  otherCurrencies: { currency: string; amount: number }[];
  subscriptions: Record<string, number>;
  endingAtPeriodEnd: number;
  plans: Record<string, number>;
  revenue: { last30: { amount: number; payments: number }; allTime: { amount: number; payments: number }; failed30: number };
  /** Revenue per month in the main currency's smallest unit; `day` is the month ("2026-11"). */
  perMonth: DayCount[];
}

export interface AdminPayment {
  id: number;
  userId: number;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  email: string;
  name: string;
  plan: string;
}

export interface AdminStorage {
  days: number;
  totals: { bytes: number; pdf: { bytes: number; files: number }; snip: { bytes: number; files: number }; project: { bytes: number; files: number }; addedInRange: number };
  series: { pdf: DayCount[]; snip: DayCount[]; project: DayCount[] };
  largest: { userId: number; email: string; name: string; plan: string; status: string; pdfBytes: number; snipBytes: number; projectBytes: number; totalBytes: number; files: number }[];
}

export interface AdminContent {
  days: number;
  totals: { projects: number; archived: number; references: number; files: number; folders: number; shared: number; githubLinked: number; collaborators: number; pendingInvitations: number; templates: number; publicTemplates: number; snips: number; pdfs: number; pdfPages: number };
  projectAccess: Tally[];
  snipStatus: Tally[];
  pdfStatus: Tally[];
  series: { projects: DayCount[]; files: DayCount[]; snips: DayCount[]; pdfs: DayCount[] };
}

export type AdminPlan = "free" | "pro" | "team" | "enterprise";

export interface AdminAi {
  days: number;
  totals: { calls: number; failures: number; requests: number; inputTokens: number; outputTokens: number; audioBytes: number; averageMs: number };
  byKind: AiKindUse[];
  byModel: { provider: string | null; model: string | null; calls: number; requests: number; inputTokens: number; outputTokens: number }[];
  topUsers: { userId: number; email: string | null; name: string | null; plan: string | null; calls: number; requests: number; inputTokens: number; outputTokens: number }[];
  series: { requests: DayCount[]; tokens: DayCount[]; users: DayCount[] };
}

interface Check {
  ok: boolean;
  ms: number;
  error?: string;
}

export interface AdminSystem {
  generatedAt: string;
  api: {
    version: string;
    node: string;
    environment: string;
    startedAt: string;
    uptimeSeconds: number;
    memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
    eventLoop: { meanMs: number; p99Ms: number };
  };
  database: Check & { pool: { totalCount: number; idleCount: number; waitingCount: number }; sizeBytes: number | null };
  redis: Check & { usedBytes?: number; peakBytes?: number; maxBytes?: number; keys?: number };
  compiler: Check & { engines?: string[] | null; active?: number | null; queued?: number | null; capacity?: number | null };
  collaboration: { sockets: number; rooms: number; documents: number };
}

type Params = Record<string, string | number | boolean | undefined | null>;

async function get<T>(path: string, params: Params = {}): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "" && value !== false) query.set(key, value === true ? "1" : String(value));
  const suffix = query.size ? `?${query}` : "";
  return handleResponse(await apiFetch(`${API_URL}/admin/${path}${suffix}`)) as Promise<T>;
}

async function send<T>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  return handleResponse(
    await apiFetch(`${API_URL}/admin/${path}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }),
  ) as Promise<T>;
}

export const adminAPI = {
  /** Emails a six-digit sign-in code, to administrators only. The answer is the same for any address; the code is then checked by the site's own verification. */
  async requestCode(email: string): Promise<{ email: string; message: string }> {
    return handleResponse(await apiFetch(`${API_URL}/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }));
  },
  /** Give or take another account's administrator flag. Root only. */
  async setAdmin(id: number, isAdmin: boolean): Promise<{ id: number; isAdmin: boolean }> {
    return handleResponse(await apiFetch(`${API_URL}/admin/users/${id}/admin`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isAdmin }) }));
  },
  /** Disable an account (it cannot sign in, and its sessions end now), or enable it again. */
  setStatus: (id: number, status: "active" | "suspended") => send<{ id: number; status: string; sessionsEnded: number }>("PUT", `users/${id}/status`, { status }),
  signOutEverywhere: (id: number) => send<{ id: number; sessionsEnded: number }>("POST", `users/${id}/sign-out`),
  markVerified: (id: number) => send<{ id: number }>("POST", `users/${id}/verify`),
  disableTwoFactor: (id: number) => send<{ id: number }>("DELETE", `users/${id}/two-factor`),
  /** The plan on the account only; Stripe is not told. */
  setPlan: (id: number, plan: AdminPlan) => send<{ id: number; from: string; to: string }>("PUT", `users/${id}/plan`, { plan }),
  /** Root only. Signs the account out everywhere. */
  changeEmail: (id: number, email: string) => send<{ id: number; from: string; to: string }>("PUT", `users/${id}/email`, { email }),
  /** Root only. `confirmEmail` must repeat the account's address. */
  deleteUser: (id: number, confirmEmail: string) => send<{ id: number }>("DELETE", `users/${id}`, { confirmEmail }),
  me: () => get<AdminMe>("me"),
  overview: (days = 30) => get<AdminOverview>("overview", { days }),
  users: (params: { search?: string; plan?: string; status?: string; sort?: string; order?: SortOrder; page?: number; limit?: number }) => get<{ data: AdminUserRow[]; meta: PageMeta }>("users", params),
  user: (id: number) => get<AdminUserDetail>(`users/${id}`),
  sessions: (params: { live?: boolean; search?: string; sort?: string; order?: SortOrder; page?: number; limit?: number }) => get<{ data: AdminSession[]; meta: PageMeta }>("sessions", params),
  audit: (params: { action?: string; outcome?: string; userId?: number; ip?: string; sort?: string; order?: SortOrder; page?: number; limit?: number }) => get<{ data: AdminAuditEvent[]; meta: PageMeta; actions: { action: string; count: number }[] }>("audit", params),
  ai: (days = 30) => get<AdminAi>("ai", { days }),
  billing: (months = 12) => get<AdminBilling>("billing", { months }),
  payments: (params: { status?: string; search?: string; sort?: string; order?: SortOrder; page?: number; limit?: number }) => get<{ data: AdminPayment[]; meta: PageMeta }>("payments", params),
  storage: (days = 30) => get<AdminStorage>("storage", { days }),
  content: (days = 30) => get<AdminContent>("content", { days }),
  system: () => get<AdminSystem>("system"),
  /** Email sent through Resend and what happened to it (from Resend's webhook). */
  emails: (params: { days?: number; status?: string; kind?: string; search?: string; page?: number; limit?: number }) => get<AdminEmails>("emails", params),
  email: (id: number) => get<AdminEmailDetail>(`emails/${id}`),
  /** Platform AI: whether subscribers may use the platform's own model keys. */
  platformAi: () => get<AdminPlatformAi>("platform-ai"),
  /** Root only. */
  setPlatformAi: (enabled: boolean) => send<AdminPlatformAi>("PUT", "platform-ai", { enabled }),
};

export interface AdminPlatformAi {
  enabled: boolean;
  /** A platform key (ANTHROPIC_API_KEY or OPENAI_API_KEY) is set on the server. */
  configured: boolean;
  provider: string | null;
  model: string | null;
  updatedAt: string | null;
  updatedBy: number | null;
}

/** How far an email got, the furthest first: a bounce is never hidden by a later open. */
export type EmailStatus = "sent" | "delivery_delayed" | "delivered" | "opened" | "clicked" | "failed" | "bounced" | "complained";

export interface AdminEmailRow {
  id: number;
  resendId: string;
  /** "sign-in code", "admin sign-in code", "invitation", "contact", or "other". */
  kind: string;
  recipients: string[];
  /** Never kept for sign-in codes; code-like numbers in others are masked. */
  subject: string | null;
  status: EmailStatus;
  bounceType: string | null;
  createdAt: string;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  lastEventAt: string | null;
}

export interface AdminEmails {
  days: number;
  totals: { all: number } & Partial<Record<EmailStatus, number>>;
  byKind: { kind: string; count: number }[];
  series: { sent: DayCount[]; delivered: DayCount[]; bounced: DayCount[] };
  data: AdminEmailRow[];
  meta: PageMeta;
}

export interface AdminEmailDetail extends AdminEmailRow {
  sender: string | null;
  bounceMessage: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
  events: { id: number; type: string; occurredAt: string; detail: Record<string, string> | null }[];
}

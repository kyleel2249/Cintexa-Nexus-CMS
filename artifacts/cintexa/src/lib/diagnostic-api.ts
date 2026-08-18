export type DiagnosticProfilePayload = {
  companyName: string;
  website?: string;
  industry?: string;
  subIndustry?: string;
  businessModel?: string;
  geographicMarkets?: string;
  companySize?: string;
  revenueRange?: string;
  strategicObjectives?: string;
  [key: string]: unknown;
};

export type DiagnosticSessionPayload = {
  profileId: number;
  mode: string;
  status?: string;
  currentStep?: number;
  totalSteps?: number;
  answers?: Record<string, unknown>;
  pillarScores?: Record<string, number>;
  overallScore?: number | null;
  [key: string]: unknown;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Diagnostic API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const diagnosticApi = {
  createProfile: (payload: DiagnosticProfilePayload) =>
    request<Record<string, unknown>>("/diagnostics/profiles", { method: "POST", body: JSON.stringify(payload) }),

  createSession: (payload: DiagnosticSessionPayload) =>
    request<Record<string, unknown>>("/diagnostics/sessions", { method: "POST", body: JSON.stringify(payload) }),

  updateSession: (id: number, payload: Partial<DiagnosticSessionPayload> & Record<string, unknown>) =>
    request<Record<string, unknown>>(`/diagnostics/sessions/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  analyze: (payload: { metrics: Record<string, unknown>; pillarScores: Record<string, number> }) =>
    request<Record<string, unknown>>("/diagnostics/analyze", { method: "POST", body: JSON.stringify(payload) }),

  validateSmart: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>("/diagnostics/smart/validate", { method: "POST", body: JSON.stringify(payload) }),

  createCompetitor: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>("/diagnostics/competitors", { method: "POST", body: JSON.stringify(payload) }),

  createGoal: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>("/diagnostics/goals", { method: "POST", body: JSON.stringify(payload) }),

  fullReport: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>("/diagnostics/report", { method: "POST", body: JSON.stringify(payload) }),

  research: (payload: {
    companyName?: string;
    companyWebsite?: string;
    industry?: string;
    competitors?: Array<string | { name: string; website?: string }>;
    sessionId?: number;
    profileId?: number;
  }) => request<Record<string, unknown>>("/diagnostics/research", { method: "POST", body: JSON.stringify(payload) }),

  uploadDocuments: (files: Array<{ name: string; mimeType?: string; size?: number; text?: string }>) =>
    request<Record<string, unknown>>("/diagnostics/documents", { method: "POST", body: JSON.stringify({ files }) }),

  benchmarks: (industry?: string) =>
    request<Record<string, unknown>>(`/diagnostics/benchmarks${industry ? `?industry=${encodeURIComponent(industry)}` : ""}`),

  logTask: (payload: {
    sessionId?: number;
    profileId?: number;
    taskType: string;
    title: string;
    detail?: string;
    status?: string;
    actor?: string;
    metadata?: Record<string, unknown>;
  }) => request<Record<string, unknown>>("/diagnostics/history", { method: "POST", body: JSON.stringify(payload) }),

  saveSnapshot: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>("/diagnostics/snapshots", { method: "POST", body: JSON.stringify(payload) }),

  listSnapshots: (params?: { company?: string; profileId?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.company) q.set("company", params.company);
    if (params?.profileId) q.set("profileId", String(params.profileId));
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<{ items: Array<Record<string, unknown>>; count: number }>(`/diagnostics/snapshots${qs ? `?${qs}` : ""}`);
  },

  compareSnapshots: (aId: number, bId: number) =>
    request<Record<string, unknown>>("/diagnostics/snapshots/compare", { method: "POST", body: JSON.stringify({ aId, bId }) }),

  connectorCatalog: () => request<{ items: Array<Record<string, unknown>> }>("/diagnostics/connectors/catalog"),

  listConnectors: (profileId?: number) => {
    const q = profileId != null ? `?profileId=${profileId}` : "";
    return request<{ items: Array<Record<string, unknown>> }>(`/diagnostics/connectors${q}`);
  },

  registerConnector: (payload: { provider: string; profileId?: number; displayName?: string; config?: Record<string, unknown> }) =>
    request<Record<string, unknown>>("/diagnostics/connectors", { method: "POST", body: JSON.stringify(payload) }),

  syncConnector: (id: number) =>
    request<Record<string, unknown>>(`/diagnostics/connectors/${id}/sync`, { method: "POST", body: "{}" }),

  listHistory: (params?: { sessionId?: number; profileId?: number }) => {
    const q = new URLSearchParams();
    if (params?.sessionId) q.set("sessionId", String(params.sessionId));
    if (params?.profileId) q.set("profileId", String(params.profileId));
    const qs = q.toString();
    return request<Array<Record<string, unknown>>>(`/diagnostics/history${qs ? `?${qs}` : ""}`);
  },
};

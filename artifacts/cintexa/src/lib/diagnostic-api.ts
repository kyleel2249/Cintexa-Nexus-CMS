export type DiagnosticProfilePayload = {
  companyName: string;
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

  research: (payload: { companyName?: string; industry?: string; competitors?: string[] }) =>
    request<Record<string, unknown>>("/diagnostics/research", { method: "POST", body: JSON.stringify(payload) }),

  uploadDocuments: (files: Array<{ name: string; mimeType?: string; size?: number; text?: string }>) =>
    request<Record<string, unknown>>("/diagnostics/documents", { method: "POST", body: JSON.stringify({ files }) }),

  benchmarks: (industry?: string) =>
    request<Record<string, unknown>>(`/diagnostics/benchmarks${industry ? `?industry=${encodeURIComponent(industry)}` : ""}`),
};

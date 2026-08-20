const BASE = "/api/sales-force";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const salesForceApi = {
  bootstrap: () => request<{ ok: boolean; seeded?: boolean }>("/bootstrap", { method: "POST", body: "{}" }),
  agents: () => request<{ items: any[]; source?: string }>("/agents"),
  updateAgent: (id: number, payload: Record<string, unknown>) =>
    request(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  stages: () => request<{ items: Array<{ id: string; label: string; probability: number }> }>("/pipeline/stages"),
  leads: (stage?: string) => request<{ items: any[]; count: number }>(`/leads${stage ? `?stage=${stage}` : ""}`),
  createLead: (payload: Record<string, unknown>) =>
    request<any>("/leads", { method: "POST", body: JSON.stringify(payload) }),
  scoreLead: (id: number, payload?: Record<string, unknown>) =>
    request(`/leads/${id}/score`, { method: "POST", body: JSON.stringify(payload || {}) }),
  assignLead: (id: number, agentId: number | null) =>
    request(`/leads/${id}/assign`, { method: "POST", body: JSON.stringify({ agentId }) }),
  setLeadStage: (id: number, stage: string) =>
    request(`/leads/${id}/stage`, { method: "POST", body: JSON.stringify({ stage }) }),
  opportunities: () => request<{ items: any[] }>("/opportunities"),
  createOpportunity: (payload: Record<string, unknown>) =>
    request("/opportunities", { method: "POST", body: JSON.stringify(payload) }),
  setOppStage: (id: number, stage: string, extra?: Record<string, unknown>) =>
    request(`/opportunities/${id}/stage`, { method: "POST", body: JSON.stringify({ stage, ...extra }) }),
  createProposal: (payload: Record<string, unknown>) =>
    request("/proposals", { method: "POST", body: JSON.stringify(payload) }),
  proposals: () => request<{ items: any[] }>("/proposals"),
  forecast: () => request<Record<string, unknown>>("/forecast"),
  closeTheGap: (payload: { target: number; actual: number; avgDealSize?: number; winRatePercent?: number }) =>
    request<Record<string, any>>("/close-the-gap", { method: "POST", body: JSON.stringify(payload) }),
  commandCenter: () => request<Record<string, unknown>>("/command-center"),
  generateSales: (target?: number) =>
    request<Record<string, any>>("/generate-sales", { method: "POST", body: JSON.stringify({ target }) }),
  whoToContact: () => request<{ items: any[] }>("/who-to-contact"),
  objection: (text: string) => request<Record<string, any>>("/objection", { method: "POST", body: JSON.stringify({ text }) }),
  activities: (leadId?: number) =>
    request<{ items: any[] }>(`/activities${leadId ? `?leadId=${leadId}` : ""}`),
  audit: () => request<{ items: any[] }>("/audit"),
  followUpSequence: () => request<{ items: any[] }>("/follow-up-sequence"),
  knowledge: () => request<{ items: any[] }>("/knowledge"),
  addKnowledge: (payload: Record<string, unknown>) =>
    request("/knowledge", { method: "POST", body: JSON.stringify(payload) }),

  prepareOutreach: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>("/outreach/prepare", { method: "POST", body: JSON.stringify(payload) }),

  outreachEmail: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>("/outreach/email", { method: "POST", body: JSON.stringify(payload) }),

  fromDiagnostic: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>("/from-diagnostic", { method: "POST", body: JSON.stringify(payload) }),

  playbooks: () => request<{ items: any[] }>("/playbooks"),

  savePlaybook: (payload: Record<string, unknown>) =>
    request("/playbooks", { method: "POST", body: JSON.stringify(payload) }),

  evaluatePlaybook: (payload: { rules?: unknown[]; context: Record<string, unknown> }) =>
    request<{ matched: any[]; actions: any[] }>("/playbooks/evaluate", { method: "POST", body: JSON.stringify(payload) }),

  whatToSell: () => request<{ items: any[]; note?: string }>("/what-to-sell"),

  qualifyBant: (payload: Record<string, unknown>) =>
    request<Record<string, any>>("/qualify/bant", { method: "POST", body: JSON.stringify(payload) }),

  detectIntent: (payload: Record<string, unknown>) =>
    request("/intent", { method: "POST", body: JSON.stringify(payload) }),

  negotiate: (payload: Record<string, unknown>) =>
    request<Record<string, any>>("/negotiate", { method: "POST", body: JSON.stringify(payload) }),

  negotiationPolicy: () => request<{ policy: Record<string, unknown> }>("/negotiation-policy"),

  handoff: (payload: Record<string, unknown>) =>
    request("/handoff", { method: "POST", body: JSON.stringify(payload) }),

  createQuote: (payload: Record<string, unknown>) =>
    request<Record<string, any>>("/quotes", { method: "POST", body: JSON.stringify(payload) }),

  markLost: (id: number, payload: Record<string, unknown>) =>
    request(`/opportunities/${id}/lost`, { method: "POST", body: JSON.stringify(payload) }),

  dailyBrief: (target?: number) =>
    request<Record<string, unknown>>(`/daily-brief${target != null ? `?target=${target}` : ""}`),

  sequenceCheck: (payload: Record<string, unknown>) =>
    request("/sequence/check", { method: "POST", body: JSON.stringify(payload) }),

  nextOffer: (payload: Record<string, unknown>) =>
    request("/next-offer", { method: "POST", body: JSON.stringify(payload) }),

  campaigns: () => request<{ items: any[] }>("/campaigns"),

  createCampaign: (payload: Record<string, unknown>) =>
    request("/campaigns", { method: "POST", body: JSON.stringify(payload) }),

  createAgent: (payload: Record<string, unknown>) =>
    request("/agents", { method: "POST", body: JSON.stringify(payload) }),

  listMemory: (params?: { leadId?: number; agentId?: number }) => {
    const q = new URLSearchParams();
    if (params?.leadId) q.set("leadId", String(params.leadId));
    if (params?.agentId) q.set("agentId", String(params.agentId));
    const qs = q.toString();
    return request<{ items: any[] }>(`/memory${qs ? `?${qs}` : ""}`);
  },

  addMemory: (payload: Record<string, unknown>) =>
    request("/memory", { method: "POST", body: JSON.stringify(payload) }),

  seedDemo: () => request("/demo/seed", { method: "POST", body: "{}" }),

  sequencesDue: () => request<{ planned: any[]; note?: string }>("/sequences/due"),

  runSequences: (payload?: { execute?: boolean; autonomyLevel?: number }) =>
    request("/sequences/run", { method: "POST", body: JSON.stringify(payload || {}) }),

  performance: () => request<{ items: any[] }>("/performance"),

  reactivation: () => request<Record<string, any>>("/reactivation"),

  upsell: (payload: Record<string, unknown>) =>
    request("/upsell", { method: "POST", body: JSON.stringify(payload) }),

  attribution: () => request<Record<string, unknown>>("/attribution"),

  command: (command: string) =>
    request<{ intent: string; result: any; message: string }>("/command", { method: "POST", body: JSON.stringify({ command }) }),

  getSettings: () => request<{ settings: Record<string, any>; source?: string }>("/settings"),

  saveSettings: (settings: Record<string, unknown>) =>
    request("/settings", { method: "PUT", body: JSON.stringify(settings) }),

  meetings: () => request<{ items: any[] }>("/meetings"),

  bookMeeting: (payload: Record<string, unknown>) =>
    request("/meetings", { method: "POST", body: JSON.stringify(payload) }),

  training: () => request<Record<string, any>>("/training"),

  createHandoff: (payload: Record<string, unknown>) =>
    request("/handoff/create", { method: "POST", body: JSON.stringify(payload) }),
};





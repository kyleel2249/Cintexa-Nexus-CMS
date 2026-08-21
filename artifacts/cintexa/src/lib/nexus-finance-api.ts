const BASE = "/api/nexus/finance";

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

export const nexusFinanceApi = {
  health: () => request<Record<string, unknown>>("/health"),
  analyses: () => request<{ items: any[] }>("/analyses"),
  analyze: (payload: Record<string, unknown>) =>
    request<any>("/analyze", { method: "POST", body: JSON.stringify(payload) }),
  scenarios: (payload: Record<string, unknown>) =>
    request<any>("/scenarios", { method: "POST", body: JSON.stringify(payload) }),
  cfoChat: (payload: { question: string; analysisId?: string }) =>
    request<any>("/cfo-chat", { method: "POST", body: JSON.stringify(payload) }),
};

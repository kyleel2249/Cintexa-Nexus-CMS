const BASE = "/api/nexus/cd-optimizer";

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

export const cdOptimizerApi = {
  health: () => request<Record<string, unknown>>("/health"),
  metrics: () => request<Record<string, unknown>>("/metrics"),
  jobs: () => request<{ items: any[] }>("/jobs"),
  job: (id: string) => request<any>(`/jobs/${id}`),
  compress: (payload: { filename: string; dataBase64: string; mode?: string; mimeType?: string }) =>
    request<any>("/compress", { method: "POST", body: JSON.stringify(payload) }),
  analyze: (payload: { filename: string; dataBase64: string }) =>
    request<any>("/analyze", { method: "POST", body: JSON.stringify(payload) }),
  batch: (files: Array<{ filename: string; dataBase64: string; mimeType?: string }>, mode?: string) =>
    request<{ items: any[] }>("/batch", { method: "POST", body: JSON.stringify({ files, mode }) }),
  downloadUrl: (id: string) => `${BASE}/jobs/${id}/download`,
};

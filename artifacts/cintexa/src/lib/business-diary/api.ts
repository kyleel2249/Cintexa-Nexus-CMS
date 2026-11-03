import { apiJson } from "@/lib/api";

const BD = "/diary";

export function bdGet<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
  const q = new URLSearchParams();
  if (query) for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
  const qs = q.toString();
  return apiJson<T>(`${BD}${path.startsWith("/") ? path : `/${path}`}${qs ? `?${qs}` : ""}`);
}

export function bdPost<T>(path: string, body?: unknown): Promise<T> {
  return apiJson<T>(`${BD}${path.startsWith("/") ? path : `/${path}`}`, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function bdPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiJson<T>(`${BD}${path.startsWith("/") ? path : `/${path}`}`, {
    method: "PATCH",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

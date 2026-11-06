import { apiJson } from "@/lib/api";

const C = "/csi";

export function csiGet<T>(path: string, q?: Record<string, string | undefined>): Promise<T> {
  const sp = new URLSearchParams();
  if (q) for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return apiJson<T>(`${C}${path.startsWith("/") ? path : `/${path}`}${qs ? `?${qs}` : ""}`);
}

export function csiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiJson<T>(`${C}${path.startsWith("/") ? path : `/${path}`}`, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function csiPut<T>(path: string, body?: unknown): Promise<T> {
  return apiJson<T>(`${C}${path.startsWith("/") ? path : `/${path}`}`, {
    method: "PUT",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export { formatCurrency, formatMinor, majorToMinor } from "@/lib/format/currency";

/** Client for /api/fi/* — CINTEXA Finance Financial Intelligence (zero API keys). */
import { API_BASE, apiJson } from "@/lib/api";

const FI = "/fi";

export function fiGet<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
  const q = new URLSearchParams();
  if (query) for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
  const qs = q.toString();
  return apiJson<T>(`${FI}${path.startsWith("/") ? path : `/${path}`}${qs ? `?${qs}` : ""}`);
}

export function fiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiJson<T>(`${FI}${path.startsWith("/") ? path : `/${path}`}`, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function fiPut<T>(path: string, body?: unknown): Promise<T> {
  return apiJson<T>(`${FI}${path.startsWith("/") ? path : `/${path}`}`, {
    method: "PUT",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function formatMinor(minor: number, currency = "GHS", digits = 2): string {
  const v = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: digits }).format(v);
  } catch {
    return `${currency} ${v.toFixed(digits)}`;
  }
}

export { API_BASE };

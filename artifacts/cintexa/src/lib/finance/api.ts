import { apiJson } from "@/lib/api";

const F = "/finance";

export function finGet<T>(path: string, q?: Record<string, string | undefined>): Promise<T> {
  const sp = new URLSearchParams();
  if (q) for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return apiJson<T>(`${F}${path.startsWith("/") ? path : `/${path}`}${qs ? `?${qs}` : ""}`);
}

export function finPost<T>(path: string, body?: unknown): Promise<T> {
  return apiJson<T>(`${F}${path.startsWith("/") ? path : `/${path}`}`, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function finDelete<T>(path: string, body?: unknown): Promise<T> {
  return apiJson<T>(`${F}${path.startsWith("/") ? path : `/${path}`}`, {
    method: "DELETE",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export {
  formatMinor,
  formatMoney,
  formatCurrency,
  formatMinorPlain,
  parseToMinor,
  majorToMinor,
  minorToMajor,
  currencyMeta,
} from "./money";


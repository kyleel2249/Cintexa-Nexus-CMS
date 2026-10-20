/**
 * Central API helpers.
 *
 *  - API_BASE          : where the REST API lives (`/api` by default, or VITE_API_BASE_URL)
 *  - apiFetch / apiJson: small helpers that always return a readable Error (never "Unexpected end of JSON").
 *
 * There is no sign-in: requests carry no credentials.
 */

export const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  (import.meta.env.VITE_API_URL as string | undefined) ||
  "/api").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  detail?: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** Human readable explanation for the failures people actually hit. */
export function explainStatus(status: number, serverMessage?: string): string {
  if (serverMessage && serverMessage !== "API backend not configured") return serverMessage;
  if (status === 401) return "The API refused the request (authentication is required by that server).";
  if (status === 403) return "You do not have permission to do that (the server restricts this action).";
  if (status === 404) return "The API route was not found. Check that the API/Functions deployment is up to date.";
  if (status === 429) return "Too many requests. Wait a minute and try again.";
  if (status === 502 || status === 503 || status === 504)
    return "The API backend is unreachable. Start the API server (npm run dev:api) or set API_ORIGIN in Cloudflare Pages.";
  return `Request failed (${status}).`;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type") && typeof init.body === "string") headers.set("content-type", "application/json");
  headers.set("accept", "application/json");
  return fetch(url, { credentials: "include", ...init, headers });
}

export async function readJson<T = any>(res: Response): Promise<T | null> {
  const text = await res.text().catch(() => "");
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** fetch + parse + throw a readable ApiError on any non-2xx. 204/empty bodies resolve to null. */
export async function apiJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch (e: any) {
    throw new ApiError(e?.message === "Failed to fetch" ? "Cannot reach the API. Check your connection and the API deployment." : e?.message || "Network error", 0);
  }
  const body = await readJson<any>(res);
  if (!res.ok) {
    throw new ApiError(explainStatus(res.status, body?.error || body?.message), res.status, body);
  }
  return body as T;
}

import { firebaseAuth } from "@/lib/firebase";

/**
 * Central API helpers.
 *
 *  - API_BASE          : where the REST API lives (`/api` by default, or VITE_API_BASE_URL)
 *  - installAuthFetch  : patches window.fetch ONCE so every request to the API automatically carries the
 *                        signed-in user's Firebase ID token. Many pages use plain fetch(); without this the
 *                        (now authenticated) API answers 401 to them.
 *  - apiFetch / apiJson: small helpers that always return a readable Error (never "Unexpected end of JSON").
 */

export const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  (import.meta.env.VITE_API_URL as string | undefined) ||
  "/api").replace(/\/$/, "");

/** Endpoints that must stay anonymous (public intake form, public forms, public settings, health). */
const PUBLIC_PATH = /\/(intake\/public|public\/forms|settings\/public|healthz?)(\/|$|\?)/;

function isApiUrl(url: string): boolean {
  if (url.startsWith("/api/") || url === "/api") return true;
  return API_BASE.startsWith("http") && url.startsWith(API_BASE);
}

let installed = false;

export function installAuthFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (isApiUrl(url) && !PUBLIC_PATH.test(url)) {
        const token = await firebaseAuth.currentUser?.getIdToken().catch(() => null);
        if (token) {
          const baseHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined);
          const headers = new Headers(baseHeaders);
          if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
          if (input instanceof Request && !init) return original(new Request(input, { headers }));
          return original(input, { ...init, headers });
        }
      }
    } catch {
      /* fall through to the plain request */
    }
    return original(input, init);
  };
}

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
  if (status === 401) return "You are signed out or your session expired. Sign in again and retry.";
  if (status === 403) return "You do not have permission to do that (admin access or an allowed IP address is required).";
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

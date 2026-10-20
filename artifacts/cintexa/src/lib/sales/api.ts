import { apiFetch, readJson, ApiError, explainStatus } from "@/lib/api";
import { localFetch } from "./local/runtime";

/**
 * Sales runs on this device by default (no API server needed). Set VITE_SALES_API_MODE=remote to talk to the REST API instead.
 */
export const SALES_LOCAL_MODE = (import.meta.env.VITE_SALES_API_MODE as string | undefined) !== "remote";
const transport = (path: string, init?: RequestInit): Promise<Response> => (SALES_LOCAL_MODE ? localFetch(path, init) : apiFetch(path, init));

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export interface FieldIssue {
  path: string;
  message: string;
}

/** Error thrown by every Sales API call. `code` is the stable machine code from the server (e.g. "validation_failed"). */
export class SalesApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: FieldIssue[];
  readonly details: unknown;
  readonly requestId?: string;

  constructor(message: string, status: number, code: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = "SalesApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    const issues = (details as { issues?: unknown } | undefined)?.issues;
    this.issues = Array.isArray(issues) ? (issues as FieldIssue[]).filter((i) => i && typeof i.path === "string" && typeof i.message === "string") : [];
  }

  get isPermission(): boolean {
    return this.status === 403;
  }
  get isNotMember(): boolean {
    return this.code === "not_a_sales_member";
  }
}

export function qs(query?: Query): string {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

interface CallOptions {
  query?: Query;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

function toError(res: Response, body: any): SalesApiError {
  const message = explainStatus(res.status, body?.error || body?.message);
  return new SalesApiError(message, res.status, body?.code ?? (res.status === 401 ? "unauthorized" : "error"), body?.details, body?.requestId);
}

export async function salesCall<T = any>(method: string, path: string, opts: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await transport(`/sales${path}${qs(opts.query)}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") throw e;
    throw new SalesApiError("Cannot reach the API. Check your connection and the API deployment.", 0, "network_error");
  }
  const body = await readJson<any>(res);
  if (!res.ok) throw toError(res, body);
  return body as T;
}

export const sales = {
  get: <T = any>(path: string, query?: Query, signal?: AbortSignal) => salesCall<T>("GET", path, { query, signal }),
  post: <T = any>(path: string, body?: unknown, opts: { idempotent?: boolean; key?: string; query?: Query } = {}) =>
    salesCall<T>("POST", path, { body: body ?? {}, query: opts.query, idempotencyKey: opts.key ?? (opts.idempotent ? newIdempotencyKey() : undefined) }),
  put: <T = any>(path: string, body?: unknown) => salesCall<T>("PUT", path, { body: body ?? {} }),
  patch: <T = any>(path: string, body?: unknown) => salesCall<T>("PATCH", path, { body: body ?? {} }),
  del: <T = any>(path: string) => salesCall<T>("DELETE", path),
  /** Fetch a text payload (CSV / HTML) and return it with the suggested file name. */
  async text(path: string, query?: Query): Promise<{ text: string; filename: string; contentType: string }> {
    let res: Response;
    try {
      res = await transport(`/sales${path}${qs(query)}`, { method: "GET", headers: { accept: "*/*" } });
    } catch {
      throw new SalesApiError("Cannot reach the API. Check your connection and the API deployment.", 0, "network_error");
    }
    if (!res.ok) throw toError(res, await readJson<any>(res));
    const cd = res.headers.get("content-disposition") ?? "";
    const m = /filename="?([^";]+)"?/i.exec(cd);
    return { text: await res.text(), filename: m?.[1] ?? "download.txt", contentType: res.headers.get("content-type") ?? "text/plain" };
  },
};

/** Save a text payload through the browser (CSV export). */
export function saveTextFile(text: string, filename: string, contentType = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type: contentType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function openHtmlInNewTab(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Unauthenticated calls (customer quotation link, public lead form). Never sends credentials. */
export async function publicCall<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await transport(`/sales/public${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), credentials: "omit" });
  } catch {
    throw new SalesApiError("Cannot reach the server. Please check your connection and try again.", 0, "network_error");
  }
  const data = await readJson<any>(res);
  if (!res.ok) throw toError(res, data);
  return data as T;
}

export { ApiError };

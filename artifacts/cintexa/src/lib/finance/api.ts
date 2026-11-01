import { apiFetch, readJson, explainStatus } from "@/lib/api";
import { SalesApiError, qs, newIdempotencyKey, type Query } from "@/lib/sales/api";

/** CINTEXA FINANCE always talks to the server API: posted financial records are authoritative in server PostgreSQL, never on-device. */
const ORG_KEY = "cintexa-finance-org";
let currentOrg: number | null = null;
try { const v = Number(localStorage.getItem(ORG_KEY)); currentOrg = Number.isInteger(v) && v > 0 ? v : null; } catch { /* storage unavailable */ }

export const getFinanceOrg = () => currentOrg;
export function setFinanceOrg(id: number | null): void {
  currentOrg = id;
  try { if (id) localStorage.setItem(ORG_KEY, String(id)); else localStorage.removeItem(ORG_KEY); } catch { /* in-memory only */ }
}

export { SalesApiError as FinanceApiError };

interface CallOptions { query?: Query; body?: unknown; idempotencyKey?: string; signal?: AbortSignal }

async function raw(method: string, path: string, o: CallOptions, accept?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (currentOrg) headers["X-Finance-Org"] = String(currentOrg);
  if (o.idempotencyKey) headers["Idempotency-Key"] = o.idempotencyKey;
  if (accept) headers.accept = accept;
  try {
    return await apiFetch(`/finance${path}${qs(o.query)}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: o.signal });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") throw e;
    throw new SalesApiError("Cannot reach the API. Check your connection and the API deployment.", 0, "network_error");
  }
}
const fail = (res: Response, body: any) => new SalesApiError(explainStatus(res.status, body?.error || body?.message), res.status, body?.code ?? "error", body?.details, body?.requestId);

export async function financeCall<T = any>(method: string, path: string, o: CallOptions = {}): Promise<T> {
  const res = await raw(method, path, o);
  const body = await readJson<any>(res);
  if (!res.ok) throw fail(res, body);
  return body as T;
}

export const fin = {
  get: <T = any>(path: string, query?: Query, signal?: AbortSignal) => financeCall<T>("GET", path, { query, signal }),
  /** POST with an Idempotency-Key so a double-click or retry can never create a second journal */
  post: <T = any>(path: string, body?: unknown, opts: { key?: string } = {}) => financeCall<T>("POST", path, { body: body ?? {}, idempotencyKey: opts.key ?? newIdempotencyKey() }),
  patch: <T = any>(path: string, body?: unknown) => financeCall<T>("PATCH", path, { body: body ?? {} }),
  del: <T = any>(path: string) => financeCall<T>("DELETE", path),
  /** download a CSV the server generated (requires reports:export) */
  async download(path: string, query: Query, fallbackName: string): Promise<void> {
    const res = await raw("GET", path, { query: { ...query, format: "csv" } }, "text/csv");
    if (!res.ok) throw fail(res, await readJson<any>(res));
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
    const url = URL.createObjectURL(new Blob([await res.text()], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  },
};

/** Exact decimal helpers for the journal editor (display and balance check only - the server re-validates every amount). */
export const toMinor = (v: string): bigint | null => {
  const s = v.trim();
  if (s === "") return 0n;
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  return BigInt(i + f.padEnd(2, "0"));
};
export const fromMinor = (m: bigint): string => { const neg = m < 0n; const a = (neg ? -m : m).toString().padStart(3, "0"); return `${neg ? "-" : ""}${a.slice(0, -2)}.${a.slice(-2)}`; };
export function fmtMoney(v: string | number | null | undefined, currency = "GHS"): string {
  const n = Number(v ?? 0);
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(Number.isFinite(n) ? n : 0); } catch { return `${currency} ${(Number.isFinite(n) ? n : 0).toFixed(2)}`; }
}
export const ymd = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : "");
export const todayYmd = (): string => new Date().toISOString().slice(0, 10);

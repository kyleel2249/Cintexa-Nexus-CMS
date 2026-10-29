import { apiFetch, readJson } from "@/lib/api";
import { localCall } from "./local-runtime";

export const SENTINEL_REMOTE = (import.meta.env.VITE_SENTINEL_API_MODE as string | undefined) === "remote";

export class SkClientError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); this.name = "SkClientError"; }
  get isNetwork() { return this.status === 0; }
}

export type Query = Record<string, string | number | boolean | null | undefined>;
export interface CallOptions { body?: unknown; query?: Query }

export function qs(q?: Query): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** One call surface for both stores. Never logs bodies: they may contain encrypted credential material. */
export async function sk<T = any>(method: string, path: string, opts: CallOptions = {}): Promise<T> {
  let status: number; let body: any;
  try {
    if (SENTINEL_REMOTE) {
      const res = await apiFetch(`/sentinel${path}${qs(opts.query)}`, { method, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), cache: "no-store" });
      status = res.status; body = await readJson(res);
    } else {
      const query = Object.fromEntries(Object.entries(opts.query ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]));
      const out = await localCall({ method, path, query, body: opts.body });
      status = out.status; body = out.body;
    }
  } catch (e) {
    throw new SkClientError(e instanceof Error && e.message ? e.message : "Storage is unavailable", 0, "network");
  }
  if (status >= 200 && status < 300) return body as T;
  throw new SkClientError(body?.error ?? `Request failed (${status})`, status, body?.code ?? "error");
}

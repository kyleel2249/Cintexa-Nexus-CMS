import type { CheckResult, Device } from "@workspace/wi-core";

/**
 * Client contract for the isolated browser worker.
 *
 * Playwright never runs inside the API process. A separate service (see docs/website-intelligence/browser-worker.md)
 * exposes:
 *   GET  /health                      -> 200 when ready
 *   POST /v1/inspect  { url, devices, maxScreenshots }  -> { results: BrowserFinding[], screenshots: [...] }
 * The worker enforces its own network egress policy (it must refuse private/internal destinations).
 */
import type { BrowserFinding, BrowserInspection } from "@workspace/wi-engine/ports";
export type { BrowserFinding, BrowserInspection };

export function browserWorkerConfigured(): boolean {
  return Boolean(process.env.WI_BROWSER_WORKER_URL);
}

async function workerFetch(path: string, init: { method: string; body?: string; timeoutMs: number }): Promise<{ status: number; json: unknown }> {
  const base = (process.env.WI_BROWSER_WORKER_URL as string).replace(/\/$/, "");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: init.method,
      body: init.body,
      signal: ctrl.signal,
      redirect: "manual",
      headers: { "content-type": "application/json", ...(process.env.WI_BROWSER_WORKER_TOKEN ? { authorization: `Bearer ${process.env.WI_BROWSER_WORKER_TOKEN}` } : {}) },
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

export async function browserWorkerHealth(): Promise<{ available: boolean; reason?: string }> {
  if (!browserWorkerConfigured()) return { available: false, reason: "WI_BROWSER_WORKER_URL is not configured." };
  try {
    const r = await workerFetch("/health", { method: "GET", timeoutMs: 5000 });
    return r.status === 200 ? { available: true } : { available: false, reason: `Browser worker health check returned HTTP ${r.status}.` };
  } catch (e) {
    return { available: false, reason: `Browser worker unreachable: ${(e as Error).message}` };
  }
}

export async function inspectWithBrowser(url: string, devices: Device[], maxScreenshots: number): Promise<BrowserInspection> {
  const health = await browserWorkerHealth();
  if (!health.available) return { available: false, reason: health.reason, findings: [] };
  try {
    const r = await workerFetch("/v1/inspect", { method: "POST", body: JSON.stringify({ url, devices, maxScreenshots }), timeoutMs: 120_000 });
    const j = r.json as { results?: BrowserFinding[]; version?: string } | null;
    if (r.status !== 200 || !j || !Array.isArray(j.results)) return { available: false, reason: `Browser worker returned HTTP ${r.status} without usable results.`, findings: [] };
    return { available: true, findings: j.results, version: j.version };
  } catch (e) {
    return { available: false, reason: `Browser worker failed: ${(e as Error).message}`, findings: [] };
  }
}

import type { Device } from "@workspace/wi-core";
import { parsePsi, psiRequestUrl, unavailablePsi, type PsiRun } from "@workspace/wi-engine/psi";
import { safeFetch } from "./safe-fetch";
import { resolveOpenRouterApiKey } from "../../lib/openrouter";
import { browserWorkerHealth } from "./browser-client";

export interface IntegrationStatus {
  id: string;
  label: string;
  status: "available" | "not_configured" | "unreachable";
  detail: string;
  envVars: string[];
}

export async function integrationStatuses(): Promise<IntegrationStatus[]> {
  const has = (k: string) => Boolean(process.env[k]);
  const worker = await browserWorkerHealth();
  const aiKey = await resolveOpenRouterApiKey().catch(() => null);
  return [
    { id: "pagespeed", label: "Google PageSpeed Insights (lab data, Core Web Vitals field data, Lighthouse accessibility)", status: has("PAGESPEED_API_KEY") ? "available" : "not_configured", detail: has("PAGESPEED_API_KEY") ? "API key present." : "Set PAGESPEED_API_KEY to enable lab and field performance measurement. Without it the engine reports these tests as not tested.", envVars: ["PAGESPEED_API_KEY"] },
    { id: "browser_worker", label: "Isolated browser worker (rendering, keyboard, viewport and screenshot checks)", status: worker.available ? "available" : has("WI_BROWSER_WORKER_URL") ? "unreachable" : "not_configured", detail: worker.available ? "Worker is healthy." : has("WI_BROWSER_WORKER_URL") ? (worker.reason ?? "Worker unreachable.") : "Set WI_BROWSER_WORKER_URL (and optionally WI_BROWSER_WORKER_TOKEN) to enable browser-rendered checks. Without it those tests are reported as not tested.", envVars: ["WI_BROWSER_WORKER_URL", "WI_BROWSER_WORKER_TOKEN"] },
    { id: "search_console", label: "Google Search Console", status: "not_configured", detail: "Requires an OAuth connection owned by the site owner. Not configured: indexing and search performance are not reported.", envVars: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"] },
    { id: "analytics", label: "Google Analytics / GA4 Data API", status: "not_configured", detail: "Requires an OAuth connection owned by the site owner. Not configured: traffic and conversion data are not reported.", envVars: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"] },
    { id: "business_profile", label: "Google Business Profile", status: "not_configured", detail: "Requires an authorised connection. Not configured: profile completeness is not assessed.", envVars: [] },
    { id: "ai_explanations", label: "AI explanations (OpenRouter)", status: aiKey ? "available" : "not_configured", detail: aiKey ? "Explanations are generated from audit evidence and labelled as AI-assisted recommendations." : "Configure an OpenRouter key under Settings for AI explanations. Deterministic explanations are always available.", envVars: ["OPENROUTER_API_KEY"] },
  ];
}

export type { PsiRun } from "@workspace/wi-engine/psi";

export async function runPageSpeed(url: string, device: Device, signal: AbortSignal): Promise<PsiRun> {
  const key = process.env.PAGESPEED_API_KEY;
  if (!key) return unavailablePsi(url, device, "PAGESPEED_API_KEY is not configured.");
  const r = await safeFetch(psiRequestUrl(url, device, key), { timeoutMs: 90_000, maxBytes: 8 * 1024 * 1024, signal, headers: { accept: "application/json" }, followRedirects: false });
  return parsePsi(url, device, { status: r.ok ? r.status : null, text: r.body.toString("utf8"), error: r.error?.message });
}

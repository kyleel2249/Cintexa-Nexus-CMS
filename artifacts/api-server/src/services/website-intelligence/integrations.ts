import type { Device, PerformanceSample } from "@workspace/wi-core";
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

interface PsiResponse {
  lighthouseResult?: {
    audits?: Record<string, { score?: number | null; numericValue?: number; details?: { items?: unknown[] }; title?: string }>;
    categories?: { performance?: { score?: number | null } };
    environment?: { hostUserAgent?: string; benchmarkIndex?: number };
    runWarnings?: string[];
  };
  loadingExperience?: { metrics?: Record<string, { percentile?: number; category?: string }>; overall_category?: string; origin_fallback?: boolean };
  originLoadingExperience?: { metrics?: Record<string, { percentile?: number; category?: string }>; overall_category?: string };
  error?: { message?: string };
}

export interface PsiRun {
  sample: PerformanceSample;
  contrastFailures: number | null;
  axeFailures: { id: string; title: string; count: number }[];
}

export async function runPageSpeed(url: string, device: Device, signal: AbortSignal): Promise<PsiRun> {
  const fetchedAt = new Date().toISOString();
  const key = process.env.PAGESPEED_API_KEY;
  const base: PerformanceSample = { device, url, source: "pagespeed", available: false, fetchedAt };
  if (!key) return { sample: { ...base, reason: "PAGESPEED_API_KEY is not configured." }, contrastFailures: null, axeFailures: [] };
  const qs = `url=${encodeURIComponent(url)}&strategy=${device}&category=performance&category=accessibility&key=${encodeURIComponent(key)}`;
  const r = await safeFetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`, { timeoutMs: 90_000, maxBytes: 8 * 1024 * 1024, signal, headers: { accept: "application/json" }, followRedirects: false });
  if (!r.ok || r.status === null) return { sample: { ...base, reason: `PageSpeed Insights was unreachable (${r.error?.message ?? "no response"}).` }, contrastFailures: null, axeFailures: [] };
  let j: PsiResponse;
  try { j = JSON.parse(r.body.toString("utf8")) as PsiResponse; } catch { return { sample: { ...base, reason: `PageSpeed Insights returned an unreadable response (HTTP ${r.status}).` }, contrastFailures: null, axeFailures: [] }; }
  if (r.status !== 200 || j.error) return { sample: { ...base, reason: `PageSpeed Insights error: ${j.error?.message ?? `HTTP ${r.status}`}` }, contrastFailures: null, axeFailures: [] };
  const a = j.lighthouseResult?.audits ?? {};
  const num = (id: string) => (typeof a[id]?.numericValue === "number" ? (a[id].numericValue as number) : undefined);
  const lab = {
    lcpMs: num("largest-contentful-paint"), fcpMs: num("first-contentful-paint"), cls: num("cumulative-layout-shift"), tbtMs: num("total-blocking-time"),
    speedIndexMs: num("speed-index"), ttfbMs: num("server-response-time"), performanceScore: typeof j.lighthouseResult?.categories?.performance?.score === "number" ? Math.round((j.lighthouseResult.categories.performance.score as number) * 100) : undefined,
  };
  const fm = (j.loadingExperience?.metrics && Object.keys(j.loadingExperience.metrics).length ? j.loadingExperience : j.originLoadingExperience) as PsiResponse["loadingExperience"] | undefined;
  const originOnly = !(j.loadingExperience?.metrics && Object.keys(j.loadingExperience.metrics).length) || Boolean(j.loadingExperience?.origin_fallback);
  const m = fm?.metrics ?? {};
  const field = Object.keys(m).length
    ? { lcpMs: m.LARGEST_CONTENTFUL_PAINT_MS?.percentile, inpMs: m.INTERACTION_TO_NEXT_PAINT?.percentile, cls: typeof m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile === "number" ? (m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile as number) / 100 : undefined, fcpMs: m.FIRST_CONTENTFUL_PAINT_MS?.percentile, ttfbMs: m.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile, category: fm?.overall_category, origin: originOnly }
    : null;
  const bad = Object.entries(a).filter(([id, v]) => v.score === 0 && ["color-contrast", "image-alt", "label", "link-name", "button-name", "html-has-lang", "document-title", "meta-viewport", "aria-allowed-attr", "aria-required-attr", "tap-targets", "target-size", "heading-order", "duplicate-id-aria", "frame-title", "list", "listitem", "tabindex", "bypass", "valid-lang", "select-name", "input-image-alt", "aria-hidden-focus"].includes(id));
  return {
    sample: { ...base, available: true, lab, field, environment: j.lighthouseResult?.environment?.hostUserAgent ?? "Lighthouse via PageSpeed Insights (Google-hosted, throttled mobile/desktop emulation)" },
    contrastFailures: a["color-contrast"]?.score === undefined || a["color-contrast"]?.score === null ? null : a["color-contrast"].score === 0 ? ((a["color-contrast"].details?.items?.length as number | undefined) ?? 1) : 0,
    axeFailures: bad.map(([id, v]) => ({ id, title: v.title ?? id, count: (v.details?.items?.length as number | undefined) ?? 1 })),
  };
}


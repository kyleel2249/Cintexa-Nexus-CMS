import type { Device, PerformanceSample } from "@workspace/wi-core";

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

/** Result of calling the PageSpeed Insights endpoint, however the caller made the request. */
export interface PsiHttp { status: number | null; text: string; error?: string }

export function psiRequestUrl(url: string, device: Device, key: string): string {
  return `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${device}&category=performance&category=accessibility&key=${encodeURIComponent(key)}`;
}

export function unavailablePsi(url: string, device: Device, reason: string): PsiRun {
  return { sample: { device, url, source: "pagespeed", available: false, fetchedAt: new Date().toISOString(), reason }, contrastFailures: null, axeFailures: [] };
}

/** Turns a PageSpeed Insights HTTP response into a measured sample. Shared by the server and the browser. */
export function parsePsi(url: string, device: Device, http: PsiHttp): PsiRun {
  const fetchedAt = new Date().toISOString();
  const base: PerformanceSample = { device, url, source: "pagespeed", available: false, fetchedAt };
  if (http.status === null) return { sample: { ...base, reason: `PageSpeed Insights was unreachable (${http.error ?? "no response"}).` }, contrastFailures: null, axeFailures: [] };
  let j: PsiResponse;
  try { j = JSON.parse(http.text) as PsiResponse; } catch { return { sample: { ...base, reason: `PageSpeed Insights returned an unreadable response (HTTP ${http.status}).` }, contrastFailures: null, axeFailures: [] }; }
  if (http.status !== 200 || j.error) return { sample: { ...base, reason: `PageSpeed Insights error: ${j.error?.message ?? `HTTP ${http.status}`}` }, contrastFailures: null, axeFailures: [] };
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

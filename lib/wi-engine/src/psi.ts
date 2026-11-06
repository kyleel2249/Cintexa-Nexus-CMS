import type { Device, PerformanceSample } from "@workspace/wi-core";

/** Result shape for lab performance data. Nexus does not call any external performance service. */
export interface PsiRun {
  sample: PerformanceSample;
  contrastFailures: number | null;
  axeFailures: { id: string; title: string; count: number }[];
}

/** An explicit "no lab data" result: the engine falls back to its own HTTP timing and reports the reason. */
export function unavailablePsi(url: string, device: Device, reason: string): PsiRun {
  return { sample: { device, url, source: "pagespeed", available: false, fetchedAt: new Date().toISOString(), reason }, contrastFailures: null, axeFailures: [] };
}

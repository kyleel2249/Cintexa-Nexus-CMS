import type { Device } from "@workspace/wi-core";
import { unavailablePsi, type PsiRun } from "@workspace/wi-engine/psi";
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
  return [
    { id: "browser_worker", label: "Isolated browser worker (rendering, keyboard, viewport and screenshot checks)", status: worker.available ? "available" : has("WI_BROWSER_WORKER_URL") ? "unreachable" : "not_configured", detail: worker.available ? "Worker is healthy." : has("WI_BROWSER_WORKER_URL") ? (worker.reason ?? "Worker unreachable.") : "Set WI_BROWSER_WORKER_URL (and optionally WI_BROWSER_WORKER_TOKEN) to enable browser-rendered checks. Without it those tests are reported as not tested.", envVars: ["WI_BROWSER_WORKER_URL", "WI_BROWSER_WORKER_TOKEN"] },
    { id: "explanations", label: "Explanations", status: "available", detail: "Built from the recorded audit evidence by the built-in engine.", envVars: [] },
  ];
}

export type { PsiRun } from "@workspace/wi-engine/psi";

/** Lab performance data comes from an external service that is not part of this self-contained build. */
export async function runPageSpeed(url: string, device: Device, _signal: AbortSignal): Promise<PsiRun> {
  return unavailablePsi(url, device, "External performance testing is not part of this self-contained build.");
}

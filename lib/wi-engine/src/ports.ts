/**
 * Ports: everything the engine needs from its host environment.
 *
 * The same engine runs in two places:
 *   - the Node API server (Postgres store, SSRF-pinned sockets, TLS probe, browser worker, webhooks/e-mail);
 *   - the browser ("local mode": in-browser store, requests relayed through a Cloudflare Pages Function, DNS over HTTPS).
 * Each host calls configureEngine() once at start-up. Engine modules import the functions below, never Node or DOM APIs.
 */
import type { CheckResult, Device } from "@workspace/wi-core";
import type { ResolvedHost, SafeFetchOptions, SafeFetchResult, TlsProbe } from "./net-types";
import type { EngineRepo } from "./repo";
import type { PsiRun } from "./psi";
import type { WiSettings } from "./settings";

export interface BrowserFinding { testId: string; status: CheckResult["status"]; url?: string; device?: Device; actual?: string; expected?: string; note?: string }
export interface BrowserInspection { available: boolean; reason?: string; findings: BrowserFinding[]; version?: string }

export interface NetPort {
  safeFetch(url: string, options?: SafeFetchOptions): Promise<SafeFetchResult>;
  /** Resolves a hostname and refuses it when any answer is non-public. */
  resolvePublic(hostname: string): Promise<ResolvedHost>;
  probeTls(hostname: string, port?: number, timeoutMs?: number): Promise<TlsProbe>;
  /** Decompresses a gzip payload; throws when it is invalid or larger than maxOutput. */
  gunzip(bytes: Uint8Array, maxOutput: number): Promise<Uint8Array>;
}

export interface BrowserPort {
  health(): Promise<{ available: boolean; reason?: string }>;
  inspect(url: string, devices: Device[], maxScreenshots: number): Promise<BrowserInspection>;
}

export interface PageSpeedPort {
  /** True when an API key is available. */
  configured: boolean;
  run(url: string, device: Device, signal: AbortSignal): Promise<PsiRun>;
}

export interface RuntimeInfo {
  /** Free text recorded in the audit environment, e.g. "node v22.1.0" or "browser (Chrome 130)". */
  version: string;
  /** Where requests originate, e.g. "api-host-1 (eu-west)" or "Cloudflare network via relay". */
  location: string;
  browserWorkerConfigured: boolean;
}

export interface EnginePorts {
  net: NetPort;
  repo: EngineRepo;
  settings: { load(): Promise<WiSettings> };
  browser: BrowserPort;
  pagespeed: PageSpeedPort;
  notifier: { finished(auditId: string): Promise<void> };
  runtime: RuntimeInfo;
}

let current: EnginePorts | null = null;

export function configureEngine(p: EnginePorts): void { current = p; }
export function isEngineConfigured(): boolean { return current !== null; }
export function getPorts(): EnginePorts {
  if (!current) throw new Error("The Website Intelligence engine has not been configured (configureEngine was not called).");
  return current;
}

export const safeFetch: NetPort["safeFetch"] = (url, options) => getPorts().net.safeFetch(url, options);
export const resolvePublic: NetPort["resolvePublic"] = (hostname) => getPorts().net.resolvePublic(hostname);
export const probeTls: NetPort["probeTls"] = (hostname, port, timeoutMs) => getPorts().net.probeTls(hostname, port, timeoutMs);
export const gunzip: NetPort["gunzip"] = (bytes, maxOutput) => getPorts().net.gunzip(bytes, maxOutput);

/** Delegating view of the configured repository, so modules can write `store.patchAudit(...)`. */
export const store: EngineRepo = new Proxy({} as EngineRepo, {
  get: (_t, key: string) => (...args: unknown[]) => (getPorts().repo as unknown as Record<string, (...a: unknown[]) => unknown>)[key](...args),
});

export function utf8Length(s: string): number { return new TextEncoder().encode(s).length; }

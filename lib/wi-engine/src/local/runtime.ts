/**
 * Local mode runtime: the complete Website Intelligence engine with no API server.
 * Everything runs in the page; history lives in the injected MemoryRepo (persisted to IndexedDB by the host).
 */
import { configureEngine } from "../ports";
import { deterministicExplanation } from "../explain";
import { abortAudit, holdCredential, isRunning, runAudit } from "../engine";
import { MemoryRepo } from "../memory-repo";
import { parsePsi, psiRequestUrl, unavailablePsi } from "../psi";
import { registerWiRoutes, type ApiDeps, type IntegrationStatus } from "../routes";
import { DEFAULT_WI_SETTINGS, mergeSettings, normalizeStoredSettings, type WiSettings } from "../settings";
import { createRelayNet, type RelayNetOptions } from "./net";
import { LocalRouter, type LocalRequest, type LocalResponse } from "./router";

export interface LocalRuntimeOptions {
  user: { id: string; email: string | null };
  net: RelayNetOptions;
  repo: MemoryRepo;
  /** Persists the settings JSON (localStorage in the browser). */
  settingsStore: { read(): string | null; write(value: string): void };
  /** The visitor's own PageSpeed Insights key, if they provided one. */
  pageSpeedKey(): string | null;
  runtimeVersion: string;
  fetchImpl?: typeof fetch;
  maxConcurrent?: number;
}

export const LOCAL_LIMITATIONS = [
  "TLS certificates and protocol versions cannot be inspected from a browser, so those tests are reported as not tested.",
  "Compression and transfer size cannot be observed through the relay, so the compression test is inconclusive.",
  "Audits run only while this tab is open. Monitors and scheduled re-audits need the server edition.",
  "History is stored in this browser only. Public share links need the server edition.",
  "Logged-in (authenticated) crawling and the headless-browser worker need the server edition.",
];

export interface LocalRuntime {
  handle(req: Omit<LocalRequest, "auth">): Promise<LocalResponse>;
  /** Marks audits that were queued or running when the tab closed as interrupted. Returns how many. */
  recoverInterrupted(): Promise<number>;
  limitations: string[];
}

export function createLocalRuntime(o: LocalRuntimeOptions): LocalRuntime {
  const repo = o.repo;
  const loadSettings = async (): Promise<WiSettings> => {
    let stored: Partial<WiSettings> = {};
    try { stored = JSON.parse(o.settingsStore.read() ?? "{}") as Partial<WiSettings>; } catch { stored = {}; }
    // The server-only capabilities are off by construction in local mode.
    return { ...normalizeStoredSettings(stored), allowAuthenticatedScope: false, allowPublicShare: false };
  };
  const settings: ApiDeps["settings"] = {
    load: loadSettings,
    async save(patch) {
      const cur = await loadSettings();
      const r = mergeSettings(cur, { ...patch, allowAuthenticatedScope: false, allowPublicShare: false });
      if (!r.ok) return r;
      try { o.settingsStore.write(JSON.stringify(r.settings)); } catch { return { ok: false, error: "Settings could not be saved in this browser (storage is unavailable)." }; }
      return r;
    },
  };

  const doFetch: typeof fetch = (...a) => (o.fetchImpl ?? fetch)(...a);
  configureEngine({
    net: createRelayNet(o.net),
    repo,
    settings: { load: loadSettings },
    browser: {
      health: async () => ({ available: false, reason: "The headless-browser worker is not available in local mode." }),
      inspect: async () => ({ available: false, reason: "The headless-browser worker is not available in local mode.", findings: [] }),
    },
    pagespeed: {
      get configured() { return Boolean(o.pageSpeedKey()); },
      async run(url, device, signal) {
        const key = o.pageSpeedKey();
        if (!key) return unavailablePsi(url, device, "No PageSpeed Insights API key is set in this browser.");
        try {
          const res = await doFetch(psiRequestUrl(url, device, key), { signal, headers: { accept: "application/json" } });
          return parsePsi(url, device, { status: res.status, text: await res.text() });
        } catch (e) { return parsePsi(url, device, { status: null, text: "", error: (e as Error).message }); }
      },
    },
    notifier: { finished: async () => undefined },
    runtime: { version: o.runtimeVersion, location: "your browser, fetching through the Cloudflare relay", browserWorkerConfigured: false },
  });

  // ---- queue (runs in the page)
  const pending: string[] = [];
  let active = 0;
  const pump = async () => {
    const { limits } = await loadSettings();
    const max = Math.max(1, Math.min(o.maxConcurrent ?? 2, limits.maxGlobalConcurrentAudits));
    while (active < max && pending.length) {
      const id = pending.shift() as string;
      active++;
      runAudit(id)
        .catch(async (err: unknown) => { await repo.patchAudit(id, { status: "failed", error: err instanceof Error ? err.message : "The audit failed.", completedAt: new Date() }).catch(() => undefined); })
        .finally(() => { active--; void pump(); });
    }
  };
  const enqueue = (id: string) => { if (!pending.includes(id) && !isRunning(id)) pending.push(id); void pump(); };
  const cancel = async (id: string) => {
    await repo.requestCancel(id);
    abortAudit(id);
    const i = pending.indexOf(id);
    if (i >= 0) { pending.splice(i, 1); await repo.patchAudit(id, { status: "cancelled", completedAt: new Date() }); }
  };

  const integrations = async (): Promise<IntegrationStatus[]> => [
    { id: "relay", label: "Fetch relay (Cloudflare Pages Function)", status: "available", detail: "Pages are fetched through /api/wi-relay with your sign-in token.", envVars: ["FIREBASE_PROJECT_ID"] },
    { id: "pagespeed", label: "PageSpeed Insights", status: o.pageSpeedKey() ? "available" : "not_configured", detail: o.pageSpeedKey() ? "Using the key saved in this browser." : "Add your own PageSpeed Insights API key in this browser to enable lab Core Web Vitals.", envVars: [] },
    { id: "browser", label: "Headless browser worker", status: "not_configured", detail: "Not available in local mode. Rendering-dependent tests are reported as not tested.", envVars: [] },
    { id: "ai", label: "Explanations", status: "available", detail: "Deterministic explanations built from the recorded evidence.", envVars: [] },
  ];

  const router = new LocalRouter();
  // Server-only capabilities answer honestly instead of failing.
  const unavailable = (what: string) => (_req: unknown, res: { status(c: number): { json(b: unknown): unknown } }) => res.status(501).json({ error: `${what} is not available in local mode. It needs the server edition.`, code: "LOCAL_MODE" });
  router.get("/monitors", (_req, res) => { res.json({ monitors: [] }); });
  router.post("/monitors", unavailable("Monitoring") as never);
  router.patch("/monitors/:id", unavailable("Monitoring") as never);
  router.delete("/monitors/:id", unavailable("Monitoring") as never);
  router.post("/monitors/:id/run", unavailable("Monitoring") as never);
  router.get("/:id/share", (_req, res) => { res.json({ shared: false, token: null }); });
  router.post("/:id/share", unavailable("Public share links") as never);
  router.delete("/:id/share", unavailable("Public share links") as never);

  registerWiRoutes(router, {
    repo, settings, enqueue, cancel, holdCredential,
    queueDepth: () => ({ pending: pending.length, active }),
    integrations,
    explain: async (f) => deterministicExplanation(f),
  });

  return {
    limitations: LOCAL_LIMITATIONS,
    handle: (r) => router.handle({ ...r, auth: { sub: o.user.id, role: "admin", email: o.user.email ?? undefined } }),
    async recoverInterrupted() {
      let n = 0;
      for (const id of repo.allIds()) {
        const a = await repo.getAudit(id);
        if (a && (a.status === "queued" || a.status === "running") && !isRunning(id) && !pending.includes(id)) {
          await repo.patchAudit(id, { status: "failed", error: "This audit was interrupted because the tab was closed. Use Retry to run it again.", completedAt: new Date() });
          n++;
        }
      }
      return n;
    },
  };
}
export { DEFAULT_WI_SETTINGS };
